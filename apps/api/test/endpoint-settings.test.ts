import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { ResponseConfig } from '../src/modules/endpoints/response-config.js';
import { DEFAULT_RETENTION } from '../src/modules/ingest/service.js';
import {
  buildTestApp,
  createEndpoint,
  TEST_BASE_URL,
  TEST_WEB_ORIGIN,
  type TestEndpoint,
} from './helpers/app.js';
import { createTestDb, resetDb } from './helpers/db.js';

const handle = createTestDb();
const app = buildTestApp(handle.db);

let owner: TestEndpoint;

beforeEach(async () => {
  await resetDb(handle);
  owner = await createEndpoint(app);
});

afterAll(async () => {
  await app.close();
  await handle.pool.end();
});

const validConfig: ResponseConfig = {
  status: 201,
  headers: { 'Content-Type': 'application/json', 'X-Request-Source': 'hooklens' },
  body: '{"recibido":true}',
  delayMs: 0,
};

function putResponse(endpoint: TestEndpoint, payload: unknown) {
  return app.inject({
    method: 'PUT',
    url: `/api/endpoints/${endpoint.slug}/response`,
    headers: endpoint.auth,
    payload: payload as Record<string, unknown>,
  });
}

describe('GET /api/endpoints/:slug', () => {
  it('devuelve el endpoint con su respuesta por defecto', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/endpoints/${owner.slug}`,
      headers: owner.auth,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      slug: owner.slug,
      url: `${TEST_BASE_URL}/wh/${owner.slug}`,
      response: { status: 200, headers: {}, body: '', delayMs: 0 },
      retention: DEFAULT_RETENTION,
    });
    expect(res.json()).not.toHaveProperty('ownerTokenHash');
  });

  it('exige el token del dueño', async () => {
    const intruder = await createEndpoint(app);

    const noToken = await app.inject({ method: 'GET', url: `/api/endpoints/${owner.slug}` });
    const foreign = await app.inject({
      method: 'GET',
      url: `/api/endpoints/${owner.slug}`,
      headers: intruder.auth,
    });

    expect(noToken.statusCode).toBe(401);
    expect(foreign.statusCode).toBe(403);
  });
});

describe('PUT /api/endpoints/:slug/response', () => {
  it('guarda la respuesta con los nombres de header en minúsculas', async () => {
    const res = await putResponse(owner, validConfig);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ...validConfig,
      headers: { 'content-type': 'application/json', 'x-request-source': 'hooklens' },
    });
  });

  it('la ingesta responde con lo configurado', async () => {
    await putResponse(owner, { ...validConfig, status: 418 });

    const res = await app.inject({ method: 'POST', url: `/wh/${owner.slug}` });

    expect(res.statusCode).toBe(418);
    expect(res.headers['content-type']).toBe('application/json');
    expect(res.headers['x-request-source']).toBe('hooklens');
    expect(res.body).toBe('{"recibido":true}');
  });

  it('reemplaza la configuración completa (PUT, no PATCH)', async () => {
    await putResponse(owner, validConfig);
    await putResponse(owner, { ...validConfig, headers: {} });

    const res = await app.inject({
      method: 'GET',
      url: `/api/endpoints/${owner.slug}`,
      headers: owner.auth,
    });

    expect(res.json<{ response: ResponseConfig }>().response.headers).toEqual({});
  });

  it.each([
    ['status 1xx (no es una respuesta final)', { status: 101 }],
    ['status fuera de rango', { status: 600 }],
    ['status no entero', { status: 200.5 }],
    ['retraso negativo', { delayMs: -1 }],
    ['retraso mayor a 10 s', { delayMs: 10_001 }],
    ['body demasiado grande', { body: 'x'.repeat(32 * 1024 + 1) }],
    ['nombre de header inválido', { headers: { 'x header': 'a' } }],
    ['valor con salto de línea (inyección)', { headers: { 'x-a': 'ok\r\nset-cookie: a=b' } }],
    [
      'más de 20 headers',
      { headers: Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`x-${i}`, 'v'])) },
    ],
  ])('responde 400 con %s', async (_case, override) => {
    const res = await putResponse(owner, { ...validConfig, ...override });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'VALIDATION_ERROR' } });
  });

  it.each(['Content-Length', 'transfer-encoding', 'Set-Cookie', 'content-security-policy'])(
    'no deja fijar el header %s',
    async (name) => {
      const res = await putResponse(owner, { ...validConfig, headers: { [name]: 'x' } });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ error: { code: 'HEADER_NOT_ALLOWED' } });
    },
  );

  it('rechaza el mismo header con distintas mayúsculas', async () => {
    const res = await putResponse(owner, {
      ...validConfig,
      headers: { 'X-Uno': 'a', 'x-uno': 'b' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'DUPLICATE_HEADER' } });
  });

  it('exige el token del dueño', async () => {
    const intruder = await createEndpoint(app);

    expect((await putResponse(intruder, validConfig)).statusCode).toBe(200);
    const res = await app.inject({
      method: 'PUT',
      url: `/api/endpoints/${owner.slug}/response`,
      headers: intruder.auth,
      payload: validConfig,
    });

    expect(res.statusCode).toBe(403);
  });

  it('el preflight de CORS permite PUT desde el front', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: `/api/endpoints/${owner.slug}/response`,
      headers: {
        origin: TEST_WEB_ORIGIN,
        'access-control-request-method': 'PUT',
        'access-control-request-headers': 'authorization,content-type',
      },
    });

    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-methods']).toContain('PUT');
  });
});
