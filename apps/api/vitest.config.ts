import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// En local toma DATABASE_URL_TEST del .env raíz; en CI llega por variables de entorno
// (loadEnvFile no sobrescribe variables ya definidas).
const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/global-setup.ts'],
    // Los tests de integración comparten la misma base: se ejecutan en serie.
    fileParallelism: false,
  },
});
