import type { FastifyPluginCallback } from 'fastify';
import type { Database } from '../../db/client.js';
import { decodeCursor } from '../../lib/cursor.js';
import { AppError } from '../../lib/errors.js';
import { authorizeEndpoint, requireBearerToken, tokenMatchesHash } from '../endpoints/auth.js';
import { requestDetailSchema, requestSummarySchema } from './serializers.js';
import { findRequestWithOwner, listRequests } from './service.js';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

interface RequestRoutesOptions {
  db: Database;
}

export const requestRoutes: FastifyPluginCallback<RequestRoutesOptions> = (app, { db }, done) => {
  app.get<{
    Params: { slug: string };
    Querystring: { cursor?: string; limit: number };
  }>(
    '/api/endpoints/:slug/requests',
    {
      schema: {
        params: {
          type: 'object',
          properties: { slug: { type: 'string', maxLength: 64 } },
          required: ['slug'],
        },
        querystring: {
          type: 'object',
          properties: {
            cursor: { type: 'string', maxLength: 256 },
            limit: {
              type: 'integer',
              minimum: 1,
              maximum: MAX_PAGE_SIZE,
              default: DEFAULT_PAGE_SIZE,
            },
          },
          additionalProperties: false,
        },
        response: {
          200: {
            type: 'object',
            properties: {
              items: { type: 'array', items: requestSummarySchema },
              nextCursor: { type: ['string', 'null'] },
            },
            required: ['items', 'nextCursor'],
            additionalProperties: false,
          },
        },
      },
    },
    async (request) => {
      const endpoint = await authorizeEndpoint(
        db,
        request.params.slug,
        request.headers.authorization,
      );

      const { cursor: rawCursor, limit } = request.query;
      const cursor = rawCursor === undefined ? null : decodeCursor(rawCursor);
      if (rawCursor !== undefined && cursor === null) {
        throw new AppError(400, 'INVALID_CURSOR', 'El cursor no es válido');
      }

      return listRequests(db, endpoint.id, { cursor, limit });
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/requests/:id',
    {
      schema: {
        params: {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' } },
          required: ['id'],
        },
        response: { 200: requestDetailSchema },
      },
    },
    async (request) => {
      const token = requireBearerToken(request.headers.authorization);
      const found = await findRequestWithOwner(db, request.params.id);

      // Con un token ajeno la request "no existe": responder 403 confirmaría que el id es real.
      if (!found || !tokenMatchesHash(token, found.ownerTokenHash)) {
        throw new AppError(404, 'REQUEST_NOT_FOUND', 'La request no existe');
      }
      if (found.endpointExpiresAt.getTime() <= Date.now()) {
        throw new AppError(410, 'ENDPOINT_EXPIRED', 'El endpoint expiró');
      }
      return found.request;
    },
  );

  done();
};
