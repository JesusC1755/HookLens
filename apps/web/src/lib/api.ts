import { API_URL } from './config';
import type { CreatedEndpoint, RequestDetail, RequestPage } from './types';

export const PAGE_SIZE = 50;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface ErrorBody {
  error: { code: string; message: string };
}

function isErrorBody(value: unknown): value is ErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const { error } = value;
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    'message' in error &&
    typeof error.message === 'string'
  );
}

/** Convierte una respuesta no-2xx en ApiError, con el formato `{error:{code,message}}` del API. */
export async function toApiError(res: Response): Promise<ApiError> {
  try {
    const body: unknown = await res.json();
    if (isErrorBody(body)) return new ApiError(res.status, body.error.code, body.error.message);
  } catch {
    // El body no era JSON (p. ej. la página de error de un proxy): se usa el mensaje genérico.
  }
  return new ApiError(res.status, 'HTTP_ERROR', `El API respondió ${res.status}`);
}

export function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

interface CallOptions {
  method?: 'GET' | 'POST';
  token?: string | undefined;
  signal?: AbortSignal | undefined;
}

async function call<T>(path: string, { method = 'GET', token, signal }: CallOptions = {}) {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: token === undefined ? {} : bearer(token),
      signal: signal ?? null,
    });
  } catch (err) {
    // Una cancelación (TanStack Query aborta al desmontar) no es un error de red.
    if (signal?.aborted) throw err;
    throw new ApiError(0, 'NETWORK_ERROR', 'No se pudo conectar con el API');
  }
  if (!res.ok) throw await toApiError(res);
  return (await res.json()) as T;
}

export function createEndpoint(): Promise<CreatedEndpoint> {
  return call<CreatedEndpoint>('/api/endpoints', { method: 'POST' });
}

export function listRequests(
  slug: string,
  token: string,
  cursor: string | null,
  signal?: AbortSignal,
): Promise<RequestPage> {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (cursor !== null) params.set('cursor', cursor);
  return call<RequestPage>(
    `/api/endpoints/${encodeURIComponent(slug)}/requests?${params.toString()}`,
    { token, signal },
  );
}

export function getRequest(id: string, token: string, signal?: AbortSignal) {
  return call<RequestDetail>(`/api/requests/${encodeURIComponent(id)}`, { token, signal });
}

export function streamUrl(slug: string): string {
  return `${API_URL}/api/endpoints/${encodeURIComponent(slug)}/stream`;
}
