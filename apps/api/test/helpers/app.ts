import { buildApp } from '../../src/app.js';
import type { Database } from '../../src/db/client.js';

export const TEST_BASE_URL = 'http://hooklens.test';

export function buildTestApp(db: Database) {
  return buildApp({ db, publicBaseUrl: TEST_BASE_URL });
}
