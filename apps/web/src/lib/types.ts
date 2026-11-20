// Contratos del API (apps/api/src/modules/*/serializers.ts y routes.ts).

export type MultiValueMap = Record<string, string[]>;

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
  /** Body crudo en base64; null si la request no tenía body. */
  body: string | null;
}

export interface RequestPage {
  items: RequestSummary[];
  nextCursor: string | null;
}

export interface CreatedEndpoint {
  slug: string;
  token: string;
  url: string;
  expiresAt: string;
}

/** Lo que el endpoint responde a quien le manda un webhook. */
export interface ResponseConfig {
  status: number;
  headers: Record<string, string>;
  body: string;
  delayMs: number;
}

export interface ReplaySummary {
  id: string;
  requestId: string;
  targetUrl: string;
  method: string;
  /** null si no hubo respuesta: el motivo está en `error`. */
  status: number | null;
  durationMs: number | null;
  error: string | null;
  createdAt: string;
}

export interface HttpMessage {
  headers: MultiValueMap;
  /** base64; null si no tenía body. */
  body: string | null;
}

export interface ReplayDetail extends ReplaySummary {
  sent: HttpMessage;
  response: HttpMessage | null;
}

/** Sin `method`, `headers` ni `body`, el API reenvía los de la request original. */
export interface ReplayInput {
  targetUrl: string;
  method?: string;
  headers?: MultiValueMap;
  body?: string | null;
}

export interface EndpointDetails {
  slug: string;
  url: string;
  createdAt: string;
  expiresAt: string;
  response: ResponseConfig;
  retention: Retention;
}

/** Topes por endpoint: al llegar una request nueva, se borran las más antiguas que sobren. */
export interface Retention {
  maxRequests: number;
  maxBytes: number;
}
