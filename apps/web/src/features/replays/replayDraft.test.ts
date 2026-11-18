import { describe, expect, it } from 'vitest';
import { base64ToBytes } from '../../lib/body';
import { newHeaderRow } from '../../lib/headers';
import type { RequestDetail } from '../../lib/types';
import { createReplayDraft, parseReplayDraft, type ReplayDraft } from './replayDraft';

function request(overrides: Partial<RequestDetail> = {}): RequestDetail {
  return {
    id: '0b8f7f7e-4d5c-4b9a-9a7e-2f1c3d4e5f60',
    method: 'POST',
    path: '/github',
    rawQuery: '',
    contentType: 'application/json',
    sizeBytes: 11,
    ip: '127.0.0.1',
    receivedAt: '2026-11-18T10:00:00.000Z',
    query: {},
    headers: {
      host: ['api.hooklens.dev'],
      'content-length': ['11'],
      'x-forwarded-for': ['1.2.3.4'],
      'content-type': ['application/json'],
      'x-dup': ['uno', 'dos'],
    },
    body: btoa('{"a":"b"}\n'),
    ...overrides,
  };
}

function draft(overrides: Partial<ReplayDraft> = {}): ReplayDraft {
  return { ...createReplayDraft(request(), 'https://mi-app.dev/hooks'), ...overrides };
}

describe('createReplayDraft', () => {
  it('parte del último destino y de lo que se va a reenviar', () => {
    const created = createReplayDraft(request(), 'https://mi-app.dev/hooks');

    expect(created).toMatchObject({
      targetUrl: 'https://mi-app.dev/hooks',
      editing: false,
      method: 'POST',
      body: '{"a":"b"}\n',
      bodyEditable: true,
    });
    // Sin host, content-length ni los del proxy; los repetidos quedan en filas separadas.
    expect(created.headers.map((row) => [row.name, row.value])).toEqual([
      ['content-type', 'application/json'],
      ['x-dup', 'uno'],
      ['x-dup', 'dos'],
    ]);
  });

  it('un body binario no se puede editar', () => {
    const created = createReplayDraft(request({ body: btoa('ÿþ') }), null);
    expect(created).toMatchObject({ targetUrl: '', body: '', bodyEditable: false });
  });
});

describe('parseReplayDraft', () => {
  it('sin edición manda solo la URL: el API reenvía la request original', () => {
    expect(parseReplayDraft(draft({ method: 'PUT', body: 'ignorado' }))).toEqual({
      ok: true,
      input: { targetUrl: 'https://mi-app.dev/hooks' },
    });
  });

  it('con edición agrupa los headers repetidos y codifica el body en base64', () => {
    const parsed = parseReplayDraft(
      draft({
        editing: true,
        method: 'PUT',
        headers: [
          newHeaderRow('X-Dup', 'uno'),
          newHeaderRow('x-dup', 'dos'),
          newHeaderRow('', ''),
          newHeaderRow('x-nombre', 'José'),
        ],
        body: '{"editado":"sí"}',
      }),
    );

    expect(parsed.ok && parsed.input.headers).toEqual({
      'x-dup': ['uno', 'dos'],
      'x-nombre': ['José'],
    });
    expect(parsed.ok && parsed.input.method).toBe('PUT');
    const body = parsed.ok ? (parsed.input.body ?? '') : '';
    expect(new TextDecoder().decode(base64ToBytes(body))).toBe('{"editado":"sí"}');
  });

  it('un body vacío se manda como null (sin body)', () => {
    const parsed = parseReplayDraft(draft({ editing: true, body: '' }));
    expect(parsed.ok && parsed.input.body).toBeNull();
  });

  it('con body binario no incluye body: el API reenvía el original', () => {
    const parsed = parseReplayDraft(draft({ editing: true, bodyEditable: false }));
    expect(parsed.ok && 'body' in parsed.input).toBe(false);
  });

  it.each([
    ['vacía', ''],
    ['inválida', 'no es url'],
    ['con otro protocolo', 'ftp://mi-app.dev/'],
    ['con credenciales', 'https://user:pass@mi-app.dev/'],
  ])('rechaza una URL %s', (_case, targetUrl) => {
    const parsed = parseReplayDraft(draft({ targetUrl }));
    expect(!parsed.ok && parsed.errors.targetUrl).toBeTruthy();
  });

  it.each([
    ['nombre inválido', newHeaderRow('x header', 'a'), 'no es un nombre de header válido'],
    ['valor sin nombre', newHeaderRow('', 'huérfano'), 'sin nombre'],
    ['salto de línea', newHeaderRow('x-a', 'a\r\nb'), 'no admite'],
    ['fuera de latin-1', newHeaderRow('x-a', '🚀'), 'no admite'],
  ])('rechaza un header con %s', (_case, row, message) => {
    const parsed = parseReplayDraft(draft({ editing: true, headers: [row] }));
    expect(!parsed.ok && parsed.errors.headers).toContain(message);
  });
});
