import { describe, expect, it } from 'vitest';
import { newHeaderRow } from '../../lib/headers';
import { parseDraft, type ResponseDraft, toDraft } from './responseDraft';

function draft(overrides: Partial<ResponseDraft> = {}): ResponseDraft {
  return { status: '200', delayMs: '0', body: '', headers: [], ...overrides };
}

describe('parseDraft', () => {
  it('convierte el formulario en la configuración que espera el API', () => {
    const parsed = parseDraft(
      draft({
        status: '201',
        delayMs: '1500',
        body: '{"ok":true}',
        headers: [newHeaderRow(' Content-Type ', 'application/json'), newHeaderRow('', '')],
      }),
    );

    expect(parsed).toEqual({
      ok: true,
      config: {
        status: 201,
        delayMs: 1500,
        body: '{"ok":true}',
        headers: { 'content-type': 'application/json' },
      },
    });
  });

  it.each([
    ['status', { status: '99' }],
    ['status', { status: '600' }],
    ['status', { status: '2e2' }],
    ['status', { status: '' }],
    ['delayMs', { delayMs: '-5' }],
    ['delayMs', { delayMs: '10001' }],
    ['body', { body: 'x'.repeat(32 * 1024 + 1) }],
  ])('marca el campo %s con %j', (field, overrides) => {
    const parsed = parseDraft(draft(overrides));
    expect(!parsed.ok && Object.keys(parsed.errors)).toEqual([field]);
  });

  it.each([
    ['nombre inválido', [newHeaderRow('x header', 'a')], 'no es un nombre de header válido'],
    ['header bloqueado', [newHeaderRow('Content-Length', '3')], 'no se puede configurar'],
    [
      'duplicado sin importar mayúsculas',
      [newHeaderRow('X-A', '1'), newHeaderRow('x-a', '2')],
      'repetido',
    ],
    ['valor con salto de línea', [newHeaderRow('x-a', 'a\nb')], 'ASCII imprimible'],
    ['valor sin nombre', [newHeaderRow('', 'huérfano')], 'sin nombre'],
  ])('rechaza headers: %s', (_case, headers, message) => {
    const parsed = parseDraft(draft({ headers }));
    expect(!parsed.ok && parsed.errors.headers).toContain(message);
  });
});

describe('toDraft', () => {
  it('ida y vuelta sin perder datos', () => {
    const config = { status: 503, delayMs: 200, body: 'caído', headers: { 'retry-after': '30' } };
    expect(parseDraft(toDraft(config))).toEqual({ ok: true, config });
  });
});
