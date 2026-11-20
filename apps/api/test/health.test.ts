import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../src/db/client.js';
import { buildTestApp } from './helpers/app.js';
import { createTestDb, UNREACHABLE_DATABASE_URL } from './helpers/db.js';

describe('GET /health', () => {
  const handle = createTestDb();
  afterAll(() => handle.pool.end());

  it('responde 200 cuando la base de datos está disponible', async () => {
    const app = buildTestApp(handle.db);

    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'up' });
    await app.close();
  });

  it('responde 503 cuando la base de datos no responde', async () => {
    const unreachable = createDb(UNREACHABLE_DATABASE_URL);
    const app = buildTestApp(unreachable.db);

    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'degraded', db: 'down' });
    await app.close();
    await unreachable.pool.end();
  });
});

describe('GET /health/live', () => {
  it('responde 200 sin consultar la base, aunque esté caída', async () => {
    const unreachable = createDb(UNREACHABLE_DATABASE_URL);
    const app = buildTestApp(unreachable.db);

    const res = await app.inject({ method: 'GET', url: '/health/live' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    expect(unreachable.pool.totalCount).toBe(0);
    await app.close();
    await unreachable.pool.end();
  });
});
