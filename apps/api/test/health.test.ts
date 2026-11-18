import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createDb } from '../src/db/client.js';
import { createTestDb } from './helpers/db.js';

describe('GET /health', () => {
  const handle = createTestDb();
  afterAll(() => handle.pool.end());

  it('responde 200 cuando la base de datos está disponible', async () => {
    const app = buildApp({ db: handle.db });

    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'up' });
    await app.close();
  });

  it('responde 503 cuando la base de datos no responde', async () => {
    // Puerto 1: conexión rechazada de inmediato.
    const unreachable = createDb('postgres://nadie:nada@127.0.0.1:1/nada');
    const app = buildApp({ db: unreachable.db });

    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ status: 'degraded', db: 'down' });
    await app.close();
    await unreachable.pool.end();
  });
});
