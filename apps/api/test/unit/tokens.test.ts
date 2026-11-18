import { describe, expect, it } from 'vitest';
import {
  generateOwnerToken,
  generateSlug,
  hashOwnerToken,
  SLUG_PATTERN,
} from '../../src/lib/tokens.js';

describe('tokens', () => {
  it('genera slugs de 12 caracteres base32 en minúsculas', () => {
    const slugs = Array.from({ length: 200 }, generateSlug);
    for (const slug of slugs) expect(slug).toMatch(SLUG_PATTERN);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('genera tokens de 256 bits en base64url', () => {
    const token = generateOwnerToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateOwnerToken()).not.toBe(token);
  });

  it('hashea con SHA-256 en hex', () => {
    expect(hashOwnerToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
