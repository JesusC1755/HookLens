import { isIP } from 'node:net';
import type { MultiValueMap } from '../../db/types.js';

export interface IngestTarget {
  /** Path después del slug, sin decodificar: `/wh/abc/github/push?x=1` → `/github/push`. */
  path: string;
  /** Query string exacto, sin el `?`, para que el replay sea fiel. */
  rawQuery: string;
  query: MultiValueMap;
}

const INGEST_PREFIX = /^\/wh\/[^/?]+/;

/** Parte la URL cruda (no la ruta ya decodificada por el router) en path y query. */
export function parseIngestUrl(url: string): IngestTarget {
  const queryStart = url.indexOf('?');
  const pathname = queryStart === -1 ? url : url.slice(0, queryStart);
  const rawQuery = queryStart === -1 ? '' : url.slice(queryStart + 1);
  return {
    path: pathname.replace(INGEST_PREFIX, '') || '/',
    rawQuery,
    query: parseQuery(rawQuery),
  };
}

/** Conserva las claves repetidas (`a=1&a=2` → `{ a: ['1', '2'] }`). */
export function parseQuery(rawQuery: string): MultiValueMap {
  const grouped = new Map<string, string[]>();
  for (const [key, value] of new URLSearchParams(rawQuery)) {
    const values = grouped.get(key);
    if (values) values.push(value);
    else grouped.set(key, [value]);
  }
  // fromEntries crea propiedades propias: una clave `__proto__` no altera el prototipo.
  return Object.fromEntries(grouped);
}

/**
 * Agrupa `rawHeaders` (pares nombre/valor tal como llegaron por el socket) en
 * nombre en minúsculas → todos sus valores. Se evita `req.headers`, que une los
 * duplicados con ", " y pierde la distinción entre valores.
 */
export function normalizeHeaders(rawHeaders: readonly string[]): MultiValueMap {
  const grouped = new Map<string, string[]>();
  for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
    const name = (rawHeaders[i] as string).toLowerCase();
    const value = rawHeaders[i + 1] as string;
    const values = grouped.get(name);
    if (values) values.push(value);
    else grouped.set(name, [value]);
  }
  return Object.fromEntries(grouped);
}

/** Con un TRUST_PROXY mal configurado la IP podría venir de un header falso: se valida. */
export function normalizeIp(ip: string): string | null {
  return isIP(ip) === 0 ? null : ip;
}
