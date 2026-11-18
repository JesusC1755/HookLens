import type { FastifyPluginCallback } from 'fastify';
import type { Database } from '../../db/client.js';
import { createEndpoint } from './service.js';

interface EndpointRoutesOptions {
  db: Database;
  publicBaseUrl: string;
}

export const endpointRoutes: FastifyPluginCallback<EndpointRoutesOptions> = (
  app,
  { db, publicBaseUrl },
  done,
) => {
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
        url: `${publicBaseUrl}/wh/${slug}`,
        expiresAt: expiresAt.toISOString(),
      });
    },
  );

  done();
};
