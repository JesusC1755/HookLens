import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { endpoints } from '../src/db/schema.js';
import { createEndpoint } from '../src/modules/endpoints/service.js';
import { createTestDb, resetDb } from './helpers/db.js';

const { generateSlug } = vi.hoisted(() => ({ generateSlug: vi.fn<() => string>() }));

vi.mock('../src/lib/tokens.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/tokens.js')>()),
  generateSlug,
}));

const handle = createTestDb();
const TAKEN = 'aaaaaaaaaaaa';

beforeEach(async () => {
  await resetDb(handle);
  generateSlug.mockReset();
  await handle.db.insert(endpoints).values({ slug: TAKEN, ownerTokenHash: '0'.repeat(64) });
});
afterAll(() => handle.pool.end());

describe('createEndpoint', () => {
  it('reintenta con otro slug si el primero ya existe', async () => {
    generateSlug.mockReturnValueOnce(TAKEN).mockReturnValueOnce('bbbbbbbbbbbb');

    const created = await createEndpoint(handle.db);

    expect(created.slug).toBe('bbbbbbbbbbbb');
    expect(generateSlug).toHaveBeenCalledTimes(2);
  });

  it('se rinde tras 3 colisiones y propaga el error', async () => {
    generateSlug.mockReturnValue(TAKEN);

    await expect(createEndpoint(handle.db)).rejects.toMatchObject({ cause: { code: '23505' } });
    expect(generateSlug).toHaveBeenCalledTimes(3);
  });
});
