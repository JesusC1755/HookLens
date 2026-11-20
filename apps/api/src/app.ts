import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Database } from './db/client.js';
import { registerErrorHandling } from './lib/errors.js';
import { createMemoryPubSub } from './lib/pubsub.js';
import { DEFAULT_RATE_LIMITS, type RateLimits, rateLimitError } from './lib/rate-limit.js';
import { endpointRoutes } from './modules/endpoints/routes.js';
import { ingestRoutes } from './modules/ingest/routes.js';
import { DEFAULT_RETENTION, type Retention } from './modules/ingest/service.js';
import { replayRoutes } from './modules/replays/routes.js';
import { type AddressPolicy, isPublicAddress } from './modules/replays/ssrf.js';
import { requestRoutes } from './modules/requests/routes.js';
import type { EndpointBus, EndpointEvent } from './modules/requests/events.js';
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
  bus?: EndpointBus;
  /**
   * Solo para tests: permite apuntar el replay a un servidor local. No se expone
   * por variable de entorno, así que en producción no hay forma de desactivar la protección SSRF.
   */
  replay?: { isAllowedAddress?: AddressPolicy; timeoutMs?: number };
  /** Solo para tests: los tests crean decenas de endpoints desde la misma IP. */
  rateLimits?: Partial<RateLimits>;
  /** Cuántas requests guarda cada endpoint; las más antiguas se borran al llegar nuevas. */
  retention?: Retention;
  logger?: FastifyServerOptions['logger'];
}

const REPLAY_TIMEOUT_MS = 10_000;

/** Construye la app sin escuchar en un puerto: los tests la usan con app.inject(). */
export function buildApp({
  db,
  publicBaseUrl,
  trustProxy = [],
  corsOrigins = [],
  bus,
  replay = {},
  rateLimits: rateLimitOverrides = {},
  retention = DEFAULT_RETENTION,
  logger = false,
}: AppOptions): FastifyInstance {
  const rateLimits: RateLimits = { ...DEFAULT_RATE_LIMITS, ...rateLimitOverrides };
  const app = Fastify({
    logger,
    bodyLimit: API_BODY_LIMIT_BYTES,
    trustProxy: trustProxy.length > 0 ? trustProxy : false,
  });

  const endpointBus =
    bus ??
    createMemoryPubSub<EndpointEvent>((err) => {
      app.log.error({ err }, 'un suscriptor del bus de eventos falló');
    });

  registerErrorHandling(app);

  // Antes que las rutas: el plugin engancha cada ruta que declare `config.rateLimit`
  // al registrarse. Sin límite global; cada ruta elige el suyo.
  void app.register(rateLimit, { global: false, errorResponseBuilder: rateLimitError });

  void app.register(healthRoutes, { db });

  // CORS encapsulado en la API de gestión. Si fuera global, su manejo de preflight
  // interceptaría los OPTIONS que llegan a la ingesta, que deben guardarse como cualquier request.
  void app.register(async (api) => {
    await api.register(cors, {
      origin: corsOrigins.length > 0 ? corsOrigins : false,
      methods: ['GET', 'POST', 'PUT', 'DELETE'],
      allowedHeaders: ['authorization', 'content-type'],
      maxAge: 600,
    });
    await api.register(endpointRoutes, {
      db,
      publicBaseUrl,
      createLimit: rateLimits.createEndpoint,
      retention,
    });
    await api.register(requestRoutes, { db, bus: endpointBus });
    await api.register(streamRoutes, { db, bus: endpointBus });
    await api.register(replayRoutes, {
      db,
      isAllowedAddress: replay.isAllowedAddress ?? isPublicAddress,
      timeoutMs: replay.timeoutMs ?? REPLAY_TIMEOUT_MS,
      limit: rateLimits.replay,
    });
  });

  void app.register(ingestRoutes, {
    db,
    bus: endpointBus,
    limit: rateLimits.ingest,
    retention,
  });

  return app;
}
