import type { FastifyInstance } from 'fastify';
import { type AppOptions, buildApp } from '../../src/app.js';
import type { Database } from '../../src/db/client.js';

export const TEST_BASE_URL = 'http://hooklens.test';
export const TEST_WEB_ORIGIN = 'http://web.hooklens.test';

export function buildTestApp(db: Database, overrides: Partial<AppOptions> = {}) {
  return buildApp({
    db,
    publicBaseUrl: TEST_BASE_URL,
    corsOrigins: [TEST_WEB_ORIGIN],
    ...overrides,
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
