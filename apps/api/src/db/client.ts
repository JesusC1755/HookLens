import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Database;
  pool: pg.Pool;
}

export function createDb(connectionString: string, onPoolError?: (err: Error) => void): DbHandle {
  const pool = new pg.Pool({ connectionString, max: 10, connectionTimeoutMillis: 5_000 });
  // Sin este listener, un cliente inactivo que pierde la conexión tumba el proceso.
  pool.on('error', (err) => onPoolError?.(err));
  return { db: drizzle({ client: pool, schema }), pool };
}
