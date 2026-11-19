import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { RateLimits } from '../src/lib/rate-limit.js';
import { buildTestApp, createEndpoint, TEST_WEB_ORIGIN } from './helpers/app.js';
import { createTestDb, resetDb } from './helpers/db.js';

// Límites bajos para alcanzarlos rápido; cada describe arma su propia app porque las
// cuentas viven en la memoria de cada instancia.
const handle = createTestDb();
const apps: { close: () => Promise<unknown> }[] = [];

function appWith(rateLimits: Partial<RateLimits>) {
  const app = buildTestApp(handle.db, { rateLimits });
  apps.push(app);
  return app;
}

beforeEach(async () => {
  await resetDb(handle);
});

afterAll(async () => {
  await Promise.all(apps.map((app) => app.close()));
  await handle.pool.end();
});

const window = { timeWindowMs: 60_000 };

describe('creación de endpoints', () => {
  const app = appWith({ createEndpoint: { max: 2, ...window } });

  it('limita por IP y responde 429 con retry-after y con CORS', async () => {
    const create = () =>
      app.inject({ method: 'POST', url: '/api/endpoints', headers: { origin: TEST_WEB_ORIGIN } });
    expect((await create()).statusCode).toBe(201);
    expect((await create()).statusCode).toBe(201);

    const res = await create();

    expect(res.statusCode).toBe(429);
    expect(res.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    // Sin CORS en el 429, el navegador ocultaría el error y el front no podría mostrarlo.
    expect(res.headers['access-control-allow-origin']).toBe(TEST_WEB_ORIGIN);
  });

  it('cada IP tiene su propio contador', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/endpoints',
      remoteAddress: '203.0.113.7',
    });
    expect(res.statusCode).toBe(201);
  });
});

describe('ingesta', () => {
  const app = appWith({ ingest: { max: 3, ...window } });

  it('limita por slug, contando juntas /wh/:slug y /wh/:slug/*', async () => {
    const { slug } = await createEndpoint(app);
    const ok = await app.inject({ method: 'POST', url: `/wh/${slug}` });
    await app.inject({ method: 'POST', url: `/wh/${slug}/a` });
    await app.inject({ method: 'POST', url: `/wh/${slug}/b/c` });

    const res = await app.inject({ method: 'POST', url: `/wh/${slug}/d` });

    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
    // La respuesta configurada sale limpia: sin headers del rate limit.
    expect(Object.keys(ok.headers).filter((name) => name.startsWith('x-ratelimit'))).toEqual([]);
  });

  it('un slug saturado no afecta a otro', async () => {
    const flooded = await createEndpoint(app);
    const other = await createEndpoint(app);
    for (let i = 0; i < 4; i++) await app.inject({ method: 'POST', url: `/wh/${flooded.slug}` });

    expect((await app.inject({ method: 'POST', url: `/wh/${other.slug}` })).statusCode).toBe(200);
  });
});

describe('replay', () => {
  const app = appWith({ replay: { max: 1, ...window } });

  it('limita por token: capturar más requests no multiplica el límite', async () => {
    const owner = await createEndpoint(app);
    await app.inject({ method: 'POST', url: `/wh/${owner.slug}/1` });
    await app.inject({ method: 'POST', url: `/wh/${owner.slug}/2` });
    const list = await app.inject({
      method: 'GET',
      url: `/api/endpoints/${owner.slug}/requests`,
      headers: owner.auth,
    });
    const [first, second] = list.json<{ items: { id: string }[] }>().items;
    const replay = (id: string | undefined, auth = owner.auth) =>
      app.inject({
        method: 'POST',
        url: `/api/requests/${id ?? ''}/replays`,
        headers: auth,
        // El destino da igual: el límite se cuenta antes de validar nada.
        payload: { targetUrl: 'http://127.0.0.1/' },
      });

    expect((await replay(first?.id)).statusCode).toBe(422);
    expect((await replay(second?.id)).statusCode).toBe(429);

    const stranger = await createEndpoint(app);
    expect((await replay(first?.id, stranger.auth)).statusCode).toBe(404);
  });
});
