const METHOD_STYLES: Record<string, string> = {
  GET: 'bg-sky-500/15 text-sky-300',
  POST: 'bg-emerald-500/15 text-emerald-300',
  PUT: 'bg-amber-500/15 text-amber-300',
  PATCH: 'bg-violet-500/15 text-violet-300',
  DELETE: 'bg-rose-500/15 text-rose-300',
};
const DEFAULT_STYLE = 'bg-zinc-500/15 text-zinc-300';

export function MethodBadge({ method }: { method: string }) {
  return (
    <span
      className={`inline-flex w-16 shrink-0 justify-center rounded px-1.5 py-0.5 font-mono text-xs font-semibold ${METHOD_STYLES[method] ?? DEFAULT_STYLE}`}
    >
      {method}
    </span>
  );
}
