import { useMutation, useQuery } from '@tanstack/react-query';
import { type ReactNode, useMemo, useState } from 'react';
import { CopyButton } from '../../components/CopyButton';
import { Link } from '../../components/Link';
import { type ApiError, clearRequests, getEndpoint } from '../../lib/api';
import { formatExpiry } from '../../lib/format';
import { navigate } from '../../lib/router';
import { forgetEndpoint, type StoredEndpoint, useStoredEndpoints } from '../../lib/storage';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { useNow } from '../../lib/useNow';
import { toggleComparison } from '../diff/diff';
import { RequestDiff } from '../diff/RequestDiff';
import { FilterBar } from '../requests/FilterBar';
import { EMPTY_FILTERS, type RequestFilters, toApiFilters } from '../requests/filters';
import { RequestDetail } from '../requests/RequestDetail';
import { RequestList } from '../requests/RequestList';
import { useRequestFeed } from '../requests/useRequestFeed';
import { endpointKeys } from './queryKeys';
import { ResponseSettingsDialog } from './ResponseSettingsDialog';
import { StreamBadge } from './StreamBadge';

const toolbarButton =
  'rounded-md border border-zinc-700 px-2.5 py-1 text-xs font-medium text-zinc-300 transition hover:border-zinc-500 hover:text-zinc-100 disabled:opacity-50';

export function EndpointPage({ slug }: { slug: string }) {
  const endpoint = useStoredEndpoints().find((entry) => entry.slug === slug);

  if (!endpoint) {
    return (
      <Notice title="Este navegador no tiene acceso a este endpoint">
        El token de un endpoint solo se guarda en el navegador donde se creó.
      </Notice>
    );
  }
  return <EndpointWorkspace endpoint={endpoint} />;
}

/** Lo elegido vale solo en la generación del feed en que se eligió: al vaciar, se descarta. */
interface Picked<T> {
  value: T;
  generation: number;
}

const FILTER_DEBOUNCE_MS = 300;

function EndpointWorkspace({ endpoint }: { endpoint: StoredEndpoint }) {
  const [filterDraft, setFilterDraft] = useState<RequestFilters>(EMPTY_FILTERS);
  const apiFilters = useMemo(() => toApiFilters(filterDraft), [filterDraft]);
  const filters = useDebouncedValue(apiFilters, FILTER_DEBOUNCE_MS);
  const feed = useRequestFeed(endpoint, filters);

  const [selection, setSelection] = useState<Picked<string> | null>(null);
  const [comparison, setComparison] = useState<Picked<string[]>>({ value: [], generation: 0 });
  const [showDiff, setShowDiff] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const now = useNow();

  const selectedId = selection?.generation === feed.generation ? selection.value : null;
  const compareIds = comparison.generation === feed.generation ? comparison.value : [];
  const [firstId, secondId] = compareIds;
  const diffIds =
    showDiff && firstId !== undefined && secondId !== undefined
      ? ([firstId, secondId] as const)
      : null;

  const details = useQuery({
    queryKey: endpointKeys.details(endpoint.slug),
    queryFn: ({ signal }) => getEndpoint(endpoint.slug, endpoint.token, signal),
  });
  const clear = useMutation({
    mutationFn: () => clearRequests(endpoint.slug, endpoint.token),
    // El evento `cleared` del stream ya lo hace; esto cubre el caso de que esté desconectado.
    onSuccess: feed.reset,
  });

  if (feed.fatalError) return <FatalNotice error={feed.fatalError} slug={endpoint.slug} />;

  const response = details.data?.response;
  const setSelectedId = (id: string | null) => {
    setShowDiff(false);
    setSelection(id === null ? null : { value: id, generation: feed.generation });
  };
  const toggleCompare = (id: string) => {
    setComparison({ value: toggleComparison(compareIds, id), generation: feed.generation });
  };
  const panelOpen = selectedId !== null || diffIds !== null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-3 border-b border-zinc-800 px-4 py-3">
        <code className="min-w-0 truncate rounded bg-zinc-900 px-2 py-1 font-mono text-sm text-zinc-100">
          {endpoint.url}
        </code>
        <CopyButton value={endpoint.url} label="Copiar URL" />
        <StreamBadge {...feed.stream} />
        <span className="ml-auto flex items-center gap-2">
          <span className="text-xs text-zinc-500">{formatExpiry(endpoint.expiresAt, now)}</span>
          <button
            type="button"
            onClick={() => {
              setSettingsOpen(true);
            }}
            className={toolbarButton}
          >
            Respuesta
            {response && (
              <span className="ml-1.5 font-mono text-zinc-400">
                {response.status}
                {response.delayMs > 0 && ` · ${response.delayMs} ms`}
              </span>
            )}
          </button>
          <button
            type="button"
            disabled={clear.isPending || (feed.requests.length === 0 && !feed.filtered)}
            onClick={() => {
              if (
                window.confirm('¿Borrar todas las requests de este endpoint? No se puede deshacer.')
              ) {
                clear.mutate();
              }
            }}
            className={`${toolbarButton} hover:border-rose-700 hover:text-rose-200`}
          >
            {clear.isPending ? 'Vaciando…' : 'Vaciar'}
          </button>
        </span>
        {clear.isError && (
          <p role="alert" className="w-full text-xs text-rose-300">
            No se pudo vaciar: {clear.error.message}
          </p>
        )}
      </header>

      {settingsOpen && (
        <ResponseSettingsDialog
          endpoint={endpoint}
          onClose={() => {
            setSettingsOpen(false);
          }}
        />
      )}

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(20rem,26rem)_1fr]">
        {/* En pantallas chicas se muestra la lista o el detalle, no ambos. */}
        <aside
          className={`min-h-0 flex-col border-zinc-800 lg:flex lg:border-r ${panelOpen ? 'hidden' : 'flex'}`}
        >
          <FilterBar value={filterDraft} onChange={setFilterDraft} />
          {compareIds.length > 0 && (
            <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs">
              <span className="flex-1 text-zinc-400">
                {compareIds.length === 1
                  ? 'Elige otra request para comparar'
                  : '2 requests elegidas'}
              </span>
              <button
                type="button"
                disabled={compareIds.length < 2}
                onClick={() => {
                  setShowDiff(true);
                }}
                className={toolbarButton}
              >
                Comparar
              </button>
              <button
                type="button"
                onClick={() => {
                  setComparison({ value: [], generation: feed.generation });
                  setShowDiff(false);
                }}
                className="text-zinc-500 hover:text-zinc-200"
              >
                Cancelar
              </button>
            </div>
          )}
          <RequestList
            feed={feed}
            endpointUrl={endpoint.url}
            selectedId={selectedId}
            onSelect={setSelectedId}
            compareIds={compareIds}
            onToggleCompare={toggleCompare}
            onClearFilters={() => {
              setFilterDraft(EMPTY_FILTERS);
            }}
          />
        </aside>
        <section className={`min-h-0 flex-col lg:flex ${panelOpen ? 'flex' : 'hidden'}`}>
          {diffIds !== null ? (
            <RequestDiff
              ids={diffIds}
              token={endpoint.token}
              onClose={() => {
                setShowDiff(false);
              }}
            />
          ) : selectedId === null ? (
            <p className="p-6 text-sm text-zinc-500">
              Selecciona una request para ver el detalle, o marca dos para compararlas.
            </p>
          ) : (
            <RequestDetail
              key={selectedId}
              id={selectedId}
              endpoint={endpoint}
              onBack={() => {
                setSelectedId(null);
              }}
            />
          )}
        </section>
      </div>
    </div>
  );
}

const FATAL_MESSAGES: Record<number, { title: string; body: string }> = {
  401: {
    title: 'El token guardado no es válido',
    body: 'Este navegador tiene un token que el servidor no acepta para este endpoint.',
  },
  403: {
    title: 'El token guardado no es válido',
    body: 'Este navegador tiene un token que el servidor no acepta para este endpoint.',
  },
  404: { title: 'El endpoint ya no existe', body: 'Fue eliminado del servidor.' },
  410: {
    title: 'Este endpoint expiró',
    body: 'Los endpoints duran 7 días. Crea uno nuevo para seguir recibiendo webhooks.',
  },
};

function FatalNotice({ error, slug }: { error: ApiError; slug: string }) {
  const message = FATAL_MESSAGES[error.status] ?? {
    title: 'No se pudo abrir el endpoint',
    body: error.message,
  };
  return (
    <Notice title={message.title}>
      {message.body}
      <button
        type="button"
        onClick={() => {
          forgetEndpoint(slug);
          navigate('/');
        }}
        className="mt-4 block text-sm text-rose-300 underline underline-offset-2 hover:text-rose-100"
      >
        Quitarlo de este navegador
      </button>
    </Notice>
  );
}

function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-xl font-semibold text-zinc-100">{title}</h1>
      <div className="mt-2 text-sm text-zinc-400">{children}</div>
      <Link to="/" className="mt-6 inline-block text-sm text-emerald-300 hover:text-emerald-200">
        ← Crear un endpoint nuevo
      </Link>
    </div>
  );
}
