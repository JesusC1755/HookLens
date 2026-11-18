import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { type ApiError, listRequests, streamUrl } from '../../lib/api';
import { openEventStream, type StreamStatus } from '../../lib/sse';
import type { StoredEndpoint } from '../../lib/storage';
import type { RequestSummary } from '../../lib/types';
import { addLiveRequest, mergeRequests } from './merge';
import { requestKeys } from './queryKeys';

export interface StreamState {
  status: StreamStatus;
  reason: string | null;
}

function parseSummary(data: string): RequestSummary | null {
  try {
    const value: unknown = JSON.parse(data);
    if (typeof value !== 'object' || value === null) return null;
    const summary = value as Record<string, unknown>;
    return typeof summary.id === 'string' &&
      typeof summary.method === 'string' &&
      typeof summary.receivedAt === 'string'
      ? (value as RequestSummary)
      : null;
  } catch {
    return null;
  }
}

/**
 * Lista en vivo de un endpoint. Orden de arranque:
 * 1. abre el stream SSE;
 * 2. con el evento `ready` (ya suscrito) pide la primera página;
 * 3. lo que llega por SSE se une a lo paginado, deduplicado por id.
 * Así ninguna request cae en el hueco entre la consulta y la suscripción.
 * En cada reconexión se vuelve a pedir la lista: lo que llegó sin stream no se pierde.
 */
export function useRequestFeed({ slug, token }: StoredEndpoint) {
  const queryClient = useQueryClient();
  const [live, setLive] = useState<readonly RequestSummary[]>([]);
  const [stream, setStream] = useState<StreamState>({ status: 'connecting', reason: null });
  const [subscribed, setSubscribed] = useState(false);
  const [fatalError, setFatalError] = useState<ApiError | null>(null);

  const list = useInfiniteQuery({
    queryKey: requestKeys.list(slug),
    queryFn: ({ pageParam, signal }) => listRequests(slug, token, pageParam, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: subscribed,
    // El stream la mantiene al día; solo se vuelve a pedir al reconectar.
    staleTime: Infinity,
  });

  useEffect(
    () =>
      openEventStream({
        url: streamUrl(slug),
        token,
        onEvent: (event) => {
          if (event.event === 'ready') {
            setSubscribed(true);
            void queryClient.invalidateQueries({ queryKey: requestKeys.list(slug) });
            return;
          }
          if (event.event !== 'request') return;
          const summary = parseSummary(event.data);
          if (summary) {
            setLive((current) => addLiveRequest(current, summary));
          }
        },
        onStatus: (status, reason) => {
          setStream({ status, reason });
        },
        onFatalError: (error) => {
          setFatalError(error);
        },
      }),
    [queryClient, slug, token],
  );

  const pages = list.data?.pages;
  const requests = useMemo(
    () => mergeRequests(live, pages?.flatMap((page) => page.items) ?? []),
    [live, pages],
  );

  return { requests, list, stream, fatalError, subscribed };
}

export type RequestFeed = ReturnType<typeof useRequestFeed>;
