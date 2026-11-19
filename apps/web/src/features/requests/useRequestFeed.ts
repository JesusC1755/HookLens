import { keepPreviousData, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, listRequests, streamUrl } from '../../lib/api';
import { openEventStream, type StreamStatus } from '../../lib/sse';
import type { StoredEndpoint } from '../../lib/storage';
import type { RequestSummary } from '../../lib/types';
import { filterParams, hasFilters, type RequestFilters } from './filters';
import { addLiveRequest, mergeRequests } from './merge';
import { isFilteredListKey, requestKeys } from './queryKeys';

const FILTERED_REFRESH_DELAY_MS = 500;

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
 *
 * Con filtros, el evento SSE no alcanza para decidir: trae el resumen, sin headers ni
 * body. En lugar de adivinar, se vuelve a pedir la lista filtrada (con debounce).
 */
export function useRequestFeed({ slug, token }: StoredEndpoint, filters: RequestFilters) {
  const queryClient = useQueryClient();
  const [live, setLive] = useState<readonly RequestSummary[]>([]);
  const [stream, setStream] = useState<StreamState>({ status: 'connecting', reason: null });
  const [subscribed, setSubscribed] = useState(false);
  const [fatalError, setFatalError] = useState<ApiError | null>(null);
  // Cambia cada vez que se vacía el endpoint: invalida la selección y lo que había en pantalla.
  const [generation, setGeneration] = useState(0);

  /** Deja la lista como recién abierta. Lo dispara el evento `cleared` (de esta pestaña o de otra). */
  const reset = useCallback(() => {
    setLive([]);
    setGeneration((current) => current + 1);
    void queryClient.resetQueries({ queryKey: requestKeys.lists(slug) });
  }, [queryClient, slug]);

  const filtered = hasFilters(filters);
  const list = useInfiniteQuery({
    queryKey: requestKeys.list(slug, filters),
    queryFn: ({ pageParam, signal }) =>
      listRequests(slug, token, pageParam, filterParams(filters), signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: subscribed,
    // El stream la mantiene al día; solo se vuelve a pedir al reconectar.
    staleTime: Infinity,
    // Al cambiar un filtro se sigue viendo el resultado anterior hasta que llega el nuevo.
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    // Una ráfaga de webhooks produce un solo refetch de las listas filtradas.
    const refreshFilteredLists = () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        void queryClient.invalidateQueries({
          queryKey: requestKeys.lists(slug),
          predicate: (query) => isFilteredListKey(query.queryKey),
        });
      }, FILTERED_REFRESH_DELAY_MS);
    };

    const close = openEventStream({
      url: streamUrl(slug),
      token,
      onEvent: (event) => {
        if (event.event === 'ready') {
          setSubscribed(true);
          void queryClient.invalidateQueries({ queryKey: requestKeys.lists(slug) });
          return;
        }
        if (event.event === 'cleared') {
          reset();
          return;
        }
        if (event.event === 'expired') {
          // El servidor cierra el stream al vencer; al reconectar respondería 410 igual,
          // pero así se muestra en el momento y no tras el retraso de reconexión.
          setFatalError(new ApiError(410, 'ENDPOINT_EXPIRED', 'El endpoint expiró'));
          return;
        }
        if (event.event !== 'request') return;
        const summary = parseSummary(event.data);
        if (summary) {
          // Se guarda aunque haya filtros: al quitarlos aparece sin pedir nada.
          setLive((current) => addLiveRequest(current, summary));
          refreshFilteredLists();
        }
      },
      onStatus: (status, reason) => {
        setStream({ status, reason });
      },
      onFatalError: (error) => {
        setFatalError(error);
      },
    });
    return () => {
      clearTimeout(refreshTimer);
      close();
    };
  }, [queryClient, slug, token, reset]);

  const pages = list.data?.pages;
  const requests = useMemo(() => {
    const fetched = pages?.flatMap((page) => page.items) ?? [];
    return filtered ? fetched : mergeRequests(live, fetched);
  }, [filtered, live, pages]);

  return { requests, list, stream, fatalError, subscribed, generation, reset, filtered };
}

export type RequestFeed = ReturnType<typeof useRequestFeed>;
