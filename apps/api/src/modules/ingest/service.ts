import type { Database } from '../../db/client.js';
import { requests } from '../../db/schema.js';
import { type RequestSummary, summaryColumns, toSummary } from '../requests/serializers.js';

export type NewCapturedRequest = Omit<typeof requests.$inferInsert, 'id' | 'receivedAt'>;

/** Guarda la request y devuelve su resumen, listo para publicarse en el stream. */
export async function recordRequest(
  db: Database,
  data: NewCapturedRequest,
): Promise<RequestSummary> {
  const [row] = await db.insert(requests).values(data).returning(summaryColumns);
  if (!row) throw new Error('INSERT ... RETURNING no devolvió filas');
  return toSummary(row);
}
