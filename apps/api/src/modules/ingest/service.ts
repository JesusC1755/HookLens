import type { Database } from '../../db/client.js';
import { requests } from '../../db/schema.js';

export type NewCapturedRequest = Omit<typeof requests.$inferInsert, 'id' | 'receivedAt'>;

export async function recordRequest(
  db: Database,
  data: NewCapturedRequest,
): Promise<{ id: string; receivedAt: Date }> {
  const [row] = await db
    .insert(requests)
    .values(data)
    .returning({ id: requests.id, receivedAt: requests.receivedAt });
  if (!row) throw new Error('INSERT ... RETURNING no devolvió filas');
  return row;
}
