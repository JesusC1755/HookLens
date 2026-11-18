import type { MultiValueMap } from '../../db/types.js';

// Headers que no se reenvían: los de framing y hop-by-hop los calcula la nueva
// conexión, y los demás los agregó la infraestructura al recibir la request.
const NOT_FORWARDED = new Set([
  'accept-encoding', // la respuesta se guarda tal cual: comprimida no se podría leer
  'connection',
  'content-length',
  'expect',
  'forwarded',
  'host',
  'keep-alive',
  'proxy-connection',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via',
  'x-real-ip',
]);
const NOT_FORWARDED_PREFIXES = ['x-forwarded-'];

export function isForwardableHeader(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    !NOT_FORWARDED.has(lower) && !NOT_FORWARDED_PREFIXES.some((prefix) => lower.startsWith(prefix))
  );
}

export function forwardableHeaders(headers: MultiValueMap): MultiValueMap {
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([name]) => isForwardableHeader(name))
      .map(([name, values]) => [name.toLowerCase(), values]),
  );
}
