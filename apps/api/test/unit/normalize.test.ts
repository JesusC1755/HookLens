import { describe, expect, it } from 'vitest';
import {
  normalizeHeaders,
  normalizeIp,
  parseIngestUrl,
  parseQuery,
} from '../../src/modules/ingest/normalize.js';

describe('parseIngestUrl', () => {
  it.each([
    ['/wh/abc', '/', ''],
    ['/wh/abc/', '/', ''],
    ['/wh/abc?x=1', '/', 'x=1'],
    ['/wh/abc/github/push?x=1', '/github/push', 'x=1'],
    ['/wh/abc/a%20b/%2F?q=%C3%B1', '/a%20b/%2F', 'q=%C3%B1'],
    ['/wh/abc/x?a=1?b=2', '/x', 'a=1?b=2'],
  ])('%s → path %s, query %s', (url, path, rawQuery) => {
    expect(parseIngestUrl(url)).toMatchObject({ path, rawQuery });
  });
});

describe('parseQuery', () => {
  it('agrupa claves repetidas y decodifica valores', () => {
    expect(parseQuery('b=2&a=1&a=3&q=%C3%B1+x&flag')).toEqual({
      b: ['2'],
      a: ['1', '3'],
      q: ['ñ x'],
      flag: [''],
    });
  });

  it('trata __proto__ como una clave normal', () => {
    const query = parseQuery('__proto__=x');
    expect(Object.getPrototypeOf(query)).toBe(Object.prototype);
    expect(Object.hasOwn(query, '__proto__')).toBe(true);
  });
});

describe('normalizeHeaders', () => {
  it('pasa los nombres a minúsculas y agrupa duplicados en orden de llegada', () => {
    const raw = ['X-Dup', 'uno', 'Content-Type', 'text/plain', 'x-dup', 'dos'];
    expect(normalizeHeaders(raw)).toEqual({
      'x-dup': ['uno', 'dos'],
      'content-type': ['text/plain'],
    });
  });

  it('no une valores con comas como hace req.headers', () => {
    expect(normalizeHeaders(['Accept', 'a/b, c/d'])).toEqual({ accept: ['a/b, c/d'] });
  });
});

describe('normalizeIp', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['::ffff:127.0.0.1', '::ffff:127.0.0.1'],
    ['2001:db8::1', '2001:db8::1'],
    ['no-es-una-ip', null],
    ['', null],
  ])('%s → %s', (input, expected) => {
    expect(normalizeIp(input)).toBe(expected);
  });
});
