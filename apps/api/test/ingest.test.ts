import { desc, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createDb } from '../src/db/client.js';
import { endpoints, requests } from '../src/db/schema.js';
import { INGEST_BODY_LIMIT_BYTES } from '../src/modules/ingest/routes.js';
import { buildTestApp, TEST_BASE_URL } from './helpers/app.js';
import { createTestDb, resetDb, UNREACHABLE_DATABASE_URL } from './helpers/db.js';

const handle = createTestDb();
const { db } = handle;
const app = buildTestApp(db);

let slug: string;

beforeEach(async () => {
  await resetDb(handle);
  const res = await app.inject({ method: 'POST', url: '/api/endpoints' });
  slug = res.json<{ slug: string }>().slug;
});

afterAll(async () => {
  await app.close();
  await handle.pool.end();
});

async function lastRequest() {
  const [row] = await db.select().from(requests).orderBy(desc(requests.receivedAt)).limit(1);
  if (!row) throw new Error('no se guardó ninguna request');
  return row;
}

describe('ingesta: body crudo', () => {
  it('guarda un JSON byte a byte, con espacios y orden de claves originales', async () => {
    const payload = '{ "b" : 2,\n  "a": 1 }\n';

    const res = await app.inject({
      method: 'POST',
      url: `/wh/${slug}`,
      headers: { 'content-type': 'application/json; charset=utf-8' },
      payload,
    });

    expect(res.statusCode).toBe(200);
    const stored = await lastRequest();
    expect(stored.body?.equals(Buffer.from(payload))).toBe(true);
    expect(stored.contentType).toBe('application/json; charset=utf-8');
    expect(stored.sizeBytes).toBe(Buffer.byteLength(payload));
  });

  it('guarda un body binario no UTF-8 sin alterarlo', async () => {
    const payload = Buffer.from([0x00, 0xff, 0xfe, 0x80, 0xc3, 0x28]);

    await app.inject({
      method: 'POST',
      url: `/wh/${slug}`,
      headers: { 'content-type': 'application/octet-stream' },
      payload,
    });

    expect((await lastRequest()).body?.equals(payload)).toBe(true);
  });

  it('guarda form-urlencoded en crudo, sin parsearlo', async () => {
    const payload = 'payload=%7B%22a%22%3A1%7D&b=2';

    await app.inject({
      method: 'POST',
      url: `/wh/${slug}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload,
    });

    expect((await lastRequest()).body?.toString()).toBe(payload);
  });

  it('acepta un content-type malformado en lugar de responder 415', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/wh/${slug}`,
      headers: { 'content-type': 'esto no es un media type' },
      payload: 'hola',
    });

    expect(res.statusCode).toBe(200);
    const stored = await lastRequest();
    expect(stored.contentType).toBe('esto no es un media type');
    expect(stored.headers['content-type']).toEqual(['esto no es un media type']);
    expect(stored.body?.toString()).toBe('hola');
  });

  it('acepta un body sin content-type', async () => {
    const res = await app.inject({ method: 'POST', url: `/wh/${slug}`, payload: 'sin tipo' });

    expect(res.statusCode).toBe(200);
    const stored = await lastRequest();
    expect(stored.contentType).toBeNull();
    expect(stored.body?.toString()).toBe('sin tipo');
  });

  it('guarda body null y tamaño 0 cuando no hay body', async () => {
    await app.inject({ method: 'POST', url: `/wh/${slug}` });

    expect(await lastRequest()).toMatchObject({ body: null, sizeBytes: 0 });
  });
});

describe('ingesta: método, path, query, headers e IP', () => {
  it.each(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const)(
    'acepta %s',
    async (method) => {
      const res = await app.inject({ method, url: `/wh/${slug}/x` });

      expect(res.statusCode).toBe(200);
      expect((await lastRequest()).method).toBe(method);
    },
  );

  it.each([
    ['', '/'],
    ['/', '/'],
    ['/github/push', '/github/push'],
    ['/a%20b/c', '/a%20b/c'],
  ])('sufijo "%s" se guarda como path %s', async (suffix, path) => {
    await app.inject({ method: 'POST', url: `/wh/${slug}${suffix}` });

    expect((await lastRequest()).path).toBe(path);
  });

  it('conserva el query crudo y las claves repetidas', async () => {
    await app.inject({ method: 'POST', url: `/wh/${slug}/hook?b=2&a=1&a=3&q=%C3%B1` });

    expect(await lastRequest()).toMatchObject({
      rawQuery: 'b=2&a=1&a=3&q=%C3%B1',
      query: { b: ['2'], a: ['1', '3'], q: ['ñ'] },
    });
  });

  it('conserva headers repetidos como valores separados', async () => {
    await app.inject({
      method: 'POST',
      url: `/wh/${slug}`,
      headers: { 'X-Hook-Event': 'push', 'x-dup': ['uno', 'dos'] },
    });

    const { headers } = await lastRequest();
    expect(headers['x-hook-event']).toEqual(['push']);
    expect(headers['x-dup']).toEqual(['uno', 'dos']);
  });

  it('sin proxies de confianza ignora X-Forwarded-For', async () => {
    await app.inject({
      method: 'POST',
      url: `/wh/${slug}`,
      headers: { 'x-forwarded-for': '203.0.113.9' },
      remoteAddress: '198.51.100.4',
    });

    expect((await lastRequest()).ip).toBe('198.51.100.4');
  });

  it.each([
    ['viene del proxy de confianza', '10.0.0.2', '203.0.113.9'],
    ['no viene del proxy de confianza', '198.51.100.4', '198.51.100.4'],
  ])('X-Forwarded-For solo se usa si la conexión %s', async (_case, peer, expectedIp) => {
    const proxied = buildApp({ db, publicBaseUrl: TEST_BASE_URL, trustProxy: ['10.0.0.0/8'] });

    await proxied.inject({
      method: 'POST',
      url: `/wh/${slug}`,
      headers: { 'x-forwarded-for': '203.0.113.9' },
      remoteAddress: peer,
    });

    expect((await lastRequest()).ip).toBe(expectedIp);
    await proxied.close();
  });
});

describe('ingesta: límite de 1 MB', () => {
  it('acepta exactamente 1 MB', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/wh/${slug}`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.alloc(INGEST_BODY_LIMIT_BYTES),
    });

    expect(res.statusCode).toBe(200);
    expect((await lastRequest()).sizeBytes).toBe(INGEST_BODY_LIMIT_BYTES);
  });

  it('rechaza 1 MB + 1 byte con 413 y no guarda nada', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/wh/${slug}`,
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.alloc(INGEST_BODY_LIMIT_BYTES + 1),
    });

    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ error: { code: 'FST_ERR_CTP_BODY_TOO_LARGE' } });
    expect(await db.$count(requests)).toBe(0);
  });
});

describe('ingesta: endpoint y respuesta', () => {
  it.each([
    ['inexistente con formato válido', 'zzzzzzzzzzzz'],
    ['con formato inválido', 'NO-ES-UN-SLUG'],
  ])('responde 404 para un slug %s', async (_case, unknown) => {
    const res = await app.inject({ method: 'POST', url: `/wh/${unknown}` });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'ENDPOINT_NOT_FOUND' } });
  });

  it('responde 410 si el endpoint expiró y no guarda la request', async () => {
    await db
      .update(endpoints)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(endpoints.slug, slug));

    const res = await app.inject({ method: 'POST', url: `/wh/${slug}` });

    expect(res.statusCode).toBe(410);
    expect(res.json()).toMatchObject({ error: { code: 'ENDPOINT_EXPIRED' } });
    expect(await db.$count(requests)).toBe(0);
  });

  it('responde con el status, los headers y el body configurados', async () => {
    await db
      .update(endpoints)
      .set({ respStatus: 202, respHeaders: { 'x-hooklens': 'ok' }, respBody: 'aceptado' })
      .where(eq(endpoints.slug, slug));

    const res = await app.inject({ method: 'POST', url: `/wh/${slug}` });

    expect(res.statusCode).toBe(202);
    expect(res.headers['x-hooklens']).toBe('ok');
    expect(res.body).toBe('aceptado');
  });

  it('aísla la respuesta configurada: un HTML no se ejecuta en el dominio del API', async () => {
    await db
      .update(endpoints)
      .set({
        // Aunque llegara a la base sin pasar por la API de gestión, no se puede pisar la CSP.
        respHeaders: { 'content-type': 'text/html', 'content-security-policy': 'default-src *' },
        respBody: '<script>alert(1)</script>',
      })
      .where(eq(endpoints.slug, slug));

    const res = await app.inject({ method: 'GET', url: `/wh/${slug}` });

    expect(res.headers['content-type']).toBe('text/html');
    expect(res.headers['content-security-policy']).toBe('sandbox');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('sin content-type configurado responde texto plano', async () => {
    const res = await app.inject({ method: 'POST', url: `/wh/${slug}` });

    expect(res.headers['content-type']).toBe('text/plain; charset=utf-8');
    expect(res.body).toBe('');
  });

  it('aplica el retraso configurado y guarda la request antes de responder', async () => {
    await db.update(endpoints).set({ respDelayMs: 300 }).where(eq(endpoints.slug, slug));

    const startedAt = Date.now();
    const pending = app.inject({ method: 'POST', url: `/wh/${slug}` });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const countDuringDelay = await db.$count(requests);
    const res = await pending;

    expect(countDuringDelay).toBe(1);
    expect(res.statusCode).toBe(200);
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(300);
  });

  it('responde 503 si la base de datos no está disponible', async () => {
    const unreachable = createDb(UNREACHABLE_DATABASE_URL);
    const broken = buildTestApp(unreachable.db);

    const res = await broken.inject({ method: 'POST', url: `/wh/${slug}` });

    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: { code: 'DATABASE_UNAVAILABLE' } });
    await broken.close();
    await unreachable.pool.end();
  });
});
