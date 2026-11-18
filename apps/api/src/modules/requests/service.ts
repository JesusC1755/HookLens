import { and, desc, eq, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { endpoints, requests } from '../../db/schema.js';
import { type Cursor, encodeCursor } from '../../lib/cursor.js';
import { AppError } from '../../lib/errors.js';
import { requireBearerToken, tokenMatchesHash } from '../endpoints/auth.js';
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

/** Borra todas las requests del endpoint (sus replays caen por ON DELETE CASCADE). */
export async function deleteRequests(db: Database, endpointId: string): Promise<number> {
  const result = await db.delete(requests).where(eq(requests.endpointId, endpointId));
  return result.rowCount ?? 0;
}

export type CapturedRequest = typeof requests.$inferSelect;

export interface RequestWithOwner {
  request: CapturedRequest;
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
  return row;
}

/**
 * La request, solo si el token es del dueño de su endpoint. Con un token ajeno la
 * request "no existe": responder 403 confirmaría que el id es real.
 */
export async function findOwnedRequest(
  db: Database,
  id: string,
  authorization: string | undefined,
): Promise<CapturedRequest> {
  const token = requireBearerToken(authorization);
  const found = await findRequestWithOwner(db, id);
  if (!found || !tokenMatchesHash(token, found.ownerTokenHash)) {
    throw new AppError(404, 'REQUEST_NOT_FOUND', 'La request no existe');
  }
  if (found.endpointExpiresAt.getTime() <= Date.now()) {
    throw new AppError(410, 'ENDPOINT_EXPIRED', 'El endpoint expiró');
  }
  return found.request;
}

export async function getRequestDetail(
  db: Database,
  id: string,
  authorization: string | undefined,
): Promise<RequestDetail> {
  return toDetail(await findOwnedRequest(db, id, authorization));
}
