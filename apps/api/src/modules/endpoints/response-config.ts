import { AppError } from '../../lib/errors.js';

/** Respuesta que el endpoint devuelve a quien le manda un webhook. */
export interface ResponseConfig {
  status: number;
  headers: Record<string, string>;
  body: string;
  delayMs: number;
}

export const RESPONSE_LIMITS = {
  // 1xx no es una respuesta final válida; la CHECK de la base es más laxa (100–599).
  minStatus: 200,
  maxStatus: 599,
  maxDelayMs: 10_000,
  maxHeaders: 20,
  maxHeaderNameLength: 64,
  maxHeaderValueLength: 1024,
  maxBodyLength: 32 * 1024,
} as const;

/**
 * Headers que el usuario no puede fijar:
 * - de framing y hop-by-hop: los calcula el servidor, y uno falso corrompe la respuesta;
 * - de seguridad: la ingesta los fija para que una respuesta HTML configurada por
 *   cualquiera no se ejecute como página en el dominio del API.
 */
export const BLOCKED_RESPONSE_HEADERS: ReadonlySet<string> = new Set([
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

// token de RFC 9110 §5.6.2; valores en ASCII imprimible: sin CR/LF no hay inyección de headers.
const HEADER_NAME_PATTERN = "^[!#$%&'*+.^_`|~0-9A-Za-z-]+$";
const HEADER_VALUE_PATTERN = '^[\\t\\x20-\\x7e]*$';

export const responseConfigSchema = {
  type: 'object',
  properties: {
    status: {
      type: 'integer',
      minimum: RESPONSE_LIMITS.minStatus,
      maximum: RESPONSE_LIMITS.maxStatus,
    },
    headers: {
      type: 'object',
      maxProperties: RESPONSE_LIMITS.maxHeaders,
      propertyNames: {
        type: 'string',
        minLength: 1,
        maxLength: RESPONSE_LIMITS.maxHeaderNameLength,
        pattern: HEADER_NAME_PATTERN,
      },
      additionalProperties: {
        type: 'string',
        maxLength: RESPONSE_LIMITS.maxHeaderValueLength,
        pattern: HEADER_VALUE_PATTERN,
      },
    },
    body: { type: 'string', maxLength: RESPONSE_LIMITS.maxBodyLength },
    delayMs: { type: 'integer', minimum: 0, maximum: RESPONSE_LIMITS.maxDelayMs },
  },
  required: ['status', 'headers', 'body', 'delayMs'],
  additionalProperties: false,
} as const;

/** Pasa los nombres a minúsculas y rechaza duplicados y headers bloqueados. */
export function normalizeResponseHeaders(headers: Record<string, string>): Record<string, string> {
  const normalized = new Map<string, string>();
  for (const [rawName, value] of Object.entries(headers)) {
    const name = rawName.toLowerCase();
    if (BLOCKED_RESPONSE_HEADERS.has(name)) {
      throw new AppError(400, 'HEADER_NOT_ALLOWED', `El header ${name} no se puede configurar`);
    }
    if (normalized.has(name)) {
      throw new AppError(400, 'DUPLICATE_HEADER', `El header ${name} está repetido`);
    }
    normalized.set(name, value);
  }
  // fromEntries y no un objeto literal: un header "__proto__" queda como clave normal.
  return Object.fromEntries(normalized);
}
