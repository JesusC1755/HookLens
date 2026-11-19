import { sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { requests } from '../../db/schema.js';
import { type RequestSummary, summaryColumns, toSummary } from '../requests/serializers.js';

/**
 * Cada endpoint guarda sus últimas 500 requests y hasta 50 MB. Sin tope, una sola URL
 * pública (1 MB por request) podría llenar el disco; con él, la búsqueda sin índice
 * GIN se mantiene acotada.
 */
export const RETENTION = { maxRequests: 500, maxBytes: 50 * 1024 * 1024 };

/**
 * Borra las más antiguas que pasen cualquiera de los dos topes. La más reciente se
 * conserva siempre, aunque sola supere el tope de bytes. Es idempotente: si dos
 * ingestas lo corren a la vez, la segunda no encuentra nada que borrar.
 */
export async function trimRequests(
  db: Database,
  endpointId: string,
  { maxRequests, maxBytes } = RETENTION,
): Promise<number> {
  const result = await db.execute(sql`
    DELETE FROM ${requests}
    WHERE ${requests.id} IN (
      SELECT id FROM (
        SELECT
          ${requests.id} AS id,
          row_number() OVER newest AS position,
          sum(${requests.sizeBytes}) OVER newest AS bytes
        FROM ${requests}
        WHERE ${requests.endpointId} = ${endpointId}
        WINDOW newest AS (
          ORDER BY ${requests.receivedAt} DESC, ${requests.id} DESC
          ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
        )
      ) ranked
      WHERE position > ${maxRequests}
        OR (position > 1 AND bytes > ${maxBytes})
    )
  `);
  return result.rowCount ?? 0;
}

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
