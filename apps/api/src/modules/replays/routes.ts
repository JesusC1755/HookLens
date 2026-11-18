import type { FastifyPluginCallback } from 'fastify';
import type { Database } from '../../db/client.js';
import type { MultiValueMap } from '../../db/types.js';
import { AppError } from '../../lib/errors.js';
import { INGEST_BODY_LIMIT_BYTES } from '../ingest/routes.js';
import { findOwnedRequest } from '../requests/service.js';
import { sendRequest } from './client.js';
import { forwardableHeaders } from './headers.js';
import { replayDetailSchema, replaySummarySchema, toReplayDetail } from './serializers.js';
import { findOwnedReplay, listReplays, recordReplay } from './service.js';
import { type AddressPolicy, createSafeLookup, parseTargetUrl } from './ssrf.js';

export interface ReplayRoutesOptions {
  db: Database;
  isAllowedAddress: AddressPolicy;
  timeoutMs: number;
}

interface ReplayBody {
  targetUrl: string;
  method?: string;
  headers?: MultiValueMap;
  /** base64; null = sin body. Si se omite, se reenvía el body original. */
  body?: string | null;
}

const REPLAY_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
// El body editado viaja en base64 (≈ 4/3 del tamaño) dentro de un JSON.
const MAX_BODY_BASE64_LENGTH = Math.ceil(INGEST_BODY_LIMIT_BYTES / 3) * 4;
const ROUTE_BODY_LIMIT = MAX_BODY_BASE64_LENGTH + 256 * 1024;

const idParamsSchema = {
  type: 'object',
  properties: { id: { type: 'string', format: 'uuid' } },
  required: ['id'],
} as const;

const replayBodySchema = {
  type: 'object',
  properties: {
    targetUrl: { type: 'string', minLength: 1, maxLength: 2048 },
    method: { type: 'string', enum: REPLAY_METHODS },
    headers: {
      type: 'object',
      maxProperties: 100,
      propertyNames: { type: 'string', maxLength: 256, pattern: "^[!#$%&'*+.^_`|~0-9A-Za-z-]+$" },
      additionalProperties: {
        type: 'array',
        maxItems: 20,
        // Los mismos caracteres que Node acepta en un header saliente: nada de CR/LF.
        items: { type: 'string', maxLength: 8192, pattern: '^[\\t\\x20-\\x7e\\x80-\\xff]*$' },
      },
    },
    body: {
      type: ['string', 'null'],
      maxLength: MAX_BODY_BASE64_LENGTH,
      pattern: '^[A-Za-z0-9+/]*={0,2}$',
    },
  },
  required: ['targetUrl'],
  additionalProperties: false,
} as const;

export const replayRoutes: FastifyPluginCallback<ReplayRoutesOptions> = (
  app,
  { db, isAllowedAddress, timeoutMs },
  done,
) => {
  const lookup = createSafeLookup(isAllowedAddress);

  app.post<{ Params: { id: string }; Body: ReplayBody }>(
    '/api/requests/:id/replays',
    {
      bodyLimit: ROUTE_BODY_LIMIT,
      schema: {
        params: idParamsSchema,
        body: replayBodySchema,
        response: { 201: replayDetailSchema },
      },
    },
    async (request, reply) => {
      const original = await findOwnedRequest(db, request.params.id, request.headers.authorization);
      const url = parseTargetUrl(request.body.targetUrl, isAllowedAddress);

      // Sin ediciones se reenvía exactamente lo capturado.
      const { method = original.method, headers = original.headers } = request.body;
      const body =
        request.body.body === undefined
          ? original.body
          : request.body.body === null
            ? null
            : Buffer.from(request.body.body, 'base64');
      if (body !== null && body.length > INGEST_BODY_LIMIT_BYTES) {
        throw new AppError(400, 'BODY_TOO_LARGE', 'El body editado supera 1 MB');
      }

      const sent = { url, method, headers: forwardableHeaders(headers), body };
      const outcome = await sendRequest(sent, {
        lookup,
        timeoutMs,
        maxResponseBytes: INGEST_BODY_LIMIT_BYTES,
      });

      // Los fallos de red también se guardan: "el destino rechazó la conexión" es un resultado útil.
      const replay = await recordReplay(db, {
        requestId: original.id,
        targetUrl: url.href,
        reqMethod: method,
        reqHeaders: sent.headers,
        reqBody: body,
        respStatus: outcome.status,
        respHeaders: outcome.headers,
        respBody: outcome.body,
        durationMs: outcome.durationMs,
        error: outcome.error,
      });
      return reply.code(201).send(toReplayDetail(replay));
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/requests/:id/replays',
    {
      schema: {
        params: idParamsSchema,
        response: {
          200: {
            type: 'object',
            properties: { items: { type: 'array', items: replaySummarySchema } },
            required: ['items'],
            additionalProperties: false,
          },
        },
      },
    },
    async (request) => {
      const original = await findOwnedRequest(db, request.params.id, request.headers.authorization);
      return { items: await listReplays(db, original.id) };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/replays/:id',
    { schema: { params: idParamsSchema, response: { 200: replayDetailSchema } } },
    async (request) =>
      toReplayDetail(await findOwnedReplay(db, request.params.id, request.headers.authorization)),
  );

  done();
};
