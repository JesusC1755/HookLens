import type { LookupAddress } from 'node:dns';
import { describe, expect, it } from 'vitest';
import {
  createSafeLookup,
  isPublicAddress,
  parseTargetUrl,
} from '../../src/modules/replays/ssrf.js';

describe('isPublicAddress', () => {
  it.each([
    '127.0.0.1',
    '127.255.255.254',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254', // metadatos de AWS/GCP/Azure
    '0.0.0.0',
    '100.64.0.1',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    'fc00::1',
    'fdaa:0:1::3', // red privada de Fly.io
    'fe80::1',
    '::ffff:127.0.0.1', // IPv4 mapeada en IPv6
    '::ffff:a9fe:a9fe', // 169.254.169.254 mapeada, en hex
    '64:ff9b::7f00:1', // NAT64 hacia 127.0.0.1
    'no-es-ip',
  ])('bloquea %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '172.32.0.1',
    '192.169.0.1',
    '2606:4700:4700::1111',
    '::ffff:8.8.8.8',
  ])('permite %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });
});

type Callback = (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void;

function fakeResolver(addresses: LookupAddress[]) {
  return (_host: string, _options: unknown, callback: Callback) => {
    callback(null, addresses);
  };
}

function runLookup(addresses: LookupAddress[], all: boolean) {
  const lookup = createSafeLookup(isPublicAddress, fakeResolver(addresses));
  return new Promise<{ err: NodeJS.ErrnoException | null; result: unknown; family?: number }>(
    (resolve) => {
      lookup('destino.test', { all }, (err, result, family) => {
        resolve({ err, result, ...(family === undefined ? {} : { family }) });
      });
    },
  );
}

describe('createSafeLookup', () => {
  it('rechaza si alguna de las IPs resueltas es privada', async () => {
    const { err } = await runLookup(
      [
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ],
      true,
    );

    expect(err).toMatchObject({ code: 'ERR_TARGET_NOT_ALLOWED' });
  });

  it('entrega todas las IPs cuando el socket las pide (happy eyeballs)', async () => {
    const addresses = [
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1::1', family: 6 },
    ];

    expect(await runLookup(addresses, true)).toEqual({ err: null, result: addresses });
  });

  it('entrega la primera IP cuando el socket pide una sola', async () => {
    expect(await runLookup([{ address: '93.184.216.34', family: 4 }], false)).toEqual({
      err: null,
      result: '93.184.216.34',
      family: 4,
    });
  });

  it('propaga el error del DNS', async () => {
    const lookup = createSafeLookup(isPublicAddress, (_host, _options, callback) => {
      callback(Object.assign(new Error('nope'), { code: 'ENOTFOUND' }), []);
    });
    const err = await new Promise((resolve) => {
      lookup('nada.test', { all: true }, resolve);
    });

    expect(err).toMatchObject({ code: 'ENOTFOUND' });
  });
});

describe('parseTargetUrl', () => {
  it('acepta un destino público', () => {
    expect(parseTargetUrl('https://example.com/hooks?x=1', isPublicAddress).href).toBe(
      'https://example.com/hooks?x=1',
    );
  });

  it.each([
    'http://127.0.0.1:3000/',
    'http://0x7f.1/', // el parser lo normaliza a 127.0.0.1
    'http://2130706433/', // 127.0.0.1 en decimal
    'http://[::1]/',
    'http://[::ffff:169.254.169.254]/',
    'http://169.254.169.254/latest/meta-data/',
  ])('bloquea la IP literal %s', (url) => {
    expect(() => parseTargetUrl(url, isPublicAddress)).toThrow(
      expect.objectContaining({ statusCode: 422, code: 'TARGET_NOT_ALLOWED' }),
    );
  });

  it.each([
    'no es url',
    'ftp://example.com/',
    'file:///etc/passwd',
    'http://user:pass@example.com/',
  ])('rechaza %s', (url) => {
    expect(() => parseTargetUrl(url, isPublicAddress)).toThrow(
      expect.objectContaining({ statusCode: 400, code: 'INVALID_TARGET_URL' }),
    );
  });
});
