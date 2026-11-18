import { sql } from 'drizzle-orm';
import {
  char,
  check,
  index,
  inet,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { bytea, type MultiValueMap } from './types.js';

// Precisión de milisegundos: el cursor (received_at, id) viaja como Date de JS,
// que no representa microsegundos. Con la precisión por defecto (µs) la paginación
// por cursor saltaría o repetiría filas.
const timestampMs = (name: string) => timestamp(name, { withTimezone: true, precision: 3 });

export const endpoints = pgTable(
  'endpoints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    slug: varchar('slug', { length: 32 }).notNull().unique(),
    // SHA-256 en hex del owner_token; el token en claro solo lo conoce el cliente.
    ownerTokenHash: char('owner_token_hash', { length: 64 }).notNull(),
    createdAt: timestampMs('created_at').notNull().defaultNow(),
    expiresAt: timestampMs('expires_at')
      .notNull()
      .default(sql`now() + interval '7 days'`),
    respStatus: integer('resp_status').notNull().default(200),
    respHeaders: jsonb('resp_headers').$type<Record<string, string>>().notNull().default({}),
    respBody: text('resp_body').notNull().default(''),
    respDelayMs: integer('resp_delay_ms').notNull().default(0),
  },
  (t) => [
    index('endpoints_expires_at_idx').on(t.expiresAt),
    check('endpoints_resp_status_check', sql`${t.respStatus} BETWEEN 100 AND 599`),
    check('endpoints_resp_delay_ms_check', sql`${t.respDelayMs} BETWEEN 0 AND 10000`),
  ],
);

export const requests = pgTable(
  'requests',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    endpointId: uuid('endpoint_id')
      .notNull()
      .references(() => endpoints.id, { onDelete: 'cascade' }),
    method: varchar('method', { length: 16 }).notNull(),
    path: text('path').notNull(),
    query: jsonb('query').$type<MultiValueMap>().notNull().default({}),
    // Query string tal cual llegó (orden y codificación) para un replay fiel.
    rawQuery: text('raw_query').notNull().default(''),
    headers: jsonb('headers').$type<MultiValueMap>().notNull(),
    body: bytea('body'),
    contentType: text('content_type'),
    sizeBytes: integer('size_bytes').notNull(),
    ip: inet('ip'),
    receivedAt: timestampMs('received_at').notNull().defaultNow(),
  },
  (t) => [
    index('requests_endpoint_received_idx').on(t.endpointId, t.receivedAt.desc(), t.id.desc()),
    check('requests_size_bytes_check', sql`${t.sizeBytes} >= 0`),
  ],
);

export const replays = pgTable(
  'replays',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    requestId: uuid('request_id')
      .notNull()
      .references(() => requests.id, { onDelete: 'cascade' }),
    targetUrl: text('target_url').notNull(),
    // Lo que realmente se envió (puede diferir del original si el usuario lo editó).
    reqMethod: varchar('req_method', { length: 16 }).notNull(),
    reqHeaders: jsonb('req_headers').$type<MultiValueMap>().notNull(),
    reqBody: bytea('req_body'),
    respStatus: integer('resp_status'),
    respHeaders: jsonb('resp_headers').$type<MultiValueMap>(),
    respBody: bytea('resp_body'),
    durationMs: integer('duration_ms'),
    // Fallo de red, timeout o destino bloqueado por la protección SSRF.
    error: text('error'),
    createdAt: timestampMs('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('replays_request_created_idx').on(t.requestId, t.createdAt.desc()),
    // Un replay o obtuvo respuesta o registró un error; nunca ninguno de los dos.
    check('replays_outcome_check', sql`${t.respStatus} IS NOT NULL OR ${t.error} IS NOT NULL`),
  ],
);
