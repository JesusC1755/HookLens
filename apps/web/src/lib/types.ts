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

export interface EndpointDetails {
  slug: string;
  url: string;
  createdAt: string;
  expiresAt: string;
  response: ResponseConfig;
}
