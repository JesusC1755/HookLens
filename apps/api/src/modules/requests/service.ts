import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { endpoints, requests } from '../../db/schema.js';
import { type Cursor, encodeCursor } from '../../lib/cursor.js';
import {
  type RequestDetail,
  type RequestSummary,
  summaryColumns,
  toDetail,
  toSummary,
} from './serializers.js';

export interface RequestPage {
  items: RequestSummary[];
  /** `null` cuando no hay más páginas. */
  nextCursor: string | null;
}

/**
 * Paginación keyset sobre el índice (endpoint_id, received_at DESC, id DESC).
 * A diferencia de OFFSET, las requests que llegan mientras el usuario pagina no
 * desplazan las filas: no hay saltos ni duplicados, y el costo no crece con la página.
 */
export async function listRequests(
  db: Database,
  endpointId: string,
  { cursor, limit }: { cursor: Cursor | null; limit: number },
): Promise<RequestPage> {
  const rows = await db
    .select(summaryColumns)
    .from(requests)
    .where(
      and(
        eq(requests.endpointId, endpointId),
        cursor === null
          ? undefined
          : sql`(${requests.receivedAt}, ${requests.id}) < (${cursor.receivedAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`,
      ),
    )
    .orderBy(desc(requests.receivedAt), desc(requests.id))
    // Una fila extra indica si existe otra página sin hacer un COUNT.
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(toSummary),
    nextCursor:
      rows.length > limit && last
        ? encodeCursor({ receivedAt: last.receivedAt, id: last.id })
        : null,
  };
}

export interface RequestWithOwner {
  request: RequestDetail;
  ownerTokenHash: string;
  endpointExpiresAt: Date;
}

export async function findRequestWithOwner(
  db: Database,
  id: string,
): Promise<RequestWithOwner | undefined> {
  const [row] = await db
    .select({
      request: requests,
      ownerTokenHash: endpoints.ownerTokenHash,
      endpointExpiresAt: endpoints.expiresAt,
    })
    .from(requests)
    .innerJoin(endpoints, eq(endpoints.id, requests.endpointId))
    .where(eq(requests.id, id))
    .limit(1);
  if (!row) return undefined;
  return { ...row, request: toDetail(row.request) };
}
