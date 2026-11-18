import { bytesToBase64, decodeBody } from '../../lib/body';
import {
  HEADER_NAME_PATTERN,
  type HeaderRow,
  isForwardableHeader,
  newHeaderRow,
} from '../../lib/headers';
import type { MultiValueMap, ReplayInput, RequestDetail } from '../../lib/types';

// Mismos límites que el API (apps/api/src/modules/replays/routes.ts).
export const REPLAY_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
export const MAX_REPLAY_HEADERS = 100;
const MAX_BODY_BYTES = 1024 * 1024;
// Lo que Node acepta en un header saliente: latin-1 sin caracteres de control.
const HEADER_VALUE = /^[\t\x20-\x7e\x80-\xff]*$/;

export interface ReplayDraft {
  targetUrl: string;
  /** Sin edición se manda solo la URL y el API reenvía la request tal cual llegó. */
  editing: boolean;
  method: string;
  headers: HeaderRow[];
  body: string;
  /** Un body binario no se puede editar como texto: se reenvía el original. */
  bodyEditable: boolean;
}

export type ReplayDraftErrors = Partial<Record<'targetUrl' | 'headers' | 'body', string>>;

export function createReplayDraft(request: RequestDetail, lastTarget: string | null): ReplayDraft {
  const body = decodeBody(request.body);
  return {
    targetUrl: lastTarget ?? '',
    editing: false,
    method: request.method,
    // Solo los que se van a reenviar: el API descarta host, content-length y los del proxy.
    headers: Object.entries(request.headers)
      .filter(([name]) => isForwardableHeader(name))
      .flatMap(([name, values]) => values.map((value) => newHeaderRow(name, value))),
    body: body.kind === 'text' ? body.text : '',
    bodyEditable: body.kind !== 'binary',
  };
}

function targetError(raw: string): string | null {
  if (raw.trim() === '') return 'Escribe la URL a la que se reenvía';
  if (!URL.canParse(raw.trim())) return 'No es una URL válida';
  const url = new URL(raw.trim());
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'Debe ser http o https';
  if (url.username !== '' || url.password !== '') {
    return 'Sin usuario ni contraseña en la URL: usa el header Authorization';
  }
  return null;
}

function headersOrError(rows: readonly HeaderRow[]): MultiValueMap | string {
  const filled = rows.filter((row) => row.name.trim() !== '' || row.value !== '');
  if (filled.length > MAX_REPLAY_HEADERS) return `Máximo ${MAX_REPLAY_HEADERS} headers`;

  const headers = new Map<string, string[]>();
  for (const { name: rawName, value } of filled) {
    const name = rawName.trim().toLowerCase();
    if (name === '') return 'Hay un header sin nombre';
    if (!HEADER_NAME_PATTERN.test(name)) return `"${rawName}" no es un nombre de header válido`;
    if (!HEADER_VALUE.test(value)) {
      return `El valor de ${name} tiene caracteres que HTTP no admite en un header`;
    }
    // Varias filas con el mismo nombre son un header con varios valores, como llegaron.
    const values = headers.get(name);
    if (values) values.push(value);
    else headers.set(name, [value]);
  }
  return Object.fromEntries(headers);
}

export type ParsedReplayDraft =
  { ok: true; input: ReplayInput } | { ok: false; errors: ReplayDraftErrors };

export function parseReplayDraft(draft: ReplayDraft): ParsedReplayDraft {
  const errors: ReplayDraftErrors = {};
  const target = targetError(draft.targetUrl);
  if (target !== null) errors.targetUrl = target;

  if (!draft.editing) {
    return target === null
      ? { ok: true, input: { targetUrl: draft.targetUrl.trim() } }
      : { ok: false, errors };
  }

  const headers = headersOrError(draft.headers);
  if (typeof headers === 'string') errors.headers = headers;

  const bodyBytes = draft.bodyEditable ? new TextEncoder().encode(draft.body) : null;
  if (bodyBytes !== null && bodyBytes.length > MAX_BODY_BYTES) errors.body = 'Máximo 1 MB';

  if (typeof headers === 'string' || Object.keys(errors).length > 0) return { ok: false, errors };

  const input: ReplayInput = { targetUrl: draft.targetUrl.trim(), method: draft.method, headers };
  // Body vacío = sin body. Si es binario no se incluye y el API reenvía el original.
  if (bodyBytes !== null) input.body = bodyBytes.length === 0 ? null : bytesToBase64(bodyBytes);
  return { ok: true, input };
}
