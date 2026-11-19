import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { endpoints } from '../src/db/schema.js';
import { createMemoryPubSub } from '../src/lib/pubsub.js';
import type { EndpointEvent } from '../src/modules/requests/events.js';
import type { RequestSummary } from '../src/modules/requests/serializers.js';
import { MAX_STREAMS_PER_ENDPOINT } from '../src/modules/stream/routes.js';
import { buildTestApp, createEndpoint, TEST_WEB_ORIGIN, type TestEndpoint } from './helpers/app.js';
import { createTestDb, resetDb } from './helpers/db.js';
import { openSseReader, waitFor } from './helpers/sse.js';

// El stream se prueba sobre un socket real: inject() espera a que la respuesta
// termine, y un stream SSE no termina.
const handle = createTestDb();
const bus = createMemoryPubSub<EndpointEvent>();
let app: FastifyInstance;
let baseUrl: string;
let owner: TestEndpoint;
// Cierra los streams que abrió cada test, para que no se acumulen suscripciones.
const cleanups: (() => Promise<unknown>)[] = [];

beforeAll(async () => {
  app = buildTestApp(handle.db, { bus });
  baseUrl = await app.listen({ host: '127.0.0.1', port: 0 });
});

beforeEach(async () => {
  await resetDb(handle);
  owner = await createEndpoint(app);
});

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

afterAll(async () => {
  await app.close();
  await handle.pool.end();
});

async function openStream(endpoint: TestEndpoint, headers: Record<string, string> = {}) {
  const res = await fetch(`${baseUrl}/api/endpoints/${endpoint.slug}/stream`, {
    headers: { ...endpoint.auth, ...headers },
  });
  // Si un lector tomó el body, el lector se encarga de cancelarlo.
  cleanups.push(async () => {
    if (res.body && !res.body.locked) await res.body.cancel();
  });
  return res;
}

async function connect(endpoint: TestEndpoint) {
  const res = await openStream(endpoint);
  if (!res.body) throw new Error('respuesta sin body');
  const events = openSseReader(res.body);
  cleanups.push(events.cancel);
  expect(await events.next()).toMatchObject({ event: 'ready' });
  return events;
}

function ingest(slug: string, path = '') {
  return fetch(`${baseUrl}/wh/${slug}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"evento":"push"}',
  });
}

describe('GET /api/endpoints/:slug/stream', () => {
  it('abre un stream SSE con los headers correctos', async () => {
    const res = await openStream(owner, { origin: TEST_WEB_ORIGIN });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-cache, no-transform');
    // Los headers de CORS sobreviven al hijack.
    expect(res.headers.get('access-control-allow-origin')).toBe(TEST_WEB_ORIGIN);
  });

  it('emite cada request ingresada como resumen, sin body', async () => {
    const events = await connect(owner);

    await ingest(owner.slug, '/github');
    const event = await events.next();

    expect(event.event).toBe('request');
    const summary = JSON.parse(event.data) as RequestSummary;
    expect(summary).toMatchObject({
      method: 'POST',
      path: '/github',
      contentType: 'application/json',
    });
    expect(event.id).toBe(summary.id);
    expect(summary).not.toHaveProperty('body');
  });

  it('no recibe requests de otros endpoints', async () => {
    const other = await createEndpoint(app);
    const events = await connect(owner);

    await ingest(other.slug, '/ajena');
    await ingest(owner.slug, '/propia');

    expect(JSON.parse((await events.next()).data)).toMatchObject({ path: '/propia' });
  });

  it('avisa con `cleared` cuando se vacían las requests del endpoint', async () => {
    const events = await connect(owner);

    const res = await fetch(`${baseUrl}/api/endpoints/${owner.slug}/requests`, {
      method: 'DELETE',
      headers: owner.auth,
    });

    expect(res.status).toBe(200);
    expect(await events.next()).toMatchObject({ event: 'cleared', data: '{}' });
  });

  it('avisa con `expired` y cierra el stream cuando vence el endpoint', async () => {
    await handle.db
      .update(endpoints)
      .set({ expiresAt: new Date(Date.now() + 300) })
      .where(eq(endpoints.slug, owner.slug));
    const events = await connect(owner);

    expect(await events.next(2_000)).toMatchObject({ event: 'expired' });
    await expect(events.next()).rejects.toThrow('el stream SSE se cerró');
    await waitFor(() => bus.subscriberCount(owner.slug) === 0);
  });

  it('al desconectarse el cliente se libera la suscripción', async () => {
    const events = await connect(owner);
    expect(bus.subscriberCount(owner.slug)).toBe(1);

    await events.cancel();

    await waitFor(() => bus.subscriberCount(owner.slug) === 0);
  });

  it(`rechaza con 429 más de ${MAX_STREAMS_PER_ENDPOINT} streams por endpoint`, async () => {
    for (let i = 0; i < MAX_STREAMS_PER_ENDPOINT; i++) await connect(owner);

    const res = await openStream(owner);

    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: { code: 'TOO_MANY_STREAMS' } });
  });

  it('responde 401 sin token, antes de abrir el stream', async () => {
    const res = await fetch(`${baseUrl}/api/endpoints/${owner.slug}/stream`);

    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/json');
  });
});

describe('apagado con streams abiertos', () => {
  it('app.close() cierra los streams y termina', async () => {
    const local = buildTestApp(handle.db);
    const url = await local.listen({ host: '127.0.0.1', port: 0 });
    const endpoint = await createEndpoint(local);
    const res = await fetch(`${url}/api/endpoints/${endpoint.slug}/stream`, {
      headers: endpoint.auth,
    });
    if (!res.body) throw new Error('respuesta sin body');
    const events = openSseReader(res.body);
    await events.next();

    const closed = await Promise.race([
      local.close().then(() => 'cerrado'),
      new Promise((resolve) => {
        setTimeout(() => {
          resolve('colgado');
        }, 3_000);
      }),
    ]);

    expect(closed).toBe('cerrado');
    await expect(events.next()).rejects.toThrow('el stream SSE se cerró');
  });
});
