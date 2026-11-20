import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { endpoints, requests } from '../src/db/schema.js';
import { DEFAULT_RETENTION, trimRequests } from '../src/modules/ingest/service.js';
import { buildTestApp, createEndpoint, type TestEndpoint } from './helpers/app.js';
import { createTestDb, resetDb } from './helpers/db.js';

const handle = createTestDb();
const { db } = handle;
const app = buildTestApp(db);

let owner: TestEndpoint;
let endpointId: string;

beforeEach(async () => {
  await resetDb(handle);
  owner = await createEndpoint(app);
  const [row] = await db
    .select({ id: endpoints.id })
    .from(endpoints)
    .where(eq(endpoints.slug, owner.slug));
  endpointId = row?.id ?? '';
});

afterAll(async () => {
  await app.close();
  await handle.pool.end();
});

/** Inserta requests con fechas crecientes; el tamaño solo vive en size_bytes. */
async function seed(sizes: number[]) {
  const base = Date.UTC(2026, 10, 18);
  await db.insert(requests).values(
    sizes.map((sizeBytes, i) => ({
      endpointId,
      method: 'POST',
      path: `/${i}`,
      headers: {},
      sizeBytes,
      receivedAt: new Date(base + i * 1000),
    })),
  );
}

async function remainingPaths(): Promise<string[]> {
  const rows = await db
    .select({ path: requests.path })
    .from(requests)
    .where(eq(requests.endpointId, endpointId))
    .orderBy(asc(requests.receivedAt));
  return rows.map((row) => row.path);
}

describe('trimRequests', () => {
  it('conserva las más recientes al pasar el tope de cantidad', async () => {
    await seed([1, 1, 1, 1, 1]);

    const deleted = await trimRequests(db, endpointId, { maxRequests: 3, maxBytes: 1000 });

    expect(deleted).toBe(2);
    expect(await remainingPaths()).toEqual(['/2', '/3', '/4']);
  });

  it('borra las antiguas al pasar el tope de bytes acumulados', async () => {
    await seed([40, 40, 40, 40]);

    await trimRequests(db, endpointId, { maxRequests: 100, maxBytes: 100 });

    // 40 + 40 = 80 entra; la tercera más reciente lo llevaría a 120.
    expect(await remainingPaths()).toEqual(['/2', '/3']);
  });

  it('la más reciente se conserva aunque sola supere el tope de bytes', async () => {
    await seed([10, 500]);

    await trimRequests(db, endpointId, { maxRequests: 100, maxBytes: 100 });

    expect(await remainingPaths()).toEqual(['/1']);
  });

  it('no toca las requests de otros endpoints', async () => {
    const other = await createEndpoint(app);
    await app.inject({ method: 'POST', url: `/wh/${other.slug}` });
    await seed([1, 1, 1]);

    await trimRequests(db, endpointId, { maxRequests: 1, maxBytes: 1000 });

    expect(await db.$count(requests)).toBe(2);
  });

  it('la ingesta aplica el tope por defecto en cada request', async () => {
    await seed(Array.from({ length: DEFAULT_RETENTION.maxRequests }, () => 0));

    const res = await app.inject({ method: 'POST', url: `/wh/${owner.slug}/nueva` });

    expect(res.statusCode).toBe(200);
    const paths = await remainingPaths();
    expect(paths).toHaveLength(DEFAULT_RETENTION.maxRequests);
    expect(paths[0]).toBe('/1');
    expect(paths.at(-1)).toBe('/nueva');
  });

  it('la ingesta y el detalle del endpoint usan la retención configurada', async () => {
    const retention = { maxRequests: 2, maxBytes: 1000 };
    const configured = buildTestApp(db, { retention });
    await seed([1, 1]);

    await configured.inject({ method: 'POST', url: `/wh/${owner.slug}/nueva` });
    const details = await configured.inject({
      method: 'GET',
      url: `/api/endpoints/${owner.slug}`,
      headers: owner.auth,
    });

    expect(await remainingPaths()).toEqual(['/1', '/nueva']);
    expect(details.json()).toMatchObject({ retention });
    await configured.close();
  });
});
