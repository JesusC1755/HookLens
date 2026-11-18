import { HEADER_NAME_PATTERN, type HeaderRow, newHeaderRow } from '../../lib/headers';
import type { ResponseConfig } from '../../lib/types';

// Mismas reglas que el API (apps/api/src/modules/endpoints/response-config.ts): validar
// aquí da errores al instante, pero la validación que cuenta es la del servidor.
export const RESPONSE_LIMITS = {
  minStatus: 200,
  maxStatus: 599,
  maxDelayMs: 10_000,
  maxHeaders: 20,
  maxHeaderNameLength: 64,
  maxHeaderValueLength: 1024,
  maxBodyLength: 32 * 1024,
} as const;

const BLOCKED_HEADERS = new Set([
  'connection',
  'content-encoding',
  'content-length',
  'content-security-policy',
  'keep-alive',
  'proxy-connection',
  'set-cookie',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'x-content-type-options',
]);
const HEADER_VALUE = /^[\t\x20-\x7e]*$/;

/** Lo que edita el formulario: los números como texto, tal cual los escribe el usuario. */
export interface ResponseDraft {
  status: string;
  delayMs: string;
  body: string;
  headers: HeaderRow[];
}

export type DraftField = 'status' | 'delayMs' | 'body' | 'headers';
export type DraftErrors = Partial<Record<DraftField, string>>;

export function toDraft(config: ResponseConfig): ResponseDraft {
  return {
    status: String(config.status),
    delayMs: String(config.delayMs),
    body: config.body,
    headers: Object.entries(config.headers).map(([name, value]) => newHeaderRow(name, value)),
  };
}

function parseInteger(value: string): number | null {
  return /^\d+$/.test(value.trim()) ? Number(value) : null;
}

function headerError(rows: readonly HeaderRow[]): string | null {
  if (rows.length > RESPONSE_LIMITS.maxHeaders) {
    return `Máximo ${RESPONSE_LIMITS.maxHeaders} headers`;
  }
  const seen = new Set<string>();
  for (const { name: rawName, value } of rows) {
    const name = rawName.trim().toLowerCase();
    if (name === '') return 'Hay un header sin nombre';
    if (name.length > RESPONSE_LIMITS.maxHeaderNameLength || !HEADER_NAME_PATTERN.test(name)) {
      return `"${rawName}" no es un nombre de header válido`;
    }
    if (BLOCKED_HEADERS.has(name)) return `El header ${name} no se puede configurar`;
    if (seen.has(name)) return `El header ${name} está repetido`;
    if (value.length > RESPONSE_LIMITS.maxHeaderValueLength || !HEADER_VALUE.test(value)) {
      return `El valor de ${name} solo admite ASCII imprimible (máx. ${RESPONSE_LIMITS.maxHeaderValueLength})`;
    }
    seen.add(name);
  }
  return null;
}

export type ParsedDraft = { ok: true; config: ResponseConfig } | { ok: false; errors: DraftErrors };

export function parseDraft(draft: ResponseDraft): ParsedDraft {
  const errors: DraftErrors = {};

  const status = parseInteger(draft.status);
  if (status === null || status < RESPONSE_LIMITS.minStatus || status > RESPONSE_LIMITS.maxStatus) {
    errors.status = `Un número entre ${RESPONSE_LIMITS.minStatus} y ${RESPONSE_LIMITS.maxStatus}`;
  }
  const delayMs = parseInteger(draft.delayMs);
  if (delayMs === null || delayMs > RESPONSE_LIMITS.maxDelayMs) {
    errors.delayMs = `Milisegundos entre 0 y ${RESPONSE_LIMITS.maxDelayMs}`;
  }
  if (draft.body.length > RESPONSE_LIMITS.maxBodyLength) {
    errors.body = `Máximo ${RESPONSE_LIMITS.maxBodyLength / 1024} KB`;
  }
  // Las filas vacías (las que se agregan y no se llenan) no cuentan.
  const rows = draft.headers.filter((row) => row.name.trim() !== '' || row.value !== '');
  const headersError = headerError(rows);
  if (headersError !== null) errors.headers = headersError;

  if (status === null || delayMs === null || Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    config: {
      status,
      delayMs,
      body: draft.body,
      headers: Object.fromEntries(rows.map((row) => [row.name.trim().toLowerCase(), row.value])),
    },
  };
}
