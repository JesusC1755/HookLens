export type DecodedBody =
  { kind: 'empty' } | { kind: 'text'; text: string } | { kind: 'binary'; bytes: Uint8Array };

// fatal: true hace que un byte inválido lance en lugar de convertirse en U+FFFD,
// así un payload binario no se muestra como texto corrupto.
const utf8 = new TextDecoder('utf-8', { fatal: true });

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** El body viaja en base64 sin tocar; aquí se decide solo cómo mostrarlo. */
export function decodeBody(base64: string | null): DecodedBody {
  if (base64 === null) return { kind: 'empty' };
  const bytes = base64ToBytes(base64);
  try {
    return { kind: 'text', text: utf8.decode(bytes) };
  } catch {
    return { kind: 'binary', bytes };
  }
}
