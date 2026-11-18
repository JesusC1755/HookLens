import { describe, expect, it } from 'vitest';
import { base64ToBytes, bytesToBase64, decodeBody } from './body';

function base64(input: number[] | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  return btoa(String.fromCharCode(...bytes));
}

describe('decodeBody', () => {
  it('distingue una request sin body', () => {
    expect(decodeBody(null)).toEqual({ kind: 'empty' });
  });

  it('muestra como texto un body UTF-8, incluidos acentos y emoji', () => {
    const decoded = decodeBody(base64('{"nombre":"José 🚀"}'));

    expect(decoded).toMatchObject({ kind: 'text', text: '{"nombre":"José 🚀"}' });
    // Los bytes originales se conservan para el visor hex y la descarga (é = 2, 🚀 = 4).
    expect(decoded.kind === 'text' && decoded.bytes.length).toBe(23);
  });

  it('no convierte en texto corrupto un body binario', () => {
    const decoded = decodeBody(base64([0x00, 0xff, 0xfe, 0x80]));

    expect(decoded.kind).toBe('binary');
    expect(decoded.kind === 'binary' && Array.from(decoded.bytes)).toEqual([
      0x00, 0xff, 0xfe, 0x80,
    ]);
  });
});

describe('bytesToBase64', () => {
  it('convierte 1 MB sin desbordar la pila y vuelve idéntico', () => {
    const bytes = new Uint8Array(1024 * 1024).map((_, i) => i % 256);

    const roundtrip = base64ToBytes(bytesToBase64(bytes));

    expect(roundtrip).toEqual(bytes);
  });
});
