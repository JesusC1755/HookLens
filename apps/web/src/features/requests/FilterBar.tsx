import { inputClass, monoInputClass, selectClass } from '../../components/form';
import { FILTER_METHODS, headerFilterError, type RequestFilters } from './filters';

interface FilterBarProps {
  value: RequestFilters;
  onChange: (filters: RequestFilters) => void;
}

/** Controla lo que escribe el usuario; quien la usa aplica los filtros con debounce. */
export function FilterBar({ value, onChange }: FilterBarProps) {
  const headerError = headerFilterError(value.header);
  const update = (patch: Partial<RequestFilters>) => {
    onChange({ ...value, ...patch });
  };

  return (
    <div className="space-y-2 border-b border-zinc-800 p-3">
      <input
        type="search"
        aria-label="Buscar en path, query, headers y body"
        placeholder="Buscar… (en el body distingue mayúsculas)"
        spellCheck={false}
        value={value.q}
        onChange={(event) => {
          update({ q: event.target.value });
        }}
        className={inputClass}
      />
      <div className="flex gap-2">
        <select
          aria-label="Método"
          value={value.method}
          onChange={(event) => {
            update({ method: event.target.value });
          }}
          className={`${selectClass} w-32 shrink-0`}
        >
          <option value="">Todos</option>
          {FILTER_METHODS.map((method) => (
            <option key={method}>{method}</option>
          ))}
        </select>
        <input
          aria-label="Header (nombre o nombre:valor)"
          placeholder="x-github-event:push"
          spellCheck={false}
          value={value.header}
          onChange={(event) => {
            update({ header: event.target.value });
          }}
          aria-invalid={headerError !== null}
          title={headerError ?? 'Un header presente, o con un valor exacto'}
          className={monoInputClass}
        />
      </div>
      {headerError !== null && <p className="text-xs text-rose-300">{headerError}</p>}
    </div>
  );
}
