import { diffLines } from 'diff';
import { describe, expect, it } from 'vitest';
import { bytesToBase64 } from '../../lib/body';
import { diffBodies, diffHeaders, toDiffLines, toggleComparison } from './diff';

const json = (text: string) => ({
  body: bytesToBase64(new TextEncoder().encode(text)),
  contentType: 'application/json',
});

describe('toggleComparison', () => {
  it('agrega, quita y conserva solo las dos últimas', () => {
    expect(toggleComparison([], 'a')).toEqual(['a']);
    expect(toggleComparison(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleComparison(['a', 'b'], 'c')).toEqual(['b', 'c']);
    expect(toggleComparison(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('diffHeaders', () => {
  it('clasifica cada header como igual, cambiado, agregado o quitado', () => {
    const rows = diffHeaders(
      { 'x-igual': ['1'], 'x-cambia': ['a'], 'x-quitado': ['q'], 'x-orden': ['1', '2'] },
      { 'x-igual': ['1'], 'x-cambia': ['b'], 'x-nuevo': ['n'], 'x-orden': ['2', '1'] },
    );

    expect(Object.fromEntries(rows.map((row) => [row.name, row.status]))).toEqual({
      'x-cambia': 'changed',
      'x-igual': 'same',
      'x-nuevo': 'added',
      // El orden de los valores repetidos importa: es como llegaron.
      'x-orden': 'changed',
      'x-quitado': 'removed',
    });
  });
});

describe('diffBodies', () => {
  it('detecta bodies idénticos byte a byte, incluido sin body', () => {
    expect(diffBodies(json('{"a":1}'), json('{"a":1}'))).toEqual({ kind: 'identical' });
    expect(
      diffBodies({ body: null, contentType: null }, { body: null, contentType: null }),
    ).toEqual({ kind: 'identical' });
  });

  it('avisa cuando solo cambia el formato (rompería una firma HMAC)', () => {
    expect(diffBodies(json('{"a":1,"b":2}'), json('{\n  "a": 1,\n  "b": 2\n}'))).toEqual({
      kind: 'format-only',
    });
  });

  it('compara JSON reindentado: la diferencia queda en la línea que cambió', () => {
    const result = diffBodies(json('{"a":1,"b":2,"c":3}'), json('{"a":1,"b":20,"c":3}'));

    expect(result.kind).toBe('text');
    if (result.kind !== 'text') return;
    expect(result.json).toBe(true);
    const changed = toDiffLines(result.changes).filter((line) => line.kind !== 'same');
    expect(changed).toEqual([
      { kind: 'removed', text: '  "b": 2,' },
      { kind: 'added', text: '  "b": 20,' },
    ]);
  });

  it('no reemplaza un id grande por su versión redondeada', () => {
    const result = diffBodies(json('{"id":9007199254740993}'), json('{"id":9007199254740995}'));

    expect(result.kind === 'text' && result.changes.map((c) => c.value).join('')).toContain(
      '9007199254740993',
    );
  });

  it('con un body binario solo compara tamaños', () => {
    const binary = { body: bytesToBase64(new Uint8Array([0xff, 0xfe])), contentType: null };

    expect(diffBodies(binary, json('{}'))).toEqual({ kind: 'binary', sizeBefore: 2, sizeAfter: 2 });
  });

  it('se rinde con bodies demasiado distintos en vez de colgar la pestaña', () => {
    const lines = (seed: string) =>
      Array.from({ length: 6000 }, (_, i) => `${seed}${i}`).join('\n');

    expect(
      diffBodies(
        { body: bytesToBase64(new TextEncoder().encode(lines('a'))), contentType: 'text/plain' },
        { body: bytesToBase64(new TextEncoder().encode(lines('b'))), contentType: 'text/plain' },
      ),
    ).toEqual({ kind: 'too-large' });
  });
});

describe('toDiffLines', () => {
  it('pliega las líneas sin cambios lejos de una diferencia', () => {
    const before = Array.from({ length: 20 }, (_, i) => `línea ${i}`).join('\n') + '\n';
    const after = before.replace('línea 10\n', 'línea diez\n');

    const lines = toDiffLines(diffLines(before, after));

    expect(lines.filter((line) => line.kind === 'skipped')).toEqual([
      { kind: 'skipped', count: 7 },
      { kind: 'skipped', count: 6 },
    ]);
    expect(lines.filter((line) => line.kind === 'same')).toHaveLength(6);
  });
});
