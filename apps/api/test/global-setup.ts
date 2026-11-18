import { runMigrations } from '../src/db/migrator.js';
import { testDatabaseUrl } from './helpers/db.js';

export default async function setup(): Promise<void> {
  await runMigrations(testDatabaseUrl());
}
