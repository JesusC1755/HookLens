import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client.js';

// Resuelve igual desde src/db (tsx) y desde dist/db (build): ambos están a dos niveles de apps/api.
const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

export async function runMigrations(connectionString: string): Promise<void> {
  const { db, pool } = createDb(connectionString);
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}
