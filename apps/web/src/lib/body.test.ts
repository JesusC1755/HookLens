import { describe, expect, it } from 'vitest';
import { decodeBody } from './body';

function base64(input: number[] | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  return btoa(String.fromCharCode(...bytes));
}

describe('decodeBody', () => {
  it('distingue una request sin body', () => {
    expect(decodeBody(null)).toEqual({ kind: 'empty' });
  });

  it('muestra como texto un body UTF-8, incluidos acentos y emoji', () => {
    expect(decodeBody(base64('{"nombre":"José 🚀"}'))).toEqual({
      kind: 'text',
      text: '{"nombre":"José 🚀"}',
    });
  });

  it('no convierte en texto corrupto un body binario', () => {
    const decoded = decodeBody(base64([0x00, 0xff, 0xfe, 0x80]));

    expect(decoded.kind).toBe('binary');
    expect(decoded.kind === 'binary' && Array.from(decoded.bytes)).toEqual([
      0x00, 0xff, 0xfe, 0x80,
    ]);
  });
});
