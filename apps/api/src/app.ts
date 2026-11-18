import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Database } from './db/client.js';
import { registerErrorHandling } from './lib/errors.js';
import { endpointRoutes } from './modules/endpoints/routes.js';
import { ingestRoutes } from './modules/ingest/routes.js';
import { healthRoutes } from './routes/health.js';

// Límite para la API de gestión; la ingesta define el suyo (1 MB) en su plugin.
const API_BODY_LIMIT_BYTES = 64 * 1024;

export interface AppOptions {
  db: Database;
  publicBaseUrl: string;
  /** IPs, CIDR o alias de los proxies de confianza; vacío = no confiar en X-Forwarded-For. */
  trustProxy?: string[];
  logger?: FastifyServerOptions['logger'];
}

/** Construye la app sin escuchar en un puerto: los tests la usan con app.inject(). */
export function buildApp({
  db,
  publicBaseUrl,
  trustProxy = [],
  logger = false,
}: AppOptions): FastifyInstance {
  const app = Fastify({
    logger,
    bodyLimit: API_BODY_LIMIT_BYTES,
    trustProxy: trustProxy.length > 0 ? trustProxy : false,
  });

  registerErrorHandling(app);

  void app.register(healthRoutes, { db });
  void app.register(endpointRoutes, { db, publicBaseUrl });
  void app.register(ingestRoutes, { db });

  return app;
}
