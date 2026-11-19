import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useMemo, useState } from 'react';
import { getRequest } from '../../lib/api';
import { formatBytes, formatDateTime } from '../../lib/format';
import type { RequestDetail } from '../../lib/types';
import { MethodBadge } from '../requests/MethodBadge';
import { requestKeys } from '../requests/queryKeys';
import { type BodyDiff, diffBodies, diffHeaders, type HeaderStatus, toDiffLines } from './diff';

interface RequestDiffProps {
  ids: readonly [string, string];
  token: string;
  onClose: () => void;
}

function useRequestDetail(id: string, token: string) {
  return useQuery({
    queryKey: requestKeys.detail(id),
    queryFn: ({ signal }) => getRequest(id, token, signal),
    staleTime: Infinity,
  });
}

export function RequestDiff({ ids, token, onClose }: RequestDiffProps) {
  const first = useRequestDetail(ids[0], token);
  const second = useRequestDetail(ids[1], token);

  let content: ReactNode;
  if (first.isPending || second.isPending) {
    content = <p className="text-sm text-zinc-500">Cargando…</p>;
  } else if (first.isError || second.isError) {
    content = (
      <p role="alert" className="text-sm text-rose-300">
        No se pudo cargar una de las requests: {(first.error ?? second.error)?.message}
      </p>
    );
  } else {
    // "Antes" es siempre la más antigua, sin importar el orden en que se eligieron.
    const [before, after] =
      first.data.receivedAt <= second.data.receivedAt
        ? [first.data, second.data]
        : [second.data, first.data];
    content = <DiffView before={before} after={after} />;
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="space-y-6 p-4 lg:p-6">
        <header className="flex items-center gap-3">
          <h2 className="flex-1 text-sm font-semibold text-zinc-100">Comparación</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-zinc-400 hover:text-zinc-100"
          >
            Cerrar
          </button>
        </header>
        {content}
      </div>
    </div>
  );
}

const target = (request: RequestDetail) =>
  request.rawQuery === '' ? request.path : `${request.path}?${request.rawQuery}`;

function DiffView({ before, after }: { before: RequestDetail; after: RequestDetail }) {
  const [onlyChanges, setOnlyChanges] = useState(true);
  const headers = useMemo(() => diffHeaders(before.headers, after.headers), [before, after]);
  const body = useMemo(() => diffBodies(before, after), [before, after]);
  const visibleHeaders = onlyChanges ? headers.filter((row) => row.status !== 'same') : headers;

  const summary: [string, string, string][] = [
    ['Método', before.method, after.method],
    ['Path', target(before), target(after)],
    ['Content-Type', before.contentType ?? '—', after.contentType ?? '—'],
    ['Tamaño', formatBytes(before.sizeBytes), formatBytes(after.sizeBytes)],
    ['IP', before.ip ?? '—', after.ip ?? '—'],
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <RequestCard label="Antes" request={before} />
        <RequestCard label="Después" request={after} />
      </div>

      <Section title="Resumen">
        <table className="w-full table-fixed text-sm">
          <tbody className="divide-y divide-zinc-800/80">
            {summary.map(([label, a, b]) => (
              <tr key={label} className={a === b ? '' : 'bg-amber-500/5'}>
                <th scope="row" className="w-1/5 py-1.5 pr-3 text-left font-normal text-zinc-500">
                  {label}
                </th>
                <td className="py-1.5 pr-3 font-mono break-all text-zinc-300">{a}</td>
                <td
                  className={`py-1.5 font-mono break-all ${a === b ? 'text-zinc-300' : 'text-amber-200'}`}
                >
                  {b}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section
        title="Headers"
        aside={
          <label className="flex items-center gap-1.5 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={onlyChanges}
              onChange={(event) => {
                setOnlyChanges(event.target.checked);
              }}
              className="accent-emerald-500"
            />
            Solo diferencias
          </label>
        }
      >
        {visibleHeaders.length === 0 ? (
          <p className="text-sm text-zinc-500">Los headers son idénticos.</p>
        ) : (
          <table className="w-full table-fixed text-xs">
            <tbody className="divide-y divide-zinc-800/80">
              {visibleHeaders.map((row) => (
                <tr key={row.name} className={HEADER_ROW_STYLES[row.status]}>
                  <th
                    scope="row"
                    className="w-1/4 py-1.5 pr-3 text-left align-top font-mono font-normal break-all text-zinc-400"
                  >
                    {row.name}
                  </th>
                  <td className="py-1.5 pr-3 align-top font-mono break-all">
                    {row.before?.join('\n') ?? <Absent />}
                  </td>
                  <td className="py-1.5 align-top font-mono break-all">
                    {row.after?.join('\n') ?? <Absent />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Body">
        <BodyDiffView diff={body} />
      </Section>
    </>
  );
}

const HEADER_ROW_STYLES: Record<HeaderStatus, string> = {
  same: 'text-zinc-400',
  changed: 'bg-amber-500/5 text-amber-200',
  added: 'bg-emerald-500/5 text-emerald-200',
  removed: 'bg-rose-500/5 text-rose-200',
};

function Absent() {
  return <span className="text-zinc-600 italic">(ausente)</span>;
}

function RequestCard({ label, request }: { label: string; request: RequestDetail }) {
  return (
    <div className="min-w-0 rounded-md border border-zinc-800 p-3">
      <p className="mb-1.5 text-zinc-500">{label}</p>
      <div className="flex items-center gap-2">
        <MethodBadge method={request.method} />
        <span className="min-w-0 truncate font-mono text-zinc-200">{target(request)}</span>
      </div>
      <p className="mt-1.5 text-zinc-500">{formatDateTime(request.receivedAt)}</p>
    </div>
  );
}

const LINE_STYLES = {
  added: 'bg-emerald-500/10 text-emerald-200',
  removed: 'bg-rose-500/10 text-rose-200',
  same: 'text-zinc-400',
} as const;
const LINE_PREFIX = { added: '+', removed: '-', same: ' ' } as const;

function BodyDiffView({ diff }: { diff: BodyDiff }) {
  const lines = useMemo(() => (diff.kind === 'text' ? toDiffLines(diff.changes) : []), [diff]);

  switch (diff.kind) {
    case 'identical':
      return <p className="text-sm text-zinc-400">Los bodies son idénticos, byte a byte.</p>;
    case 'format-only':
      return (
        <p className="text-sm text-amber-300">
          Mismo contenido, distinto formato (espacios o saltos de línea). Ojo: una firma HMAC sobre
          el body crudo no coincidiría.
        </p>
      );
    case 'binary':
      return (
        <p className="text-sm text-zinc-400">
          Bodies binarios distintos ({formatBytes(diff.sizeBefore)} y {formatBytes(diff.sizeAfter)}
          ). Usa la vista hex de cada request para compararlos.
        </p>
      );
    case 'too-large':
      return (
        <p className="text-sm text-zinc-400">
          Los bodies son demasiado distintos para mostrar un diff línea a línea.
        </p>
      );
    case 'text':
      return (
        <div className="overflow-hidden rounded-md border border-zinc-800 bg-zinc-900">
          {diff.json && (
            <p className="border-b border-zinc-800 px-3 py-1.5 text-xs text-zinc-500">
              JSON comparado con la misma indentación.
            </p>
          )}
          <pre className="max-h-[60vh] overflow-auto py-2 font-mono text-xs leading-relaxed">
            {lines.map((line, index) =>
              line.kind === 'skipped' ? (
                <div key={index} className="px-3 text-zinc-600 select-none">
                  ⋯ {line.count} líneas sin cambios
                </div>
              ) : (
                <div
                  key={index}
                  className={`px-3 whitespace-pre-wrap break-all ${LINE_STYLES[line.kind]}`}
                >
                  <span className="mr-2 select-none">{LINE_PREFIX[line.kind]}</span>
                  {line.text}
                </div>
              ),
            )}
          </pre>
        </div>
      );
  }
}

function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center">
        <h3 className="flex-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
          {title}
        </h3>
        {aside}
      </div>
      {children}
    </section>
  );
}
