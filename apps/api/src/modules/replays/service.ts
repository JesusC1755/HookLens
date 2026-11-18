import { desc, eq } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { endpoints, replays, requests } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { requireBearerToken, tokenMatchesHash } from '../endpoints/auth.js';
import {
  type ReplayRow,
  type ReplaySummary,
  replaySummaryColumns,
  toReplaySummary,
} from './serializers.js';

export const REPLAY_HISTORY_LIMIT = 20;

export type NewReplay = Omit<typeof replays.$inferInsert, 'id' | 'createdAt'>;

export async function recordReplay(db: Database, data: NewReplay): Promise<ReplayRow> {
  const [row] = await db.insert(replays).values(data).returning();
  if (!row) throw new Error('INSERT ... RETURNING no devolvió filas');
  return row;
}

export async function listReplays(db: Database, requestId: string): Promise<ReplaySummary[]> {
  const rows = await db
    .select(replaySummaryColumns)
    .from(replays)
    .where(eq(replays.requestId, requestId))
    .orderBy(desc(replays.createdAt), desc(replays.id))
    .limit(REPLAY_HISTORY_LIMIT);
  return rows.map(toReplaySummary);
}

/** El replay, solo si el token es del dueño del endpoint de su request. */
export async function findOwnedReplay(
  db: Database,
  id: string,
  authorization: string | undefined,
): Promise<ReplayRow> {
  const token = requireBearerToken(authorization);
  const [found] = await db
    .select({
      replay: replays,
      ownerTokenHash: endpoints.ownerTokenHash,
      endpointExpiresAt: endpoints.expiresAt,
    })
    .from(replays)
    .innerJoin(requests, eq(requests.id, replays.requestId))
    .innerJoin(endpoints, eq(endpoints.id, requests.endpointId))
    .where(eq(replays.id, id))
    .limit(1);

  if (!found || !tokenMatchesHash(token, found.ownerTokenHash)) {
    throw new AppError(404, 'REPLAY_NOT_FOUND', 'El replay no existe');
  }
  if (found.endpointExpiresAt.getTime() <= Date.now()) {
    throw new AppError(410, 'ENDPOINT_EXPIRED', 'El endpoint expiró');
  }
  return found.replay;
}
