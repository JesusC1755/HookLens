import type { ReactNode } from 'react';
import { CopyButton } from '../../components/CopyButton';
import { formatBytes, formatDateTime, formatTime } from '../../lib/format';
import { MethodBadge } from './MethodBadge';
import type { RequestFeed } from './useRequestFeed';

interface RequestListProps {
  feed: RequestFeed;
  endpointUrl: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  compareIds: readonly string[];
  onToggleCompare: (id: string) => void;
  onClearFilters: () => void;
}

export function RequestList({
  feed,
  endpointUrl,
  selectedId,
  onSelect,
  compareIds,
  onToggleCompare,
  onClearFilters,
}: RequestListProps) {
  const { requests, list, subscribed, filtered } = feed;

  if (requests.length === 0) {
    if (!subscribed || list.isPending) return <ListMessage>Conectando…</ListMessage>;
    if (list.isError) return <ListError message={list.error.message} onRetry={list.refetch} />;
    if (filtered) {
      return (
        <div className="p-6 text-sm">
          <p className="text-zinc-300">Ninguna request coincide con los filtros.</p>
          <button
            type="button"
            onClick={onClearFilters}
            className="mt-2 text-emerald-300 hover:text-emerald-200"
          >
            Quitar filtros
          </button>
        </div>
      );
    }
    return <WaitingForRequests endpointUrl={endpointUrl} />;
  }

  return (
    <div
      className={`min-h-0 flex-1 overflow-y-auto transition-opacity ${list.isPlaceholderData ? 'opacity-60' : ''}`}
      aria-busy={list.isPlaceholderData}
    >
      <ul className="divide-y divide-zinc-800/80">
        {requests.map((request) => {
          const selected = request.id === selectedId;
          const compared = compareIds.includes(request.id);
          return (
            <li
              key={request.id}
              className={`flex items-center transition ${selected ? 'bg-zinc-800/80' : 'hover:bg-zinc-900'}`}
            >
              {/* Fuera del botón: un control interactivo no puede ir dentro de otro. */}
              <input
                type="checkbox"
                checked={compared}
                onChange={() => {
                  onToggleCompare(request.id);
                }}
                aria-label={`Comparar ${request.method} ${request.path}`}
                title="Elegir para comparar"
                className="ml-4 shrink-0 accent-emerald-500"
              />
              <button
                type="button"
                onClick={() => {
                  onSelect(request.id);
                }}
                aria-current={selected ? 'true' : undefined}
                className="flex min-w-0 flex-1 items-center gap-3 py-2.5 pr-4 pl-3 text-left"
              >
                <MethodBadge method={request.method} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-sm text-zinc-200">
                    {request.path}
                    {request.rawQuery !== '' && (
                      <span className="text-zinc-500">?{request.rawQuery}</span>
                    )}
                  </span>
                  <span className="block text-xs text-zinc-500">
                    <time dateTime={request.receivedAt} title={formatDateTime(request.receivedAt)}>
                      {formatTime(request.receivedAt)}
                    </time>
                    {' · '}
                    {formatBytes(request.sizeBytes)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {list.isError && <ListError message={list.error.message} onRetry={list.refetch} />}
      {list.hasNextPage && (
        <div className="p-3">
          <button
            type="button"
            disabled={list.isFetchingNextPage}
            onClick={() => {
              void list.fetchNextPage();
            }}
            className="w-full rounded-md border border-zinc-800 py-2 text-sm text-zinc-300 transition hover:border-zinc-600 disabled:opacity-50"
          >
            {list.isFetchingNextPage ? 'Cargando…' : 'Cargar anteriores'}
          </button>
        </div>
      )}
      {!list.hasNextPage && (
        <p className="px-4 py-3 text-xs text-zinc-600">
          Cada endpoint guarda sus últimas 500 requests (hasta 50 MB); las más antiguas se
          descartan.
        </p>
      )}
    </div>
  );
}

function ListMessage({ children }: { children: ReactNode }) {
  return <p className="p-6 text-sm text-zinc-500">{children}</p>;
}

function ListError({ message, onRetry }: { message: string; onRetry: () => Promise<unknown> }) {
  return (
    <div
      role="alert"
      className="m-3 rounded-md border border-rose-900/60 bg-rose-950/40 p-3 text-sm"
    >
      <p className="text-rose-200">No se pudo cargar la lista: {message}</p>
      <button
        type="button"
        onClick={() => {
          void onRetry();
        }}
        className="mt-2 text-rose-300 underline underline-offset-2 hover:text-rose-100"
      >
        Reintentar
      </button>
    </div>
  );
}

function WaitingForRequests({ endpointUrl }: { endpointUrl: string }) {
  const example = `curl -X POST '${endpointUrl}' -H 'content-type: application/json' -d '{"hola":"mundo"}'`;
  return (
    <div className="p-6">
      <p className="text-sm font-medium text-zinc-200">Esperando requests…</p>
      <p className="mt-1 text-sm text-zinc-500">
        Configura esta URL como webhook en cualquier proveedor, o prueba con:
      </p>
      <div className="mt-3 flex items-start gap-2 rounded-md bg-zinc-900 p-3">
        <code className="min-w-0 flex-1 font-mono text-xs break-all text-zinc-300">{example}</code>
        <CopyButton value={example} />
      </div>
    </div>
  );
}
