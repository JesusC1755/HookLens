import { describe, expect, it } from 'vitest';
import { parseRoute } from './router';

describe('parseRoute', () => {
  it.each([
    ['/', { name: 'home' }],
    ['/e/abcdefgh2345', { name: 'endpoint', slug: 'abcdefgh2345' }],
    ['/e/abcdefgh2345/', { name: 'endpoint', slug: 'abcdefgh2345' }],
    ['/e/ABCDEFGH2345', { name: 'not-found' }],
    ['/e/corto', { name: 'not-found' }],
    ['/e/abcdefgh2345/extra', { name: 'not-found' }],
    ['/otra', { name: 'not-found' }],
  ])('%s', (pathname, route) => {
    expect(parseRoute(pathname)).toEqual(route);
  });
});
