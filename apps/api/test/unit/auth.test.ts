import { describe, expect, it } from 'vitest';
import { extractBearerToken, tokenMatchesHash } from '../../src/modules/endpoints/auth.js';
import { generateOwnerToken, hashOwnerToken } from '../../src/lib/tokens.js';

describe('extractBearerToken', () => {
  const token = generateOwnerToken();

  it.each([`Bearer ${token}`, `bearer ${token}`, `BEARER ${token}`])('acepta "%s"', (header) => {
    expect(extractBearerToken(header)).toBe(token);
  });

  it.each([
    undefined,
    '',
    token,
    `Basic ${token}`,
    `Bearer  ${token}`,
    `Bearer ${token}x`,
    `Bearer ${token.slice(1)}`,
  ])('rechaza %j', (header) => {
    expect(extractBearerToken(header)).toBeNull();
  });
});

describe('tokenMatchesHash', () => {
  it('compara el hash del token con el guardado', () => {
    const token = generateOwnerToken();
    expect(tokenMatchesHash(token, hashOwnerToken(token))).toBe(true);
    expect(tokenMatchesHash(generateOwnerToken(), hashOwnerToken(token))).toBe(false);
  });

  it('no lanza con un hash guardado de longitud distinta', () => {
    expect(tokenMatchesHash(generateOwnerToken(), 'abc')).toBe(false);
  });
});
