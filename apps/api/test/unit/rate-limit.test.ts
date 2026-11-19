import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';
import { rateLimitError, tokenOrIpKey } from '../../src/lib/rate-limit.js';

const request = (headers: Record<string, string>, ip = '203.0.113.7') =>
  ({ headers, ip }) as unknown as FastifyRequest;

describe('rateLimitError', () => {
  it.each([
    [500, '1 s'],
    [58_000, '58 s'],
    [3_600_000, '60 min'],
  ])('con %i ms de espera dice "%s"', (ttl, wait) => {
    const error = rateLimitError(request({}), { ttl });

    expect(error).toMatchObject({ statusCode: 429, code: 'RATE_LIMITED' });
    expect(error.message).toBe(`Demasiadas solicitudes: vuelve a intentar en ${wait}`);
  });
});

describe('tokenOrIpKey', () => {
  it('usa el hash del token, nunca el token en claro', () => {
    const key = tokenOrIpKey(request({ authorization: 'Bearer secreto' }));

    expect(key).toMatch(/^token:[0-9a-f]{64}$/);
    expect(key).not.toContain('secreto');
  });

  it('sin token cae en la IP', () => {
    expect(tokenOrIpKey(request({}))).toBe('ip:203.0.113.7');
  });
});
