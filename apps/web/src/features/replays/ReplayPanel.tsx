import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, type SubmitEvent, useId, useState } from 'react';
import { Field, HeadersEditor, inputClass } from '../../components/form';
import { createReplay, getReplay, listReplays } from '../../lib/api';
import { formatTime } from '../../lib/format';
import type { StoredEndpoint } from '../../lib/storage';
import type { ReplayInput, ReplaySummary, RequestDetail } from '../../lib/types';
import { BodyViewer } from '../requests/BodyViewer';
import { MultiValueTable } from '../requests/MultiValueTable';
import { readLastTarget, saveLastTarget } from './lastTarget';
import { replayKeys } from './queryKeys';
import {
  createReplayDraft,
  MAX_REPLAY_HEADERS,
  parseReplayDraft,
  REPLAY_METHODS,
  type ReplayDraft,
  type ReplayDraftErrors,
} from './replayDraft';

interface ReplayPanelProps {
  request: RequestDetail;
  endpoint: StoredEndpoint;
}

export function ReplayPanel({ request, endpoint }: ReplayPanelProps) {
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);

  const history = useQuery({
    queryKey: replayKeys.list(request.id),
    queryFn: ({ signal }) => listReplays(request.id, endpoint.token, signal),
  });
  const send = useMutation({
    mutationFn: (input: ReplayInput) => createReplay(request.id, endpoint.token, input),
    onSuccess: (replay) => {
      // Un replay no cambia: el detalle ya queda en caché y se abre directamente.
      queryClient.setQueryData(replayKeys.detail(replay.id), replay);
      void queryClient.invalidateQueries({ queryKey: replayKeys.list(request.id) });
      setOpenId(replay.id);
    },
  });

  return (
    <div className="space-y-4">
      <ReplayForm
        request={request}
        slug={endpoint.slug}
        sending={send.isPending}
        onSend={(input) => {
          send.mutate(input);
        }}
      />
      {send.isError && (
        <p role="alert" className="text-sm text-rose-300">
          No se pudo reenviar: {send.error.message}
        </p>
      )}

      {history.isError ? (
        <p className="text-sm text-rose-300">
          No se pudo cargar el historial: {history.error.message}
        </p>
      ) : (
        history.data !== undefined &&
        history.data.length > 0 && (
          <ul className="divide-y divide-zinc-800 rounded-md border border-zinc-800">
            {history.data.map((replay) => (
              <li key={replay.id}>
                <ReplayRow
                  replay={replay}
                  open={replay.id === openId}
                  onToggle={() => {
                    setOpenId(replay.id === openId ? null : replay.id);
                  }}
                />
                {replay.id === openId && <ReplayResult id={replay.id} token={endpoint.token} />}
              </li>
            ))}
          </ul>
        )
      )}
    </div>
  );
}

interface ReplayFormProps {
  request: RequestDetail;
  slug: string;
  sending: boolean;
  onSend: (input: ReplayInput) => void;
}

function ReplayForm({ request, slug, sending, onSend }: ReplayFormProps) {
  const [draft, setDraft] = useState<ReplayDraft>(() =>
    createReplayDraft(request, readLastTarget(slug)),
  );
  const [errors, setErrors] = useState<ReplayDraftErrors>({});
  const ids = { target: useId(), method: useId(), body: useId() };

  function update(patch: Partial<ReplayDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseReplayDraft(draft);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    saveLastTarget(slug, parsed.input.targetUrl);
    onSend(parsed.input);
  }

  return (
    <form noValidate onSubmit={submit} className="space-y-4">
      <Field
        id={ids.target}
        label="Reenviar a"
        hint="Sale desde el servidor de HookLens: localhost y las redes privadas están bloqueados."
        error={errors.targetUrl}
      >
        <div className="flex gap-2">
          <input
            id={ids.target}
            type="url"
            placeholder="https://mi-app.dev/webhooks"
            spellCheck={false}
            value={draft.targetUrl}
            onChange={(event) => {
              update({ targetUrl: event.target.value });
            }}
            aria-invalid={errors.targetUrl !== undefined}
            className={`${inputClass} font-mono text-xs`}
          />
          <button
            type="submit"
            disabled={sending}
            className="shrink-0 rounded-md bg-emerald-500 px-4 py-1.5 text-sm font-medium text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-60"
          >
            {sending ? 'Enviando…' : 'Reenviar'}
          </button>
        </div>
      </Field>

      <label className="flex items-center gap-2 text-sm text-zinc-300">
        <input
          type="checkbox"
          checked={draft.editing}
          onChange={(event) => {
            update({ editing: event.target.checked });
          }}
          className="accent-emerald-500"
        />
        Editar antes de reenviar
      </label>

      {draft.editing && (
        <div className="space-y-4 rounded-md border border-zinc-800 p-4">
          <div className="w-40">
            <Field id={ids.method} label="Método" error={undefined}>
              <select
                id={ids.method}
                value={draft.method}
                onChange={(event) => {
                  update({ method: event.target.value });
                }}
                className={inputClass}
              >
                {REPLAY_METHODS.map((method) => (
                  <option key={method}>{method}</option>
                ))}
              </select>
            </Field>
          </div>

          <HeadersEditor
            rows={draft.headers}
            onChange={(headers) => {
              update({ headers });
            }}
            maxRows={MAX_REPLAY_HEADERS}
            error={errors.headers}
            hint="Host, Content-Length y los headers que agregó el proxy se calculan de nuevo al enviar."
          />

          {draft.bodyEditable ? (
            <Field
              id={ids.body}
              label="Body"
              hint="Si cambias el body, las firmas HMAC (X-Hub-Signature, Stripe-Signature…) dejan de coincidir."
              error={errors.body}
            >
              <textarea
                id={ids.body}
                rows={8}
                spellCheck={false}
                value={draft.body}
                onChange={(event) => {
                  update({ body: event.target.value });
                }}
                aria-invalid={errors.body !== undefined}
                className={`${inputClass} font-mono text-xs`}
              />
            </Field>
          ) : (
            <p className="text-xs text-zinc-500">
              El body es binario: se reenvía tal cual llegó, sin edición.
            </p>
          )}
        </div>
      )}
    </form>
  );
}

function statusStyle(status: number | null): string {
  if (status === null) return 'bg-rose-500/15 text-rose-300';
  if (status < 300) return 'bg-emerald-500/15 text-emerald-300';
  if (status < 400) return 'bg-sky-500/15 text-sky-300';
  if (status < 500) return 'bg-amber-500/15 text-amber-300';
  return 'bg-rose-500/15 text-rose-300';
}

interface ReplayRowProps {
  replay: ReplaySummary;
  open: boolean;
  onToggle: () => void;
}

function ReplayRow({ replay, open, onToggle }: ReplayRowProps) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition hover:bg-zinc-900"
    >
      <span
        className={`w-14 shrink-0 rounded px-1.5 py-0.5 text-center font-mono text-xs font-semibold ${statusStyle(replay.status)}`}
      >
        {replay.status ?? 'Error'}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-xs text-zinc-200">
          {replay.method} {replay.targetUrl}
        </span>
        {replay.error !== null && (
          <span className="block truncate text-xs text-rose-300">{replay.error}</span>
        )}
      </span>
      <span className="shrink-0 text-xs text-zinc-500">
        {replay.durationMs !== null && `${replay.durationMs} ms · `}
        <time dateTime={replay.createdAt}>{formatTime(replay.createdAt)}</time>
      </span>
    </button>
  );
}

function ReplayResult({ id, token }: { id: string; token: string }) {
  const detail = useQuery({
    queryKey: replayKeys.detail(id),
    queryFn: ({ signal }) => getReplay(id, token, signal),
    staleTime: Infinity,
  });

  if (detail.isPending) return <p className="px-3 pb-3 text-sm text-zinc-500">Cargando…</p>;
  if (detail.isError) {
    return <p className="px-3 pb-3 text-sm text-rose-300">{detail.error.message}</p>;
  }

  const { response, sent } = detail.data;
  return (
    <div className="space-y-4 border-t border-zinc-800 bg-zinc-950/50 p-3">
      {response === null ? (
        <p className="text-sm text-zinc-400">
          No hubo respuesta: {detail.data.error ?? 'error desconocido'}.
        </p>
      ) : (
        <>
          {detail.data.error !== null && (
            <p className="text-xs text-amber-300">{detail.data.error}</p>
          )}
          <Subsection title="Headers de la respuesta">
            <MultiValueTable values={response.headers} />
          </Subsection>
          <Subsection title="Body de la respuesta">
            <BodyViewer
              body={response.body}
              contentType={response.headers['content-type']?.[0] ?? null}
              downloadName={`replay-${id}`}
            />
          </Subsection>
        </>
      )}

      <details className="text-sm">
        <summary className="cursor-pointer text-xs text-zinc-400 hover:text-zinc-200">
          Lo que se envió
        </summary>
        <div className="mt-3 space-y-4">
          <MultiValueTable values={sent.headers} />
          <BodyViewer
            body={sent.body}
            contentType={sent.headers['content-type']?.[0] ?? null}
            downloadName={`replay-${id}-enviado`}
          />
        </div>
      </details>
    </div>
  );
}

function Subsection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-medium text-zinc-400">{title}</h4>
      {children}
    </div>
  );
}
