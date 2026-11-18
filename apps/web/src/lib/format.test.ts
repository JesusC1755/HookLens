import { describe, expect, it } from 'vitest';
import { formatBytes, formatExpiry } from './format';

describe('formatExpiry', () => {
  const now = Date.parse('2026-11-18T10:00:00.000Z');
  const inMs = (ms: number) => new Date(now + ms).toISOString();

  it.each([
    [7 * 24 * 3_600_000, 'Expira dentro de 7 días'],
    [5 * 3_600_000, 'Expira dentro de 5 horas'],
    [10 * 60_000, 'Expira dentro de 10 minutos'],
    [5_000, 'Expira dentro de 1 minuto'],
    [0, 'Expirado'],
  ])('a %i ms: %s', (remaining, text) => {
    expect(formatExpiry(inMs(remaining), now)).toBe(text);
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1536, '1.5 KB'],
    [1024 * 1024, '1.0 MB'],
  ])('%i → %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text);
  });
});
