import type { MultiValueMap } from '../../db/types.js';
import { requests } from '../../db/schema.js';
import type { PubSub } from '../../lib/pubsub.js';

/**
 * Lo que viaja en la lista y en el stream: sin body ni headers. Un body puede pesar
 * 1 MB y el stream lo recibiría cada pestaña abierta; el detalle se pide aparte.
 */
export interface RequestSummary {
  id: string;
  method: string;
  path: string;
  rawQuery: string;
  contentType: string | null;
  sizeBytes: number;
  ip: string | null;
  receivedAt: string;
}

export interface RequestDetail extends RequestSummary {
  query: MultiValueMap;
  headers: MultiValueMap;
  /** Body crudo en base64: JSON no transporta bytes y el front lo formatea según el content-type. */
  body: string | null;
}

export type RequestBus = PubSub<RequestSummary>;

export const summaryColumns = {
  id: requests.id,
  method: requests.method,
  path: requests.path,
  rawQuery: requests.rawQuery,
  contentType: requests.contentType,
  sizeBytes: requests.sizeBytes,
  ip: requests.ip,
  receivedAt: requests.receivedAt,
};

type SummaryRow = Omit<RequestSummary, 'receivedAt'> & { receivedAt: Date };
type DetailRow = SummaryRow & Pick<RequestDetail, 'query' | 'headers'> & { body: Buffer | null };

// Campos explícitos, sin spread: una fila completa trae columnas internas (endpointId).
export function toSummary(row: SummaryRow): RequestSummary {
  return {
    id: row.id,
    method: row.method,
    path: row.path,
    rawQuery: row.rawQuery,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    ip: row.ip,
    receivedAt: row.receivedAt.toISOString(),
  };
}

export function toDetail(row: DetailRow): RequestDetail {
  return {
    ...toSummary(row),
    query: row.query,
    headers: row.headers,
    body: row.body === null ? null : row.body.toString('base64'),
  };
}

// Schemas de respuesta: además de serializar rápido, garantizan que ningún campo
// no declarado (como owner_token_hash) llegue al cliente por error.
const multiValueMapSchema = {
  type: 'object',
  additionalProperties: { type: 'array', items: { type: 'string' } },
} as const;

const summaryProperties = {
  id: { type: 'string' },
  method: { type: 'string' },
  path: { type: 'string' },
  rawQuery: { type: 'string' },
  contentType: { type: ['string', 'null'] },
  sizeBytes: { type: 'integer' },
  ip: { type: ['string', 'null'] },
  receivedAt: { type: 'string', format: 'date-time' },
} as const;

export const requestSummarySchema = {
  type: 'object',
  properties: summaryProperties,
  required: Object.keys(summaryProperties),
  additionalProperties: false,
} as const;

export const requestDetailSchema = {
  type: 'object',
  properties: {
    ...summaryProperties,
    query: multiValueMapSchema,
    headers: multiValueMapSchema,
    body: { type: ['string', 'null'] },
  },
  required: [...Object.keys(summaryProperties), 'query', 'headers', 'body'],
  additionalProperties: false,
} as const;
