import type { StreamStatus } from '../../lib/sse';
import type { StreamState } from '../requests/useRequestFeed';

const STATUS_STYLES = {
  connecting: { label: 'Conectando…', dot: 'bg-zinc-400 animate-pulse' },
  open: { label: 'En vivo', dot: 'bg-emerald-400' },
  reconnecting: { label: 'Reconectando…', dot: 'bg-amber-400 animate-pulse' },
  closed: { label: 'Desconectado', dot: 'bg-rose-400' },
} satisfies Record<StreamStatus, { label: string; dot: string }>;

export function StreamBadge({ status, reason }: StreamState) {
  const { label, dot } = STATUS_STYLES[status];
  return (
    <span
      role="status"
      title={reason ?? undefined}
      className="inline-flex items-center gap-2 rounded-full border border-zinc-800 px-2.5 py-1 text-xs text-zinc-300"
    >
      <span aria-hidden="true" className={`size-2 rounded-full ${dot}`} />
      {label}
    </span>
  );
}
