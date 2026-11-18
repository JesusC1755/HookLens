import { describe, expect, it } from 'vitest';
import { resolveApiUrl } from './config';

describe('resolveApiUrl', () => {
  it('en desarrollo usa el API local', () => {
    expect(resolveApiUrl(undefined)).toBe('http://localhost:3001');
    expect(resolveApiUrl('  ')).toBe('http://localhost:3001');
  });

  it('quita la barra final', () => {
    expect(resolveApiUrl('https://api.hooklens.dev/')).toBe('https://api.hooklens.dev');
  });

  it.each(['api.hooklens.dev', 'ftp://api.hooklens.dev'])('rechaza %s', (value) => {
    expect(() => resolveApiUrl(value)).toThrow(/VITE_API_URL/);
  });
});
