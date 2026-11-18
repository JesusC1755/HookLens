import { type Bytes, decodeBody } from './body';
import type { RequestDetail } from './types';

// Headers que curl calcula solo o que agregó la infraestructura en el camino:
// copiarlos haría que la request reproducida no coincida (o que curl falle).
const SKIPPED_HEADERS = new Set([
  'accept-encoding',
  'connection',
  'content-length',
  'expect',
  'forwarded',
  'host',
  'keep-alive',
  'proxy-connection',
  'te',
  'transfer-encoding',
  'upgrade',
  'via',
  'x-real-ip',
]);
const SKIPPED_PREFIXES = ['x-forwarded-'];

function isSkipped(name: string): boolean {
  return SKIPPED_HEADERS.has(name) || SKIPPED_PREFIXES.some((prefix) => name.startsWith(prefix));
}

/**
 * Comillas simples de POSIX: dentro no se expande nada ($, `, \), solo hay que
 * escapar la propia comilla. Los headers y el body los controla quien mandó el
 * webhook: sin esto, pegar el cURL en una terminal podría ejecutar comandos.
 */
export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Formato de printf con escapes octales: lo entienden sh, bash, zsh y coreutils. */
function printfFormat(bytes: Bytes): string {
  let format = '';
  for (const byte of bytes) {
    if (byte === 0x25) format += '%%';
    else if (byte === 0x5c) format += '\\\\';
    else if (byte >= 0x20 && byte <= 0x7e && byte !== 0x27) format += String.fromCharCode(byte);
    else format += `\\${byte.toString(8).padStart(3, '0')}`;
  }
  return format;
}

/** Reconstruye la request como comando curl (bash/zsh) contra `endpointUrl`. */
export function buildCurl(request: RequestDetail, endpointUrl: string): string {
  const path = request.path === '/' ? '' : request.path;
  const query = request.rawQuery === '' ? '' : `?${request.rawQuery}`;
  const body = decodeBody(request.body);
  const hasBody = body.kind !== 'empty';

  const args: string[] = [`curl ${shellQuote(`${endpointUrl}${path}${query}`)}`];

  if (request.method === 'HEAD') {
    args.push('--head');
  } else if (request.method !== (hasBody ? 'POST' : 'GET')) {
    // Con --data-binary curl usaría POST; -X conserva el método original (incluso GET con body).
    const method = /^[A-Z]+$/.test(request.method) ? request.method : shellQuote(request.method);
    args.push(`-X ${method}`);
  }

  for (const [name, values] of Object.entries(request.headers)) {
    if (isSkipped(name)) continue;
    for (const value of values) {
      // "-H 'name:'" le dice a curl que quite el header; "name;" lo manda vacío.
      const header = value === '' ? `${name};` : `${name}: ${value}`;
      args.push(`-H ${shellQuote(header)}`);
    }
  }

  // --data-binary y no -d: -d elimina los saltos de línea y cambiaría el body (y su firma).
  if (body.kind === 'text' && !body.text.includes('\0')) {
    args.push(`--data-binary ${shellQuote(body.text)}`);
    return args.join(' \\\n  ');
  }
  if (hasBody) {
    // Un argumento de shell no puede contener bytes nulos: el body binario entra por stdin.
    args.push('--data-binary @-');
    return `printf ${shellQuote(printfFormat(body.bytes))} | ${args.join(' \\\n  ')}`;
  }
  return args.join(' \\\n  ');
}
