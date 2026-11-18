const timeFormat = new Intl.DateTimeFormat('es', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  fractionalSecondDigits: 3,
  hourCycle: 'h23',
});
const dateTimeFormat = new Intl.DateTimeFormat('es', { dateStyle: 'medium', timeStyle: 'medium' });
const relativeFormat = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

/** Hora con milisegundos: los webhooks de un mismo evento suelen llegar en el mismo segundo. */
export function formatTime(iso: string): string {
  return timeFormat.format(new Date(iso));
}

export function formatDateTime(iso: string): string {
  return dateTimeFormat.format(new Date(iso));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function formatExpiry(iso: string, now: number): string {
  const remaining = Date.parse(iso) - now;
  if (remaining <= 0) return 'Expirado';
  const [unitMs, unit]: [number, Intl.RelativeTimeFormatUnit] =
    remaining >= DAY_MS
      ? [DAY_MS, 'day']
      : remaining >= HOUR_MS
        ? [HOUR_MS, 'hour']
        : [MINUTE_MS, 'minute'];
  return `Expira ${relativeFormat.format(Math.max(1, Math.round(remaining / unitMs)), unit)}`;
}
