import type { FastifyPluginCallback } from 'fastify';
import type { Database } from '../../db/client.js';
import type { Limit } from '../../lib/rate-limit.js';
import type { Retention } from '../ingest/service.js';
import { authorizeEndpoint } from './auth.js';
import {
  normalizeResponseHeaders,
  type ResponseConfig,
  responseConfigSchema,
} from './response-config.js';
import { createEndpoint, getEndpointDetails, updateResponseConfig } from './service.js';

interface EndpointRoutesOptions {
  db: Database;
  publicBaseUrl: string;
  createLimit: Limit;
  /** Se informa al front para que el aviso de retención diga los topes reales. */
  retention: Retention;
}

const slugParamsSchema = {
  type: 'object',
  properties: { slug: { type: 'string', maxLength: 64 } },
  required: ['slug'],
} as const;

// Schema de salida: las respuestas guardadas siempre cumplen el de entrada.
const responseConfigOutputSchema = {
  type: 'object',
  properties: {
    status: { type: 'integer' },
    headers: { type: 'object', additionalProperties: { type: 'string' } },
    body: { type: 'string' },
    delayMs: { type: 'integer' },
  },
  required: ['status', 'headers', 'body', 'delayMs'],
  additionalProperties: false,
} as const;

export const endpointRoutes: FastifyPluginCallback<EndpointRoutesOptions> = (
  app,
  { db, publicBaseUrl, createLimit, retention },
  done,
) => {
  const ingestUrl = (slug: string) => `${publicBaseUrl}/wh/${slug}`;

  app.post(
    '/api/endpoints',
    {
      // Sin cuentas, crear endpoints es la puerta de entrada: se limita por IP (la que
      // resuelve trustProxy, así un cliente no la falsea con X-Forwarded-For).
      config: {
        rateLimit: { max: createLimit.max, timeWindow: createLimit.timeWindowMs },
      },
      schema: {
        response: {
          201: {
            type: 'object',
            properties: {
              slug: { type: 'string' },
              token: { type: 'string' },
              url: { type: 'string' },
              expiresAt: { type: 'string', format: 'date-time' },
            },
            required: ['slug', 'token', 'url', 'expiresAt'],
            additionalProperties: false,
          },
        },
      },
    },
    async (_request, reply) => {
      const { slug, token, expiresAt } = await createEndpoint(db);
      // El token no debe quedar en cachés intermedias.
      void reply.header('cache-control', 'no-store');
      return reply.code(201).send({
        slug,
        token,
        url: ingestUrl(slug),
        expiresAt: expiresAt.toISOString(),
      });
    },
  );

  app.get<{ Params: { slug: string } }>(
    '/api/endpoints/:slug',
    {
      schema: {
        params: slugParamsSchema,
        response: {
          200: {
            type: 'object',
            properties: {
              slug: { type: 'string' },
              url: { type: 'string' },
              createdAt: { type: 'string', format: 'date-time' },
              expiresAt: { type: 'string', format: 'date-time' },
              response: responseConfigOutputSchema,
              retention: {
                type: 'object',
                properties: {
                  maxRequests: { type: 'integer' },
                  maxBytes: { type: 'integer' },
                },
                required: ['maxRequests', 'maxBytes'],
                additionalProperties: false,
              },
            },
            required: ['slug', 'url', 'createdAt', 'expiresAt', 'response', 'retention'],
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
      const details = await getEndpointDetails(db, endpoint.id);
      return {
        slug: details.slug,
        url: ingestUrl(details.slug),
        createdAt: details.createdAt.toISOString(),
        expiresAt: details.expiresAt.toISOString(),
        response: details.response,
        retention,
      };
    },
  );

  // PUT y no PATCH: el formulario siempre manda la configuración completa, así la
  // operación es idempotente y no hay que decidir si los headers se mezclan o se reemplazan.
  app.put<{ Params: { slug: string }; Body: ResponseConfig }>(
    '/api/endpoints/:slug/response',
    {
      schema: {
        params: slugParamsSchema,
        body: responseConfigSchema,
        response: { 200: responseConfigOutputSchema },
      },
    },
    async (request) => {
      const endpoint = await authorizeEndpoint(
        db,
        request.params.slug,
        request.headers.authorization,
      );
      return updateResponseConfig(db, endpoint.id, {
        ...request.body,
        headers: normalizeResponseHeaders(request.body.headers),
      });
    },
  );

  done();
};
