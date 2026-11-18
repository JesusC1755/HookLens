import { describe, expect, it } from 'vitest';
import { formatJson, tokensToText } from './formatJson';

function pretty(source: string): string | null {
  const tokens = formatJson(source);
  return tokens === null ? null : tokensToText(tokens);
}

describe('formatJson', () => {
  it('indenta objetos y arrays anidados', () => {
    expect(pretty('{"a":1,"b":[true,null],"c":{}}')).toBe(
      ['{', '  "a": 1,', '  "b": [', '    true,', '    null', '  ],', '  "c": {}', '}'].join('\n'),
    );
  });

  it('no pierde precisión en enteros de 64 bits ni cambia la forma de los números', () => {
    const source = '{"id":9007199254740993,"monto":1.0,"exp":1E+3}';

    expect(pretty(source)).toContain('9007199254740993');
    expect(pretty(source)).toContain('1.0');
    expect(pretty(source)).toContain('1E+3');
    // Lo que haría JSON.parse + stringify:
    expect(JSON.stringify(JSON.parse(source))).toContain('9007199254740992');
  });

  it('conserva los escapes de los strings tal cual llegaron', () => {
    expect(pretty('{"t":"caf\\u00e9 \\"x\\" ,:{}"}')).toBe(
      '{\n  "t": "caf\\u00e9 \\"x\\" ,:{}"\n}',
    );
  });

  it('distingue claves de valores string', () => {
    const tokens = formatJson('{"clave":"valor"}') ?? [];

    expect(tokens.find((t) => t.text === '"clave"')?.kind).toBe('key');
    expect(tokens.find((t) => t.text === '"valor"')?.kind).toBe('string');
  });

  it('acepta valores sueltos y espacios extra', () => {
    expect(pretty('  42  ')).toBe('42');
    expect(pretty('[ ]')).toBe('[]');
  });

  it('devuelve null si no es JSON válido', () => {
    expect(formatJson('{"a":')).toBeNull();
    expect(formatJson("{'a':1}")).toBeNull();
  });
});
