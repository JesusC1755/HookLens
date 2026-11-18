import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { endpoints, requests } from '../src/db/schema.js';
import type { RequestDetail, RequestSummary } from '../src/modules/requests/serializers.js';
import { buildTestApp, createEndpoint, TEST_WEB_ORIGIN, type TestEndpoint } from './helpers/app.js';
import { createTestDb, resetDb } from './helpers/db.js';

const handle = createTestDb();
const { db } = handle;
const app = buildTestApp(db);

let owner: TestEndpoint;

beforeEach(async () => {
  await resetDb(handle);
  owner = await createEndpoint(app);
});

afterAll(async () => {
  await app.close();
  await handle.pool.end();
});

interface Page {
  items: RequestSummary[];
  nextCursor: string | null;
}

async function ingest(slug: string, payload = 'x', url = '') {
  const res = await app.inject({
    method: 'POST',
    url: `/wh/${slug}${url}`,
    headers: { 'content-type': 'text/plain' },
    payload,
  });
  expect(res.statusCode).toBe(200);
}

async function endpointId(slug: string): Promise<string> {
  const [row] = await db
    .select({ id: endpoints.id })
    .from(endpoints)
    .where(eq(endpoints.slug, slug));
  if (!row) throw new Error(`no existe el endpoint ${slug}`);
  return row.id;
}

function listPage(endpoint: TestEndpoint, query = '') {
  return app.inject({
    method: 'GET',
    url: `/api/endpoints/${endpoint.slug}/requests${query}`,
    headers: endpoint.auth,
  });
}

describe('GET /api/endpoints/:slug/requests', () => {
  it('lista de la más reciente a la más antigua, sin body ni headers', async () => {
    await ingest(owner.slug, 'primera', '/1');
    await ingest(owner.slug, 'segunda', '/2');

    const res = await listPage(owner);

    expect(res.statusCode).toBe(200);
    const page = res.json<Page>();
    expect(page.items.map((item) => item.path)).toEqual(['/2', '/1']);
    expect(page.nextCursor).toBeNull();
    expect(Object.keys(page.items[0] ?? {}).sort()).toEqual(
      ['contentType', 'id', 'ip', 'method', 'path', 'rawQuery', 'receivedAt', 'sizeBytes'].sort(),
    );
  });

  it('pagina con cursor sin saltos ni duplicados, aunque lleguen requests nuevas', async () => {
    for (let i = 1; i <= 5; i++) await ingest(owner.slug, 'x', `/${i}`);

    const first = (await listPage(owner, '?limit=2')).json<Page>();
    // Una request que llega mientras el usuario pagina no desplaza las páginas siguientes.
    await ingest(owner.slug, 'x', '/nueva');
    const second = (
      await listPage(owner, `?limit=2&cursor=${first.nextCursor ?? ''}`)
    ).json<Page>();
    const third = (
      await listPage(owner, `?limit=2&cursor=${second.nextCursor ?? ''}`)
    ).json<Page>();

    expect(first.items.map((i) => i.path)).toEqual(['/5', '/4']);
    expect(second.items.map((i) => i.path)).toEqual(['/3', '/2']);
    expect(third.items.map((i) => i.path)).toEqual(['/1']);
    expect(third.nextCursor).toBeNull();
  });

  it('desempata por id cuando varias requests comparten received_at', async () => {
    const id = await endpointId(owner.slug);
    const receivedAt = new Date('2026-11-18T12:00:00.000Z');
    await db.insert(requests).values(
      ['/a', '/b', '/c', '/d'].map((path) => ({
        endpointId: id,
        method: 'POST',
        path,
        headers: {},
        sizeBytes: 0,
        receivedAt,
      })),
    );

    const seen: string[] = [];
    let cursor = '';
    do {
      const page = (
        await listPage(owner, `?limit=1${cursor ? `&cursor=${cursor}` : ''}`)
      ).json<Page>();
      seen.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor ?? '';
    } while (cursor);

    expect(seen).toHaveLength(4);
    expect(new Set(seen).size).toBe(4);
  });

  it('solo devuelve las requests del propio endpoint', async () => {
    const other = await createEndpoint(app);
    await ingest(other.slug);
    await ingest(owner.slug);

    expect((await listPage(owner)).json<Page>().items).toHaveLength(1);
  });

  it.each([
    ['límite mayor a 100', '?limit=101'],
    ['límite 0', '?limit=0'],
    ['límite no numérico', '?limit=diez'],
  ])('responde 400 con %s', async (_case, query) => {
    expect((await listPage(owner, query)).statusCode).toBe(400);
  });

  it('responde 400 con un cursor manipulado', async () => {
    const res = await listPage(owner, '?cursor=manipulado');

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: { code: 'INVALID_CURSOR' } });
  });
});

describe('DELETE /api/endpoints/:slug/requests', () => {
  function clear(endpoint: TestEndpoint) {
    return app.inject({
      method: 'DELETE',
      url: `/api/endpoints/${endpoint.slug}/requests`,
      headers: endpoint.auth,
    });
  }

  it('vacía las requests del endpoint y dice cuántas borró', async () => {
    await ingest(owner.slug);
    await ingest(owner.slug);

    const res = await clear(owner);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ deleted: 2 });
    expect((await listPage(owner)).json<Page>().items).toHaveLength(0);
  });

  it('no toca las requests de otros endpoints', async () => {
    const other = await createEndpoint(app);
    await ingest(other.slug);

    await clear(owner);

    expect((await listPage(other)).json<Page>().items).toHaveLength(1);
  });

  it('responde 403 con el token de otro endpoint, sin borrar nada', async () => {
    await ingest(owner.slug);
    const intruder = await createEndpoint(app);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/endpoints/${owner.slug}/requests`,
      headers: intruder.auth,
    });

    expect(res.statusCode).toBe(403);
    expect((await listPage(owner)).json<Page>().items).toHaveLength(1);
  });
});

describe('autorización de la API de gestión', () => {
  it('responde 401 sin token', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/endpoints/${owner.slug}/requests` });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'MISSING_TOKEN' } });
  });

  it('responde 403 con el token de otro endpoint', async () => {
    const intruder = await createEndpoint(app);

    const res = await app.inject({
      method: 'GET',
      url: `/api/endpoints/${owner.slug}/requests`,
      headers: intruder.auth,
    });

    expect(res.statusCode).toBe(403);
  });

  it('responde 404 si el endpoint no existe', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/endpoints/zzzzzzzzzzzz/requests',
      headers: owner.auth,
    });

    expect(res.statusCode).toBe(404);
  });

  it('responde 410 si el endpoint expiró', async () => {
    await db
      .update(endpoints)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(endpoints.slug, owner.slug));

    expect((await listPage(owner)).statusCode).toBe(410);
  });
});

describe('GET /api/requests/:id', () => {
  async function firstRequestId(endpoint: TestEndpoint): Promise<string> {
    const id = (await listPage(endpoint)).json<Page>().items[0]?.id;
    if (!id) throw new Error('no hay requests');
    return id;
  }

  it('devuelve el detalle completo con el body en base64', async () => {
    const payload = Buffer.from([0x00, 0xff, 0x7b, 0x22]);
    await app.inject({
      method: 'PUT',
      url: `/wh/${owner.slug}/hook?a=1&a=2`,
      headers: { 'content-type': 'application/octet-stream', 'x-dup': ['1', '2'] },
      payload,
    });
    const id = await firstRequestId(owner);

    const res = await app.inject({
      method: 'GET',
      url: `/api/requests/${id}`,
      headers: owner.auth,
    });

    expect(res.statusCode).toBe(200);
    const detail = res.json<RequestDetail>();
    expect(detail).toMatchObject({
      id,
      method: 'PUT',
      path: '/hook',
      rawQuery: 'a=1&a=2',
      query: { a: ['1', '2'] },
      contentType: 'application/octet-stream',
      sizeBytes: 4,
    });
    expect(detail.headers['x-dup']).toEqual(['1', '2']);
    expect(Buffer.from(detail.body ?? '', 'base64').equals(payload)).toBe(true);
    expect(detail).not.toHaveProperty('endpointId');
  });

  it('devuelve body null cuando la request no tenía body', async () => {
    await app.inject({ method: 'GET', url: `/wh/${owner.slug}` });
    const id = await firstRequestId(owner);

    const res = await app.inject({
      method: 'GET',
      url: `/api/requests/${id}`,
      headers: owner.auth,
    });

    expect(res.json<RequestDetail>().body).toBeNull();
  });

  it('con el token de otro endpoint responde 404, sin confirmar que el id existe', async () => {
    await ingest(owner.slug);
    const id = await firstRequestId(owner);
    const intruder = await createEndpoint(app);

    const res = await app.inject({
      method: 'GET',
      url: `/api/requests/${id}`,
      headers: intruder.auth,
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ error: { code: 'REQUEST_NOT_FOUND' } });
  });

  it('responde 401 sin token y 400 con un id que no es uuid', async () => {
    const noToken = await app.inject({
      method: 'GET',
      url: '/api/requests/0b8f7f7e-4d5c-4b9a-9a7e-2f1c3d4e5f60',
    });
    const badId = await app.inject({
      method: 'GET',
      url: '/api/requests/123',
      headers: owner.auth,
    });

    expect(noToken.statusCode).toBe(401);
    expect(badId.statusCode).toBe(400);
  });
});

describe('CORS', () => {
  function preflight(url: string, origin: string) {
    return app.inject({
      method: 'OPTIONS',
      url,
      headers: {
        origin,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization',
      },
    });
  }

  it('autoriza el origen del front en /api', async () => {
    const res = await preflight(`/api/endpoints/${owner.slug}/requests`, TEST_WEB_ORIGIN);

    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(TEST_WEB_ORIGIN);
    expect(res.headers['access-control-allow-headers']).toContain('authorization');
  });

  it('no autoriza otros orígenes', async () => {
    const res = await preflight(`/api/endpoints/${owner.slug}/requests`, 'https://malicioso.test');

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('no intercepta los OPTIONS de la ingesta: se guardan como cualquier request', async () => {
    const res = await preflight(`/wh/${owner.slug}`, TEST_WEB_ORIGIN);

    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect((await listPage(owner)).json<Page>().items[0]?.method).toBe('OPTIONS');
  });
});
