import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Database } from './db/client.js';
import { healthRoutes } from './routes/health.js';

export interface AppOptions {
  db: Database;
  logger?: FastifyServerOptions['logger'];
}

/** Construye la app sin escuchar en un puerto: los tests la usan con app.inject(). */
export function buildApp({ db, logger = false }: AppOptions): FastifyInstance {
  const app = Fastify({ logger });

  void app.register(healthRoutes, { db });

  return app;
}
