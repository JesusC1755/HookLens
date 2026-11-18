import cors from '@fastify/cors';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Database } from './db/client.js';
import { registerErrorHandling } from './lib/errors.js';
import { createMemoryPubSub } from './lib/pubsub.js';
import { endpointRoutes } from './modules/endpoints/routes.js';
import { ingestRoutes } from './modules/ingest/routes.js';
import { requestRoutes } from './modules/requests/routes.js';
import type { RequestBus, RequestSummary } from './modules/requests/serializers.js';
import { streamRoutes } from './modules/stream/routes.js';
import { healthRoutes } from './routes/health.js';

// Límite para la API de gestión; la ingesta define el suyo (1 MB) en su plugin.
const API_BODY_LIMIT_BYTES = 64 * 1024;

export interface AppOptions {
  db: Database;
  publicBaseUrl: string;
  /** IPs, CIDR o alias de los proxies de confianza; vacío = no confiar en X-Forwarded-For. */
  trustProxy?: string[];
  /** Orígenes del front autorizados por CORS en /api. */
  corsOrigins?: string[];
  /** Por defecto, en memoria. Se inyecta para escalar (Redis) o en los tests. */
  bus?: RequestBus;
  logger?: FastifyServerOptions['logger'];
}

/** Construye la app sin escuchar en un puerto: los tests la usan con app.inject(). */
export function buildApp({
  db,
  publicBaseUrl,
  trustProxy = [],
  corsOrigins = [],
  bus,
  logger = false,
}: AppOptions): FastifyInstance {
  const app = Fastify({
    logger,
    bodyLimit: API_BODY_LIMIT_BYTES,
    trustProxy: trustProxy.length > 0 ? trustProxy : false,
  });

  const requestBus =
    bus ??
    createMemoryPubSub<RequestSummary>((err) => {
      app.log.error({ err }, 'un suscriptor del bus de requests falló');
    });

  registerErrorHandling(app);

  void app.register(healthRoutes, { db });

  // CORS encapsulado en la API de gestión. Si fuera global, su manejo de preflight
  // interceptaría los OPTIONS que llegan a la ingesta, que deben guardarse como cualquier request.
  void app.register(async (api) => {
    await api.register(cors, {
      origin: corsOrigins.length > 0 ? corsOrigins : false,
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      allowedHeaders: ['authorization', 'content-type'],
      maxAge: 600,
    });
    await api.register(endpointRoutes, { db, publicBaseUrl });
    await api.register(requestRoutes, { db });
    await api.register(streamRoutes, { db, bus: requestBus });
  });

  void app.register(ingestRoutes, { db, bus: requestBus });

  return app;
}
