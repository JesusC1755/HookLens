import { HEADER_NAME_PATTERN } from '../../lib/headers';

/** Filtros de la lista, tal como los entiende el API. '' = sin filtro. */
export interface RequestFilters {
  q: string;
  method: string;
  /** "nombre" (presencia) o "nombre:valor" (valor exacto). */
  header: string;
}

export const EMPTY_FILTERS: RequestFilters = { q: '', method: '', header: '' };

export const FILTER_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export function hasFilters(filters: RequestFilters): boolean {
  return filters.q.trim() !== '' || filters.method !== '' || filters.header.trim() !== '';
}

export function headerFilterError(raw: string): string | null {
  if (raw.trim() === '') return null;
  const colon = raw.indexOf(':');
  const name = (colon === -1 ? raw : raw.slice(0, colon)).trim();
  return HEADER_NAME_PATTERN.test(name) ? null : 'Usa "nombre" o "nombre:valor"';
}

/** Lo que se manda al API: sin campos vacíos ni el header si está mal escrito. */
export function toApiFilters(filters: RequestFilters): RequestFilters {
  return {
    q: filters.q.trim(),
    method: filters.method,
    header: headerFilterError(filters.header) === null ? filters.header.trim() : '',
  };
}

export function filterParams(filters: RequestFilters): Record<string, string> {
  const params: Record<string, string> = {};
  if (filters.q !== '') params.q = filters.q;
  if (filters.method !== '') params.method = filters.method;
  if (filters.header !== '') params.header = filters.header;
  return params;
}

export function isRequestFilters(value: unknown): value is RequestFilters {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.q === 'string' &&
    typeof candidate.method === 'string' &&
    typeof candidate.header === 'string'
  );
}
