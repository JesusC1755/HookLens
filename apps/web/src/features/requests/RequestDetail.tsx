import { useQuery } from '@tanstack/react-query';
import { useMemo, type ReactNode } from 'react';
import { CopyButton } from '../../components/CopyButton';
import { getRequest } from '../../lib/api';
import { decodeBody } from '../../lib/body';
import { formatBytes, formatDateTime } from '../../lib/format';
import type { MultiValueMap, RequestDetail as RequestDetailData } from '../../lib/types';
import { MethodBadge } from './MethodBadge';
import { requestKeys } from './queryKeys';

interface RequestDetailProps {
  id: string;
  token: string;
  onBack: () => void;
}

export function RequestDetail({ id, token, onBack }: RequestDetailProps) {
  const detail = useQuery({
    queryKey: requestKeys.detail(id),
    queryFn: ({ signal }) => getRequest(id, token, signal),
    // Una request capturada no cambia nunca: se pide una sola vez.
    staleTime: Infinity,
  });

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <button
        type="button"
        onClick={onBack}
        className="m-4 mb-0 text-sm text-zinc-400 hover:text-zinc-100 lg:hidden"
      >
        ← Volver a la lista
      </button>
      {detail.isPending ? (
        <p className="p-6 text-sm text-zinc-500">Cargando…</p>
      ) : detail.isError ? (
        <div role="alert" className="p-6 text-sm">
          <p className="text-rose-300">No se pudo cargar la request: {detail.error.message}</p>
          <button
            type="button"
            onClick={() => {
              void detail.refetch();
            }}
            className="mt-2 text-zinc-300 underline underline-offset-2"
          >
            Reintentar
          </button>
        </div>
      ) : (
        <RequestView request={detail.data} />
      )}
    </div>
  );
}

function RequestView({ request }: { request: RequestDetailData }) {
  const target = request.rawQuery === '' ? request.path : `${request.path}?${request.rawQuery}`;
  return (
    <article className="space-y-6 p-4 lg:p-6">
      <header className="flex items-center gap-3">
        <MethodBadge method={request.method} />
        <h2 className="min-w-0 truncate font-mono text-sm text-zinc-100">{target}</h2>
      </header>

      <Section title="Resumen">
        <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-sm">
          <Field label="Recibida">{formatDateTime(request.receivedAt)}</Field>
          <Field label="Tamaño">{formatBytes(request.sizeBytes)}</Field>
          <Field label="Content-Type">{request.contentType ?? '—'}</Field>
          <Field label="IP">{request.ip ?? '—'}</Field>
          <Field label="ID">{request.id}</Field>
        </dl>
      </Section>

      <Section title="Headers">
        <MultiValueTable values={request.headers} />
      </Section>

      {Object.keys(request.query).length > 0 && (
        <Section title="Query">
          <MultiValueTable values={request.query} />
        </Section>
      )}

      <Section title="Body">
        <BodyView body={request.body} />
      </Section>
    </article>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-zinc-500">{label}</dt>
      <dd className="min-w-0 font-mono break-all text-zinc-200">{children}</dd>
    </>
  );
}

function MultiValueTable({ values }: { values: MultiValueMap }) {
  // JSONB no conserva el orden de las claves: se muestran ordenadas por nombre.
  const rows = Object.entries(values)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([name, list]) =>
      list.map((value, index) => ({ key: `${name}#${index}`, name, value })),
    );

  if (rows.length === 0) return <p className="text-sm text-zinc-500">Sin valores</p>;

  return (
    <table className="w-full table-fixed text-sm">
      <tbody className="divide-y divide-zinc-800/80">
        {rows.map((row) => (
          <tr key={row.key}>
            <th
              scope="row"
              className="w-2/5 py-1.5 pr-4 text-left align-top font-mono font-normal break-all text-zinc-400"
            >
              {row.name}
            </th>
            <td className="py-1.5 font-mono break-all text-zinc-200">{row.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function BodyView({ body }: { body: string | null }) {
  const decoded = useMemo(() => decodeBody(body), [body]);

  switch (decoded.kind) {
    case 'empty':
      return <p className="text-sm text-zinc-500">Sin body</p>;
    case 'binary':
      return (
        <p className="text-sm text-zinc-400">
          Contenido binario de {formatBytes(decoded.bytes.length)} (no es UTF-8 válido).
        </p>
      );
    case 'text':
      return (
        <div className="relative rounded-md bg-zinc-900">
          <div className="absolute top-2 right-2">
            <CopyButton value={decoded.text} />
          </div>
          {/* Texto plano: React lo escapa, un body con HTML nunca se interpreta. */}
          <pre className="max-h-[60vh] overflow-auto p-3 pr-20 font-mono text-xs whitespace-pre-wrap break-all text-zinc-200">
            {decoded.text}
          </pre>
        </div>
      );
  }
}
