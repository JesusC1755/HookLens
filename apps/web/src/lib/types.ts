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
