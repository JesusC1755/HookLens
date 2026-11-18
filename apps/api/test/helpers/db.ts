import { sql } from 'drizzle-orm';
import { createDb, type DbHandle } from '../../src/db/client.js';

export function testDatabaseUrl(): string {
  const url = process.env['DATABASE_URL_TEST'];
  if (!url) {
    throw new Error('DATABASE_URL_TEST no está definida: copia .env.example a .env');
  }
  return url;
}

export function createTestDb(): DbHandle {
  return createDb(testDatabaseUrl());
}

/** Borra todos los datos; el CASCADE limpia requests y replays. */
export async function resetDb({ db }: DbHandle): Promise<void> {
  await db.execute(sql`TRUNCATE endpoints CASCADE`);
}
