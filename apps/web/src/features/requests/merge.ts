import type { RequestSummary } from '../../lib/types';

// Tope de requests recibidas por SSE que se guardan en memoria durante la sesión.
export const MAX_LIVE_REQUESTS = 500;

/**
 * Mismo orden que la paginación del API: received_at DESC, id DESC. Las fechas
 * vienen de toISOString (ancho fijo) y los uuid en hex minúscula, así que la
 * comparación de strings coincide con la de Postgres.
 */
export function compareNewestFirst(a: RequestSummary, b: RequestSummary): number {
  if (a.receivedAt !== b.receivedAt) return a.receivedAt < b.receivedAt ? 1 : -1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? 1 : -1;
}

export function addLiveRequest(
  live: readonly RequestSummary[],
  incoming: RequestSummary,
): readonly RequestSummary[] {
  // Mismo array si ya estaba: React no vuelve a renderizar.
  if (live.some((request) => request.id === incoming.id)) return live;
  return [incoming, ...live].sort(compareNewestFirst).slice(0, MAX_LIVE_REQUESTS);
}

/**
 * Une lo recibido por el stream con lo paginado. Se guardan por separado para que
 * un refetch de la lista no borre una request que llegó por SSE mientras corría.
 */
export function mergeRequests(
  live: readonly RequestSummary[],
  fetched: readonly RequestSummary[],
): RequestSummary[] {
  const seen = new Set<string>();
  const merged: RequestSummary[] = [];
  for (const request of [...live, ...fetched]) {
    if (seen.has(request.id)) continue;
    seen.add(request.id);
    merged.push(request);
  }
  return merged.sort(compareNewestFirst);
}
