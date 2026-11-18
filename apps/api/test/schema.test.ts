import { createHash, randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { endpoints, replays, requests } from '../src/db/schema.js';
import { createTestDb, resetDb } from './helpers/db.js';

const handle = createTestDb();
const { db } = handle;

const CHECK_VIOLATION = '23514';

async function insertEndpoint(overrides: Partial<typeof endpoints.$inferInsert> = {}) {
  const [endpoint] = await db
    .insert(endpoints)
    .values({
      slug: randomBytes(8).toString('hex'),
      ownerTokenHash: createHash('sha256').update(randomBytes(32)).digest('hex'),
      ...overrides,
    })
    .returning();
  if (!endpoint) throw new Error('no se insertó el endpoint');
  return endpoint;
}

async function insertRequest(endpointId: string, body: Buffer | null = null) {
  const [request] = await db
    .insert(requests)
    .values({
      endpointId,
      method: 'POST',
      path: '/github',
      headers: { 'content-type': ['application/octet-stream'] },
      body,
      sizeBytes: body?.length ?? 0,
    })
    .returning();
  if (!request) throw new Error('no se insertó la request');
  return request;
}

beforeEach(() => resetDb(handle));
afterAll(() => handle.pool.end());

describe('endpoints', () => {
  it('aplica los valores por defecto y expira a los 7 días', async () => {
    const endpoint = await insertEndpoint();

    expect(endpoint).toMatchObject({
      respStatus: 200,
      respHeaders: {},
      respBody: '',
      respDelayMs: 0,
    });
    const ttlDays = (endpoint.expiresAt.getTime() - endpoint.createdAt.getTime()) / 86_400_000;
    expect(ttlDays).toBeCloseTo(7, 3);
  });

  it('rechaza slugs duplicados', async () => {
    await insertEndpoint({ slug: 'duplicado' });
    await expect(insertEndpoint({ slug: 'duplicado' })).rejects.toMatchObject({
      cause: { code: '23505' },
    });
  });

  it.each([{ respStatus: 99 }, { respStatus: 600 }, { respDelayMs: -1 }, { respDelayMs: 10_001 }])(
    'rechaza una respuesta personalizada fuera de rango: %o',
    async (overrides) => {
      await expect(insertEndpoint(overrides)).rejects.toMatchObject({
        cause: { code: CHECK_VIOLATION },
      });
    },
  );
});

describe('requests', () => {
  it('guarda y devuelve el body binario byte a byte, sin pasar por UTF-8', async () => {
    const endpoint = await insertEndpoint();
    // Bytes inválidos en UTF-8: si algo decodificara el body, se convertirían en U+FFFD.
    const body = Buffer.from([0x00, 0xff, 0xfe, 0x80, 0x0a, 0xc3, 0x28]);
    const inserted = await insertRequest(endpoint.id, body);

    const [stored] = await db.select().from(requests).where(eq(requests.id, inserted.id));

    expect(Buffer.isBuffer(stored?.body)).toBe(true);
    expect(stored?.body?.equals(body)).toBe(true);
  });

  it('conserva headers duplicados, el query crudo y la IP', async () => {
    const endpoint = await insertEndpoint();
    const [inserted] = await db
      .insert(requests)
      .values({
        endpointId: endpoint.id,
        method: 'GET',
        path: '/hook',
        query: { b: ['2'], a: ['1', '3'] },
        rawQuery: 'b=2&a=1&a=3',
        headers: { 'x-forwarded-for': ['203.0.113.7', '10.0.0.1'] },
        sizeBytes: 0,
        ip: '203.0.113.7',
      })
      .returning();

    expect(inserted).toMatchObject({
      query: { b: ['2'], a: ['1', '3'] },
      rawQuery: 'b=2&a=1&a=3',
      headers: { 'x-forwarded-for': ['203.0.113.7', '10.0.0.1'] },
      ip: '203.0.113.7',
      body: null,
    });
  });

  it('guarda received_at con precisión de milisegundos (requisito del cursor)', async () => {
    const endpoint = await insertEndpoint();
    const inserted = await insertRequest(endpoint.id);

    const [match] = await db
      .select({ id: requests.id })
      .from(requests)
      .where(eq(requests.receivedAt, inserted.receivedAt));

    expect(match?.id).toBe(inserted.id);
  });
});

describe('replays', () => {
  it('exige una respuesta o un error', async () => {
    const endpoint = await insertEndpoint();
    const request = await insertRequest(endpoint.id);

    await expect(
      db.insert(replays).values({
        requestId: request.id,
        targetUrl: 'https://example.com/hook',
        reqMethod: 'POST',
        reqHeaders: {},
      }),
    ).rejects.toMatchObject({ cause: { code: CHECK_VIOLATION } });
  });

  it('borrar un endpoint elimina en cascada sus requests y replays', async () => {
    const endpoint = await insertEndpoint();
    const request = await insertRequest(endpoint.id, Buffer.from('{}'));
    await db.insert(replays).values({
      requestId: request.id,
      targetUrl: 'https://example.com/hook',
      reqMethod: 'POST',
      reqHeaders: {},
      respStatus: 204,
      durationMs: 42,
    });

    await db.delete(endpoints).where(eq(endpoints.id, endpoint.id));

    expect(await db.$count(requests)).toBe(0);
    expect(await db.$count(replays)).toBe(0);
  });
});
