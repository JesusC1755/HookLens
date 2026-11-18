import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from '../../src/lib/cursor.js';

describe('cursor', () => {
  it('codifica y decodifica sin perder los milisegundos', () => {
    const cursor = {
      receivedAt: new Date('2026-11-18T10:20:30.123Z'),
      id: '0b8f7f7e-4d5c-4b9a-9a7e-2f1c3d4e5f60',
    };

    const encoded = encodeCursor(cursor);

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(encoded)).toEqual(cursor);
  });

  it.each([
    ['basura', 'no-es-base64-json'],
    ['JSON sin campos', Buffer.from('{}').toString('base64url')],
    [
      'id que no es uuid',
      Buffer.from('{"t":"2026-11-18T10:20:30.123Z","id":"1 OR 1=1"}').toString('base64url'),
    ],
    [
      'fecha inválida',
      Buffer.from('{"t":"ayer","id":"0b8f7f7e-4d5c-4b9a-9a7e-2f1c3d4e5f60"}').toString('base64url'),
    ],
  ])('devuelve null con un cursor inválido: %s', (_case, raw) => {
    expect(decodeCursor(raw)).toBeNull();
  });
});
