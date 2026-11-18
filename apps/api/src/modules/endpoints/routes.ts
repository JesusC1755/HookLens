import type { FastifyPluginCallback } from 'fastify';
import type { Database } from '../../db/client.js';
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
  { db, publicBaseUrl },
  done,
) => {
  const ingestUrl = (slug: string) => `${publicBaseUrl}/wh/${slug}`;

  app.post(
    '/api/endpoints',
    {
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
            },
            required: ['slug', 'url', 'createdAt', 'expiresAt', 'response'],
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
