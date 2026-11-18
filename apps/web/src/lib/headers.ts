// Mismo criterio que el API (apps/api/src/modules/replays/headers.ts): los de framing
// y hop-by-hop los calcula la nueva conexión, y los demás los agregó la
// infraestructura al recibir la request. Reenviarlos haría que no coincida.
const NOT_FORWARDED = new Set([
  'accept-encoding',
  'connection',
  'content-length',
  'expect',
  'forwarded',
  'host',
  'keep-alive',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via',
  'x-real-ip',
]);
const NOT_FORWARDED_PREFIXES = ['x-forwarded-'];

export function isForwardableHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    !NOT_FORWARDED.has(lower) && !NOT_FORWARDED_PREFIXES.some((prefix) => lower.startsWith(prefix))
  );
}

/** token de RFC 9110 §5.6.2. */
export const HEADER_NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

export interface HeaderRow {
  id: number;
  name: string;
  value: string;
}

let lastRowId = 0;

/** Fila de un editor de headers, con id estable para la `key` de React. */
export function newHeaderRow(name = '', value = ''): HeaderRow {
  lastRowId += 1;
  return { id: lastRowId, name, value };
}
