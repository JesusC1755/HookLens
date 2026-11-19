import type { FastifyInstance } from 'fastify';
import { type AppOptions, buildApp } from '../../src/app.js';
import type { Database } from '../../src/db/client.js';
import type { RateLimits } from '../../src/lib/rate-limit.js';

export const TEST_BASE_URL = 'http://hooklens.test';
export const TEST_WEB_ORIGIN = 'http://web.hooklens.test';

// Todos los tests salen de la misma IP y crean decenas de endpoints: con los límites de
// producción se cruzarían entre sí. Los tests de rate limit los bajan a propósito.
const GENEROUS = { max: 10_000, timeWindowMs: 60_000 };
export const TEST_RATE_LIMITS: RateLimits = {
  createEndpoint: GENEROUS,
  ingest: GENEROUS,
  replay: GENEROUS,
};

export function buildTestApp(db: Database, overrides: Partial<AppOptions> = {}) {
  return buildApp({
    db,
    publicBaseUrl: TEST_BASE_URL,
    corsOrigins: [TEST_WEB_ORIGIN],
    ...overrides,
    rateLimits: { ...TEST_RATE_LIMITS, ...overrides.rateLimits },
  });
}

export interface TestEndpoint {
  slug: string;
  token: string;
  auth: { authorization: string };
}

export async function createEndpoint(app: FastifyInstance): Promise<TestEndpoint> {
  const res = await app.inject({ method: 'POST', url: '/api/endpoints' });
  const { slug, token } = res.json<{ slug: string; token: string }>();
  return { slug, token, auth: { authorization: `Bearer ${token}` } };
}
