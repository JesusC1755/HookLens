import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { endpoints } from '../src/db/schema.js';
import { hashOwnerToken, SLUG_PATTERN } from '../src/lib/tokens.js';
import { buildTestApp, TEST_BASE_URL } from './helpers/app.js';
import { createTestDb, resetDb } from './helpers/db.js';

const handle = createTestDb();
const app = buildTestApp(handle.db);

beforeEach(() => resetDb(handle));
afterAll(async () => {
  await app.close();
  await handle.pool.end();
});

interface CreatedEndpointBody {
  slug: string;
  token: string;
  url: string;
  expiresAt: string;
}

describe('POST /api/endpoints', () => {
  it('crea un endpoint y devuelve slug, token, url y expiración', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/endpoints' });

    expect(res.statusCode).toBe(201);
    expect(res.headers['cache-control']).toBe('no-store');
    const body = res.json<CreatedEndpointBody>();
    expect(body.slug).toMatch(SLUG_PATTERN);
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.url).toBe(`${TEST_BASE_URL}/wh/${body.slug}`);
    const ttlDays = (Date.parse(body.expiresAt) - Date.now()) / 86_400_000;
    expect(ttlDays).toBeCloseTo(7, 2);
  });

  it('guarda solo el hash del token, nunca el token en claro', async () => {
    const body = (
      await app.inject({ method: 'POST', url: '/api/endpoints' })
    ).json<CreatedEndpointBody>();

    const [row] = await handle.db.select().from(endpoints).where(eq(endpoints.slug, body.slug));

    expect(row?.ownerTokenHash).toBe(hashOwnerToken(body.token));
    expect(JSON.stringify(row)).not.toContain(body.token);
  });

  it('genera slugs y tokens distintos en cada llamada', async () => {
    const [a, b] = await Promise.all([
      app.inject({ method: 'POST', url: '/api/endpoints' }),
      app.inject({ method: 'POST', url: '/api/endpoints' }),
    ]);

    expect(a.json<CreatedEndpointBody>().slug).not.toBe(b.json<CreatedEndpointBody>().slug);
    expect(a.json<CreatedEndpointBody>().token).not.toBe(b.json<CreatedEndpointBody>().token);
  });

  it('la API conserva su parser: un content-type desconocido responde 415', async () => {
    // Demuestra que el parser comodín de la ingesta no se filtra fuera de su plugin.
    const res = await app.inject({
      method: 'POST',
      url: '/api/endpoints',
      headers: { 'content-type': 'application/x-desconocido' },
      payload: 'x',
    });

    expect(res.statusCode).toBe(415);
    expect(res.json()).toMatchObject({ error: { code: 'FST_ERR_CTP_INVALID_MEDIA_TYPE' } });
  });
});
