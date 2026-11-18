import { defineConfig } from 'drizzle-kit';

// `generate` solo compara el esquema con las migraciones previas: no necesita conexión.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
});
