import type { MultiValueMap } from '../../db/types.js';
import { replays } from '../../db/schema.js';

export type ReplayRow = typeof replays.$inferSelect;

/** Lo que muestra el historial: sin headers ni bodies. */
export interface ReplaySummary {
  id: string;
  requestId: string;
  targetUrl: string;
  method: string;
  status: number | null;
  durationMs: number | null;
  error: string | null;
  createdAt: string;
}

export interface ReplayDetail extends ReplaySummary {
  /** Lo que realmente se envió (con las ediciones y sin los headers hop-by-hop). */
  sent: { headers: MultiValueMap; body: string | null };
  /** null si no hubo respuesta (error de red o timeout). */
  response: { headers: MultiValueMap; body: string | null } | null;
}

export const replaySummaryColumns = {
  id: replays.id,
  requestId: replays.requestId,
  targetUrl: replays.targetUrl,
  method: replays.reqMethod,
  status: replays.respStatus,
  durationMs: replays.durationMs,
  error: replays.error,
  createdAt: replays.createdAt,
};

type SummaryRow = Omit<ReplaySummary, 'createdAt'> & { createdAt: Date };

export function toReplaySummary(row: SummaryRow): ReplaySummary {
  return {
    id: row.id,
    requestId: row.requestId,
    targetUrl: row.targetUrl,
    method: row.method,
    status: row.status,
    durationMs: row.durationMs,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
}

const toBase64 = (body: Buffer | null) => (body === null ? null : body.toString('base64'));

export function toReplayDetail(row: ReplayRow): ReplayDetail {
  return {
    ...toReplaySummary({
      id: row.id,
      requestId: row.requestId,
      targetUrl: row.targetUrl,
      method: row.reqMethod,
      status: row.respStatus,
      durationMs: row.durationMs,
      error: row.error,
      createdAt: row.createdAt,
    }),
    sent: { headers: row.reqHeaders, body: toBase64(row.reqBody) },
    response:
      row.respStatus === null
        ? null
        : { headers: row.respHeaders ?? {}, body: toBase64(row.respBody) },
  };
}

const multiValueMapSchema = {
  type: 'object',
  additionalProperties: { type: 'array', items: { type: 'string' } },
} as const;

const summaryProperties = {
  id: { type: 'string' },
  requestId: { type: 'string' },
  targetUrl: { type: 'string' },
  method: { type: 'string' },
  status: { type: ['integer', 'null'] },
  durationMs: { type: ['integer', 'null'] },
  error: { type: ['string', 'null'] },
  createdAt: { type: 'string', format: 'date-time' },
} as const;

export const replaySummarySchema = {
  type: 'object',
  properties: summaryProperties,
  required: Object.keys(summaryProperties),
  additionalProperties: false,
} as const;

const messageSchema = {
  type: 'object',
  properties: { headers: multiValueMapSchema, body: { type: ['string', 'null'] } },
  required: ['headers', 'body'],
  additionalProperties: false,
} as const;

export const replayDetailSchema = {
  type: 'object',
  properties: {
    ...summaryProperties,
    sent: messageSchema,
    response: { anyOf: [messageSchema, { type: 'null' }] },
  },
  required: [...Object.keys(summaryProperties), 'sent', 'response'],
  additionalProperties: false,
} as const;
