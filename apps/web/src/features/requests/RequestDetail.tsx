import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useMemo } from 'react';
import { CopyButton } from '../../components/CopyButton';
import { getRequest } from '../../lib/api';
import { buildCurl } from '../../lib/curl';
import { formatBytes, formatDateTime } from '../../lib/format';
import type { RequestDetail as RequestDetailData } from '../../lib/types';
import { BodyViewer } from './BodyViewer';
import { MethodBadge } from './MethodBadge';
import { MultiValueTable } from './MultiValueTable';
import { requestKeys } from './queryKeys';

interface RequestDetailProps {
  id: string;
  token: string;
  endpointUrl: string;
  onBack: () => void;
}

export function RequestDetail({ id, token, endpointUrl, onBack }: RequestDetailProps) {
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
        <RequestView request={detail.data} endpointUrl={endpointUrl} />
      )}
    </div>
  );
}

function RequestView({
  request,
  endpointUrl,
}: {
  request: RequestDetailData;
  endpointUrl: string;
}) {
  const target = request.rawQuery === '' ? request.path : `${request.path}?${request.rawQuery}`;
  const curl = useMemo(() => buildCurl(request, endpointUrl), [request, endpointUrl]);

  return (
    <article className="space-y-6 p-4 lg:p-6">
      <header className="flex items-center gap-3">
        <MethodBadge method={request.method} />
        <h2 className="min-w-0 flex-1 truncate font-mono text-sm text-zinc-100">{target}</h2>
        <CopyButton value={curl} label="Copiar como cURL" />
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
        <BodyViewer request={request} />
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
