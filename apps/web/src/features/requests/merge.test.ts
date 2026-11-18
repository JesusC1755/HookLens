import { describe, expect, it } from 'vitest';
import type { RequestSummary } from '../../lib/types';
import { addLiveRequest, MAX_LIVE_REQUESTS, mergeRequests } from './merge';

function summary(id: string, receivedAt: string): RequestSummary {
  return {
    id,
    method: 'POST',
    path: '/',
    rawQuery: '',
    contentType: null,
    sizeBytes: 0,
    ip: null,
    receivedAt,
  };
}

const T1 = '2026-11-18T10:00:00.001Z';
const T2 = '2026-11-18T10:00:00.002Z';

describe('mergeRequests', () => {
  it('deduplica por id lo que llegó por SSE y por la lista', () => {
    const live = [summary('b', T2)];
    const fetched = [summary('b', T2), summary('a', T1)];

    expect(mergeRequests(live, fetched).map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('ordena por fecha descendente y desempata por id, igual que el API', () => {
    const merged = mergeRequests(
      [summary('0b', T1)],
      [summary('0a', T1), summary('0c', T1), summary('zz', T2)],
    );

    expect(merged.map((r) => r.id)).toEqual(['zz', '0c', '0b', '0a']);
  });
});

describe('addLiveRequest', () => {
  it('devuelve el mismo array si la request ya estaba', () => {
    const live = [summary('a', T1)];
    expect(addLiveRequest(live, summary('a', T1))).toBe(live);
  });

  it(`conserva solo las ${MAX_LIVE_REQUESTS} más recientes`, () => {
    let live: readonly RequestSummary[] = [];
    for (let i = 0; i <= MAX_LIVE_REQUESTS; i++) {
      const at = new Date(Date.UTC(2026, 10, 18) + i).toISOString();
      live = addLiveRequest(live, summary(`id-${String(i).padStart(4, '0')}`, at));
    }

    expect(live).toHaveLength(MAX_LIVE_REQUESTS);
    expect(live[0]?.id).toBe(`id-${String(MAX_LIVE_REQUESTS).padStart(4, '0')}`);
    expect(live.some((r) => r.id === 'id-0000')).toBe(false);
  });
});
