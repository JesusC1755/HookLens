import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTERS,
  filterParams,
  hasFilters,
  headerFilterError,
  toApiFilters,
} from './filters';
import { isFilteredListKey, requestKeys } from './queryKeys';

describe('filtros de la lista', () => {
  it('los espacios solos no cuentan como filtro', () => {
    expect(hasFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasFilters({ ...EMPTY_FILTERS, q: '   ' })).toBe(false);
    expect(hasFilters({ ...EMPTY_FILTERS, method: 'POST' })).toBe(true);
  });

  it.each([
    ['x-github-event', null],
    ['x-github-event:push', null],
    ['', null],
    ['x mal', 'Usa "nombre" o "nombre:valor"'],
    [':push', 'Usa "nombre" o "nombre:valor"'],
  ])('valida el filtro de header %j', (raw, error) => {
    expect(headerFilterError(raw)).toBe(error);
  });

  it('no manda al API un header mal escrito ni campos vacíos', () => {
    const api = toApiFilters({ q: ' push ', method: '', header: 'x mal' });

    expect(api).toEqual({ q: 'push', method: '', header: '' });
    expect(filterParams(api)).toEqual({ q: 'push' });
  });

  it('distingue las listas filtradas para refrescarlas cuando llega un evento', () => {
    expect(isFilteredListKey(requestKeys.list('abc', EMPTY_FILTERS))).toBe(false);
    expect(isFilteredListKey(requestKeys.list('abc', { ...EMPTY_FILTERS, q: 'x' }))).toBe(true);
    expect(isFilteredListKey(requestKeys.lists('abc'))).toBe(false);
  });
});
