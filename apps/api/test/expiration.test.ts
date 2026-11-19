import { eq } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { endpoints, replays, requests } from '../src/db/schema.js';
import {
  deleteExpiredEndpoints,
  EXPIRATION_BATCH_SIZE,
  EXPIRATION_LOCK_KEY,
  startExpirationJob,
} from '../src/jobs/expire-endpoints.js';
import { generateSlug } from '../src/lib/tokens.js';
import { buildTestApp, createEndpoint } from './helpers/app.js';
import { createTestDb, resetDb } from './helpers/db.js';

const handle = createTestDb();
const { db } = handle;
const app = buildTestApp(db);
const PAST = new Date(Date.now() - 60_000);

beforeEach(async () => {
  await resetDb(handle);
});

afterAll(async () => {
  await app.close();
  await handle.pool.end();
});

async function expire(slug: string) {
  await db.update(endpoints).set({ expiresAt: PAST }).where(eq(endpoints.slug, slug));
}

describe('deleteExpiredEndpoints', () => {
  it('borra los vencidos con sus requests y replays, y deja los vigentes', async () => {
    const expired = await createEndpoint(app);
    const alive = await createEndpoint(app);
    await app.inject({ method: 'POST', url: `/wh/${expired.slug}` });
    await app.inject({ method: 'POST', url: `/wh/${alive.slug}` });
    const [request] = await db.select({ id: requests.id }).from(requests);
    await db.insert(replays).values({
      requestId: request?.id ?? '',
      targetUrl: 'https://example.com/',
      reqMethod: 'POST',
      reqHeaders: {},
      error: 'prueba',
    });
    await expire(expired.slug);

    expect(await deleteExpiredEndpoints(db)).toBe(1);

    const slugs = await db.select({ slug: endpoints.slug }).from(endpoints);
    expect(slugs).toEqual([{ slug: alive.slug }]);
    expect(await db.$count(requests)).toBe(1);
    expect(await db.$count(replays, eq(replays.requestId, request?.id ?? ''))).toBe(0);
  });

  it('procesa por lotes hasta terminar', async () => {
    const count = EXPIRATION_BATCH_SIZE * 2 + 7;
    await db.insert(endpoints).values(
      Array.from({ length: count }, () => ({
        slug: generateSlug(),
        ownerTokenHash: '0'.repeat(64),
        expiresAt: PAST,
      })),
    );

    expect(await deleteExpiredEndpoints(db)).toBe(count);
    expect(await db.$count(endpoints)).toBe(0);
  });

  it('si otra instancia tiene el lock, no espera ni borra nada', async () => {
    const victim = await createEndpoint(app);
    await expire(victim.slug);
    const client = await handle.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [EXPIRATION_LOCK_KEY]);

      expect(await deleteExpiredEndpoints(db)).toBe(0);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
    expect(await deleteExpiredEndpoints(db)).toBe(1);
  });
});

describe('startExpirationJob', () => {
  it('hace una pasada al arrancar y stop() la espera', async () => {
    const victim = await createEndpoint(app);
    await expire(victim.slug);
    const log = { info: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger;

    const job = startExpirationJob({ db, log, intervalMs: 60_000 });
    await job.stop();

    expect(await db.$count(endpoints)).toBe(0);
    expect(log.info).toHaveBeenCalledWith({ deleted: 1 }, 'endpoints expirados borrados');
  });

  it('un fallo se registra sin tumbar el proceso', async () => {
    const log = { info: vi.fn(), error: vi.fn() } as unknown as FastifyBaseLogger;
    const broken = {
      transaction: () => Promise.reject(new Error('sin base')),
    } as unknown as typeof db;

    const job = startExpirationJob({ db: broken, log, intervalMs: 60_000 });
    await job.stop();

    expect(log.error).toHaveBeenCalledOnce();
  });
});
