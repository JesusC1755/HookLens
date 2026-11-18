import { describe, expect, it } from 'vitest';
import { parseStoredEndpoints } from './storage';

const valid = {
  slug: 'abcdefgh2345',
  token: 'x'.repeat(43),
  url: 'http://localhost:3001/wh/abcdefgh2345',
  expiresAt: '2026-11-25T10:00:00.000Z',
};

describe('parseStoredEndpoints', () => {
  it('lee los endpoints guardados', () => {
    expect(parseStoredEndpoints(JSON.stringify([valid]))).toEqual([valid]);
  });

  it.each([
    ['vacío', null],
    ['JSON roto', '{no es json'],
    ['un objeto en vez de lista', JSON.stringify(valid)],
  ])('devuelve [] con un valor %s', (_case, raw) => {
    expect(parseStoredEndpoints(raw)).toEqual([]);
  });

  it('descarta entradas manipuladas o incompletas sin perder las válidas', () => {
    const raw = JSON.stringify([
      valid,
      { ...valid, slug: '../../api' },
      { ...valid, expiresAt: 'nunca' },
      { slug: valid.slug },
      null,
    ]);

    expect(parseStoredEndpoints(raw)).toEqual([valid]);
  });
});
