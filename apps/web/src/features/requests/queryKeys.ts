import { hasFilters, isRequestFilters, type RequestFilters } from './filters';

export const requestKeys = {
  /** Prefijo de todas las listas del endpoint, con y sin filtros. */
  lists: (slug: string) => ['endpoints', slug, 'requests'] as const,
  list: (slug: string, filters: RequestFilters) =>
    ['endpoints', slug, 'requests', filters] as const,
  detail: (id: string) => ['requests', id] as const,
};

export function isFilteredListKey(key: readonly unknown[]): boolean {
  const filters = key[3];
  return isRequestFilters(filters) && hasFilters(filters);
}
