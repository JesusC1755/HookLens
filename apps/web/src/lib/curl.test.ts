import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { buildCurl, shellQuote } from './curl';
import type { RequestDetail } from './types';

const ENDPOINT_URL = 'http://localhost:3001/wh/abcdefgh2345';

function request(overrides: Partial<RequestDetail> = {}): RequestDetail {
  return {
    id: '0b8f7f7e-4d5c-4b9a-9a7e-2f1c3d4e5f60',
    method: 'POST',
    path: '/github',
    rawQuery: '',
    contentType: 'application/json',
    sizeBytes: 0,
    ip: '127.0.0.1',
    receivedAt: '2026-11-18T10:00:00.000Z',
    query: {},
    headers: {},
    body: null,
    ...overrides,
  };
}

const base64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

/** Lo que el shell entrega como argumentos al interpretar el comando. */
function shellArgs(command: string): string[] {
  const output = execFileSync('sh', ['-c', `printf '%s\\0' ${command}`], { encoding: 'utf8' });
  return output.split('\0').slice(0, -1);
}

describe('shellQuote', () => {
  it.each(["it's", '$(rm -rf ~)', '`id`', '"; echo pwned; "', 'a\\nb', 'línea 1\nlínea 2'])(
    'el shell recibe %j literal, sin ejecutar nada',
    (value) => {
      expect(shellArgs(shellQuote(value))).toEqual([value]);
    },
  );
});

describe('buildCurl', () => {
  it('reproduce método, URL con query, headers y body', () => {
    const curl = buildCurl(
      request({
        rawQuery: 'a=1&a=2',
        headers: {
          'content-type': ['application/json'],
          'x-hub-signature-256': ['sha256=abc'],
          'x-dup': ['uno', 'dos'],
        },
        body: base64('{"ref":"main"}\n'),
      }),
      ENDPOINT_URL,
    );

    expect(curl).toBe(
      [
        `curl 'http://localhost:3001/wh/abcdefgh2345/github?a=1&a=2'`,
        `-H 'content-type: application/json'`,
        `-H 'x-hub-signature-256: sha256=abc'`,
        `-H 'x-dup: uno'`,
        `-H 'x-dup: dos'`,
        // --data-binary conserva el salto de línea final (cambiarlo rompería la firma HMAC).
        `--data-binary '{"ref":"main"}\n'`,
      ].join(' \\\n  '),
    );
  });

  it('omite los headers que calcula curl o agregó un proxy', () => {
    const curl = buildCurl(
      request({
        method: 'GET',
        headers: {
          host: ['localhost:3001'],
          'content-length': ['0'],
          'accept-encoding': ['gzip'],
          'x-forwarded-for': ['1.2.3.4'],
          'user-agent': ['GitHub-Hookshot/abc'],
        },
      }),
      ENDPOINT_URL,
    );

    expect(curl).toBe(
      `curl 'http://localhost:3001/wh/abcdefgh2345/github' \\\n  -H 'user-agent: GitHub-Hookshot/abc'`,
    );
  });

  it('usa -X solo cuando el método no es el que curl infiere', () => {
    expect(buildCurl(request({ method: 'PUT' }), ENDPOINT_URL)).toContain('-X PUT');
    expect(buildCurl(request({ method: 'GET', body: base64('x') }), ENDPOINT_URL)).toContain(
      '-X GET',
    );
    expect(buildCurl(request({ method: 'HEAD' }), ENDPOINT_URL)).toContain('--head');
    expect(buildCurl(request({ body: base64('x') }), ENDPOINT_URL)).not.toContain('-X');
  });

  it('manda un header vacío con la sintaxis "nombre;"', () => {
    const curl = buildCurl(request({ headers: { 'x-vacio': [''] } }), ENDPOINT_URL);
    expect(curl).toContain(`-H 'x-vacio;'`);
  });

  it('un body binario entra por stdin y el shell lo reconstruye byte a byte', () => {
    const bytes = [0x00, 0xff, 0x25, 0x5c, 0x27, 0x41, 0x0a];
    const curl = buildCurl(
      request({ body: btoa(String.fromCharCode(...bytes)), path: '/' }),
      ENDPOINT_URL,
    );

    expect(curl).toMatch(/^printf '.*' \| curl 'http:\/\/localhost:3001\/wh\/abcdefgh2345'/s);
    expect(curl).toContain('--data-binary @-');

    const printf = curl.slice(0, curl.indexOf(' | curl'));
    const output = execFileSync('sh', ['-c', printf]);
    expect(Array.from(output)).toEqual(bytes);
  });

  it('un header malicioso no escapa de las comillas', () => {
    const curl = buildCurl(
      request({ method: 'GET', headers: { 'x-evil': [`'; touch /tmp/pwned; '`] } }),
      ENDPOINT_URL,
    );
    const headerArg = curl.split(' \\\n  ')[1] ?? '';

    expect(shellArgs(headerArg)).toEqual(['-H', `x-evil: '; touch /tmp/pwned; '`]);
  });
});
