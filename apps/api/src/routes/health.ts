import { sql } from 'drizzle-orm';
import type { FastifyPluginCallback } from 'fastify';
import type { Database } from '../db/client.js';

interface HealthRoutesOptions {
  db: Database;
}

export const healthRoutes: FastifyPluginCallback<HealthRoutesOptions> = (app, { db }, done) => {
  app.get(
    '/health',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: { status: { const: 'ok' }, db: { const: 'up' } },
            required: ['status', 'db'],
          },
          503: {
            type: 'object',
            properties: { status: { const: 'degraded' }, db: { const: 'down' } },
            required: ['status', 'db'],
          },
        },
      },
    },
    async (request, reply) => {
      try {
        await db.execute(sql`SELECT 1`);
        return { status: 'ok', db: 'up' };
      } catch (err) {
        request.log.error({ err }, 'health check: base de datos no disponible');
        return reply.code(503).send({ status: 'degraded', db: 'down' });
      }
    },
  );
  done();
};
