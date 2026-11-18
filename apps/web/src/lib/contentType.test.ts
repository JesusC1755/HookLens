import { describe, expect, it } from 'vitest';
import { detectFormat, mediaType, parseFormBody } from './contentType';

describe('mediaType', () => {
  it('ignora parámetros y mayúsculas', () => {
    expect(mediaType('Application/JSON; charset=utf-8')).toBe('application/json');
    expect(mediaType(null)).toBeNull();
    expect(mediaType('  ')).toBeNull();
  });
});

describe('detectFormat', () => {
  it.each([
    ['application/json', '{}', { format: 'json', declared: true }],
    ['application/vnd.github+json', '{}', { format: 'json', declared: true }],
    ['text/xml', '<a/>', { format: 'xml', declared: true }],
    ['application/x-www-form-urlencoded', 'a=1', { format: 'form', declared: true }],
    [null, '  {"a":1}', { format: 'json', declared: false }],
    ['text/plain', '<?xml version="1.0"?><a/>', { format: 'xml', declared: false }],
    ['text/plain', 'hola', { format: 'text', declared: false }],
    // Un HTML se muestra como texto: nunca se renderiza.
    ['text/html', '<p>hola</p>', { format: 'text', declared: false }],
  ])('%s → %j', (contentType, text, expected) => {
    expect(detectFormat(contentType, text)).toEqual(expected);
  });
});

describe('parseFormBody', () => {
  it('agrupa campos repetidos y decodifica + y %XX', () => {
    expect(parseFormBody('nombre=Jos%C3%A9+P&tag=a&tag=b')).toEqual({
      nombre: ['José P'],
      tag: ['a', 'b'],
    });
  });
});
