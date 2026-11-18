import { describe, expect, it } from 'vitest';
import { hexDump } from './hexdump';

describe('hexDump', () => {
  it('sigue el formato de hexdump -C', () => {
    const bytes = new TextEncoder().encode('{"a":1}\r\n');

    expect(hexDump(bytes)).toBe(
      '00000000  7b 22 61 22 3a 31 7d 0d  0a                       |{"a":1}..|',
    );
  });

  it('parte en líneas de 16 bytes con su offset', () => {
    const lines = hexDump(new Uint8Array(20)).split('\n');

    expect(lines).toHaveLength(2);
    expect(lines[1]?.startsWith('00000010  00 00 00 00 ')).toBe(true);
  });

  it('respeta el máximo de bytes a mostrar', () => {
    expect(hexDump(new Uint8Array(100), 16).split('\n')).toHaveLength(1);
  });
});
