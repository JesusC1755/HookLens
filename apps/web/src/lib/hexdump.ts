const BYTES_PER_LINE = 16;

const hex = (byte: number) => byte.toString(16).padStart(2, '0');
const printable = (byte: number) =>
  byte >= 0x20 && byte <= 0x7e ? String.fromCharCode(byte) : '.';

/**
 * Formato de `hexdump -C`: offset, 16 bytes en hex y su lectura ASCII. Útil para ver
 * lo que el texto esconde (BOM, \r\n, un salto de línea final que rompe una firma HMAC).
 */
export function hexDump(bytes: Uint8Array, maxBytes = bytes.length): string {
  const end = Math.min(bytes.length, maxBytes);
  const lines: string[] = [];
  for (let offset = 0; offset < end; offset += BYTES_PER_LINE) {
    const chunk = Array.from(bytes.subarray(offset, Math.min(offset + BYTES_PER_LINE, end)));
    const left = chunk.slice(0, 8).map(hex).join(' ');
    const right = chunk.slice(8).map(hex).join(' ');
    const hexColumn = `${left.padEnd(23)}  ${right.padEnd(23)}`;
    lines.push(
      `${offset.toString(16).padStart(8, '0')}  ${hexColumn}  |${chunk.map(printable).join('')}|`,
    );
  }
  return lines.join('\n');
}
