import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../src/config/env.js';

const DATABASE_URL = 'postgres://u:p@localhost:5432/db';

describe('loadEnv', () => {
  it('en desarrollo deriva PUBLIC_BASE_URL del puerto', () => {
    expect(loadEnv({ DATABASE_URL, PORT: '4000' })).toMatchObject({
      PUBLIC_BASE_URL: 'http://localhost:4000',
      TRUST_PROXY: [],
    });
  });

  it('parsea TRUST_PROXY como lista de IPs, CIDR y alias', () => {
    const env = loadEnv({
      DATABASE_URL,
      TRUST_PROXY: ' 10.0.0.0/8, fdaa::/16 ,uniquelocal,127.0.0.1',
    });
    expect(env.TRUST_PROXY).toEqual(['10.0.0.0/8', 'fdaa::/16', 'uniquelocal', '127.0.0.1']);
  });

  it.each(['1', 'true', '10.0.0.0/33', '10.0.0.1/8/2', 'proxy.local'])(
    'rechaza TRUST_PROXY=%s',
    (value) => {
      expect(() => loadEnv({ DATABASE_URL, TRUST_PROXY: value })).toThrow(/TRUST_PROXY/);
    },
  );

  it('quita la barra final de PUBLIC_BASE_URL', () => {
    const env = loadEnv({ DATABASE_URL, PUBLIC_BASE_URL: 'https://api.hooklens.dev/' });
    expect(env.PUBLIC_BASE_URL).toBe('https://api.hooklens.dev');
  });

  it('exige PUBLIC_BASE_URL en producción', () => {
    expect(() => loadEnv({ DATABASE_URL, NODE_ENV: 'production' })).toThrow(/PUBLIC_BASE_URL/);
  });

  it('rechaza una DATABASE_URL que no es de Postgres', () => {
    expect(() => loadEnv({ DATABASE_URL: 'mysql://u:p@localhost/db' })).toThrow(/DATABASE_URL/);
  });
});
