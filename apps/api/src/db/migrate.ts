import { loadEnv } from '../config/env.js';
import { runMigrations } from './migrator.js';

const env = loadEnv();

try {
  await runMigrations(env.DATABASE_URL);
  console.info('Migraciones aplicadas.');
} catch (err) {
  console.error('Error al aplicar migraciones:', err);
  process.exitCode = 1;
}
