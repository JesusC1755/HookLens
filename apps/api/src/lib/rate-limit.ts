import { createHash } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { AppError } from './errors.js';

export interface Limit {
  max: number;
  timeWindowMs: number;
}

/**
 * Capas de protección: crear endpoints se limita por IP (sin cuenta, es la puerta de
 * entrada), la ingesta por slug (es pública) y el replay por token (el servidor no debe
 * servir de proxy gratis). Las cuentas viven en memoria por proceso; con varias
 * instancias, el plugin acepta Redis sin cambiar nada más.
 */
export interface RateLimits {
  createEndpoint: Limit;
  ingest: Limit;
  replay: Limit;
}

const MINUTE_MS = 60_000;

export const DEFAULT_RATE_LIMITS: RateLimits = {
  createEndpoint: { max: 10, timeWindowMs: 60 * MINUTE_MS },
  ingest: { max: 120, timeWindowMs: MINUTE_MS },
  replay: { max: 30, timeWindowMs: MINUTE_MS },
};

export function rateLimitError(_request: FastifyRequest, context: { ttl: number }): AppError {
  const seconds = Math.max(1, Math.ceil(context.ttl / 1000));
  const wait = seconds < 120 ? `${seconds} s` : `${Math.ceil(seconds / 60)} min`;
  return new AppError(429, 'RATE_LIMITED', `Demasiadas solicitudes: vuelve a intentar en ${wait}`);
}

/** Clave del replay: el hash del token (nunca el token en claro en memoria) o la IP. */
export function tokenOrIpKey(request: FastifyRequest): string {
  const authorization = request.headers.authorization;
  return authorization === undefined
    ? `ip:${request.ip}`
    : `token:${createHash('sha256').update(authorization).digest('hex')}`;
}
