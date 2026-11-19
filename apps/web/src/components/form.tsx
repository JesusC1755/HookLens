import type { ReactNode } from 'react';
import { type HeaderRow, newHeaderRow } from '../lib/headers';

/**
 * Sin ancho ni tamaño de letra: en Tailwind gana la regla que va después en el CSS, no la
 * clase que va después en el string, así que `w-full` + `w-32` no se puede sobrescribir.
 */
const inputBase =
  'min-w-0 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-zinc-100 outline-none focus:border-emerald-500 aria-invalid:border-rose-500';

export const inputClass = `${inputBase} w-full text-sm`;
export const monoInputClass = `${inputBase} w-full font-mono text-xs`;
export const selectClass = `${inputBase} text-sm`;

interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  error: string | undefined;
  children: ReactNode;
}

export function Field({ id, label, hint, error, children }: FieldProps) {
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

interface HeadersEditorProps {
  rows: HeaderRow[];
  onChange: (rows: HeaderRow[]) => void;
  maxRows: number;
  error: string | undefined;
  hint?: string;
}

/** Filas nombre/valor. Un nombre repetido en varias filas es un header con varios valores. */
export function HeadersEditor({ rows, onChange, maxRows, error, hint }: HeadersEditorProps) {
  function updateRow(id: number, patch: Partial<Omit<HeaderRow, 'id'>>) {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }

  return (
    <fieldset>
      <legend className="text-sm font-medium text-zinc-200">Headers</legend>
      {hint !== undefined && <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>}
      <div className="mt-2 space-y-2">
        {rows.map((row) => (
          <div key={row.id} className="flex gap-2">
            <input
              aria-label="Nombre del header"
              placeholder="x-mi-header"
              spellCheck={false}
              value={row.name}
              onChange={(event) => {
                updateRow(row.id, { name: event.target.value });
              }}
              className={`${inputBase} w-2/5 font-mono text-xs`}
            />
            <input
              aria-label={`Valor de ${row.name === '' ? 'header' : row.name}`}
              placeholder="valor"
              spellCheck={false}
              value={row.value}
              onChange={(event) => {
                updateRow(row.id, { value: event.target.value });
              }}
              className={`${inputBase} flex-1 font-mono text-xs`}
            />
            <button
              type="button"
              onClick={() => {
                onChange(rows.filter((other) => other.id !== row.id));
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
        disabled={rows.length >= maxRows}
        onClick={() => {
          onChange([...rows, newHeaderRow()]);
        }}
        className="mt-2 text-sm text-emerald-300 hover:text-emerald-200 disabled:opacity-50"
      >
        + Agregar header
      </button>
      {error !== undefined && <p className="mt-1 text-xs text-rose-300">{error}</p>}
    </fieldset>
  );
}
