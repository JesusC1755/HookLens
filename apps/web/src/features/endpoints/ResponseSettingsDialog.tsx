import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, type SubmitEvent, useEffect, useId, useRef, useState } from 'react';
import { getEndpoint, updateResponse } from '../../lib/api';
import type { StoredEndpoint } from '../../lib/storage';
import type { EndpointDetails, ResponseConfig } from '../../lib/types';
import { endpointKeys } from './queryKeys';
import {
  type DraftErrors,
  type HeaderRow,
  newHeaderRow,
  parseDraft,
  RESPONSE_LIMITS,
  type ResponseDraft,
  toDraft,
} from './responseDraft';

interface ResponseSettingsDialogProps {
  endpoint: StoredEndpoint;
  onClose: () => void;
}

/** Se monta solo mientras está abierto: cada apertura parte de lo guardado en el servidor. */
export function ResponseSettingsDialog({ endpoint, onClose }: ResponseSettingsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const details = useQuery({
    queryKey: endpointKeys.details(endpoint.slug),
    queryFn: ({ signal }) => getEndpoint(endpoint.slug, endpoint.token, signal),
  });

  // showModal (y no open): atrapa el foco, bloquea el fondo y cierra con Esc.
  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const close = () => {
    dialogRef.current?.close();
  };

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      aria-labelledby={titleId}
      className="m-auto w-[min(40rem,calc(100%-2rem))] rounded-lg border border-zinc-800 bg-zinc-950 p-0 text-zinc-100 backdrop:bg-black/70"
    >
      <div className="max-h-[85dvh] overflow-y-auto p-6">
        <h2 id={titleId} className="text-lg font-semibold">
          Respuesta del endpoint
        </h2>
        <p className="mt-1 text-sm text-zinc-400">
          Lo que recibe quien manda el webhook. Sirve para probar cómo reacciona el emisor ante
          errores o respuestas lentas.
        </p>

        {details.isPending ? (
          <p className="mt-6 text-sm text-zinc-500">Cargando…</p>
        ) : details.isError ? (
          <p role="alert" className="mt-6 text-sm text-rose-300">
            No se pudo cargar la configuración: {details.error.message}
          </p>
        ) : (
          <ResponseForm endpoint={endpoint} initial={details.data.response} onDone={close} />
        )}
      </div>
    </dialog>
  );
}

interface ResponseFormProps {
  endpoint: StoredEndpoint;
  initial: ResponseConfig;
  onDone: () => void;
}

function ResponseForm({ endpoint, initial, onDone }: ResponseFormProps) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ResponseDraft>(() => toDraft(initial));
  const [errors, setErrors] = useState<DraftErrors>({});
  const ids = { status: useId(), delay: useId(), body: useId() };

  const save = useMutation({
    mutationFn: (config: ResponseConfig) => updateResponse(endpoint.slug, endpoint.token, config),
    onSuccess: (saved) => {
      queryClient.setQueryData<EndpointDetails>(
        endpointKeys.details(endpoint.slug),
        (current) => current && { ...current, response: saved },
      );
      onDone();
    },
  });

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseDraft(draft);
    if (!parsed.ok) {
      setErrors(parsed.errors);
      return;
    }
    setErrors({});
    save.mutate(parsed.config);
  }

  function update(patch: Partial<ResponseDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function updateRow(id: number, patch: Partial<Omit<HeaderRow, 'id'>>) {
    setDraft((current) => ({
      ...current,
      headers: current.headers.map((row) => (row.id === id ? { ...row, ...patch } : row)),
    }));
  }

  return (
    <form noValidate onSubmit={submit} className="mt-6 space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <Field
          id={ids.status}
          label="Status"
          hint={`${RESPONSE_LIMITS.minStatus}–${RESPONSE_LIMITS.maxStatus}`}
          error={errors.status}
        >
          <input
            id={ids.status}
            inputMode="numeric"
            value={draft.status}
            onChange={(event) => {
              update({ status: event.target.value });
            }}
            aria-invalid={errors.status !== undefined}
            className={inputClass}
          />
        </Field>
        <Field
          id={ids.delay}
          label="Retraso (ms)"
          hint={`0–${RESPONSE_LIMITS.maxDelayMs}, para probar timeouts`}
          error={errors.delayMs}
        >
          <input
            id={ids.delay}
            inputMode="numeric"
            value={draft.delayMs}
            onChange={(event) => {
              update({ delayMs: event.target.value });
            }}
            aria-invalid={errors.delayMs !== undefined}
            className={inputClass}
          />
        </Field>
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-zinc-200">Headers</legend>
        <div className="mt-2 space-y-2">
          {draft.headers.map((row) => (
            <div key={row.id} className="flex gap-2">
              <input
                aria-label="Nombre del header"
                placeholder="x-mi-header"
                value={row.name}
                onChange={(event) => {
                  updateRow(row.id, { name: event.target.value });
                }}
                className={`${inputClass} w-2/5`}
              />
              <input
                aria-label={`Valor de ${row.name === '' ? 'header' : row.name}`}
                placeholder="valor"
                value={row.value}
                onChange={(event) => {
                  updateRow(row.id, { value: event.target.value });
                }}
                className={`${inputClass} flex-1`}
              />
              <button
                type="button"
                onClick={() => {
                  update({ headers: draft.headers.filter((other) => other.id !== row.id) });
                }}
                className="px-2 text-sm text-zinc-500 hover:text-rose-300"
              >
                Quitar
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          disabled={draft.headers.length >= RESPONSE_LIMITS.maxHeaders}
          onClick={() => {
            update({ headers: [...draft.headers, newHeaderRow()] });
          }}
          className="mt-2 text-sm text-emerald-300 hover:text-emerald-200 disabled:opacity-50"
        >
          + Agregar header
        </button>
        {errors.headers !== undefined && (
          <p className="mt-1 text-xs text-rose-300">{errors.headers}</p>
        )}
      </fieldset>

      <Field id={ids.body} label="Body" error={errors.body}>
        <textarea
          id={ids.body}
          rows={6}
          spellCheck={false}
          value={draft.body}
          onChange={(event) => {
            update({ body: event.target.value });
          }}
          aria-invalid={errors.body !== undefined}
          className={`${inputClass} font-mono text-xs`}
        />
      </Field>

      {save.isError && (
        <p role="alert" className="text-sm text-rose-300">
          No se pudo guardar: {save.error.message}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onDone}
          className="rounded-md px-3 py-2 text-sm text-zinc-300 hover:text-zinc-50"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={save.isPending}
          className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-60"
        >
          {save.isPending ? 'Guardando…' : 'Guardar'}
        </button>
      </div>
    </form>
  );
}

const inputClass =
  'w-full rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-sm text-zinc-100 outline-none focus:border-emerald-500 aria-invalid:border-rose-500';

interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  error: string | undefined;
  children: ReactNode;
}

function Field({ id, label, hint, error, children }: FieldProps) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-zinc-200">
        {label}
      </label>
      <div className="mt-1">{children}</div>
      {error !== undefined ? (
        <p className="mt-1 text-xs text-rose-300">{error}</p>
      ) : (
        hint !== undefined && <p className="mt-1 text-xs text-zinc-500">{hint}</p>
      )}
    </div>
  );
}
