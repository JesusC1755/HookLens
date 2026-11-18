export type JsonTokenKind = 'key' | 'string' | 'number' | 'literal' | 'punctuation' | 'whitespace';

export interface JsonToken {
  kind: JsonTokenKind;
  text: string;
}

const WHITESPACE = new Set([' ', '\t', '\n', '\r']);
const VALUE_END = new Set([...WHITESPACE, ',', ']', '}', ':']);

/**
 * Reindenta JSON sin convertirlo a valores. JSON.parse + JSON.stringify cambiaría lo
 * que llegó: un id de 64 bits (9007199254740993) pierde precisión, `1.0` pasa a `1`
 * y `é` a `é`. Aquí cada token se copia tal cual; solo cambia el espacio en blanco.
 * Devuelve null si el texto no es JSON válido.
 */
export function formatJson(source: string, indent = '  '): JsonToken[] | null {
  try {
    JSON.parse(source);
  } catch {
    return null;
  }

  const tokens: JsonToken[] = [];
  let depth = 0;
  const push = (kind: JsonTokenKind, text: string) => tokens.push({ kind, text });
  const newline = () => {
    push('whitespace', `\n${indent.repeat(depth)}`);
  };
  const skipWhitespace = (from: number) => {
    let j = from;
    while (WHITESPACE.has(source.charAt(j))) j++;
    return j;
  };

  // El texto ya es JSON válido, así que el recorrido puede confiar en su estructura.
  let i = 0;
  while (i < source.length) {
    const char = source.charAt(i);

    if (WHITESPACE.has(char)) {
      i++;
    } else if (char === '"') {
      let j = i + 1;
      while (source.charAt(j) !== '"') j += source.charAt(j) === '\\' ? 2 : 1;
      const isKey = source.charAt(skipWhitespace(j + 1)) === ':';
      push(isKey ? 'key' : 'string', source.slice(i, j + 1));
      i = j + 1;
    } else if (char === '{' || char === '[') {
      const close = char === '{' ? '}' : ']';
      const next = skipWhitespace(i + 1);
      if (source.charAt(next) === close) {
        push('punctuation', char + close);
        i = next + 1;
      } else {
        push('punctuation', char);
        depth++;
        newline();
        i++;
      }
    } else if (char === '}' || char === ']') {
      depth--;
      newline();
      push('punctuation', char);
      i++;
    } else if (char === ',') {
      push('punctuation', ',');
      newline();
      i++;
    } else if (char === ':') {
      push('punctuation', ':');
      push('whitespace', ' ');
      i++;
    } else {
      let j = i;
      while (j < source.length && !VALUE_END.has(source.charAt(j))) j++;
      const text = source.slice(i, j);
      push(/^[-\d]/.test(text) ? 'number' : 'literal', text);
      i = j;
    }
  }
  return tokens;
}

export function tokensToText(tokens: readonly JsonToken[]): string {
  return tokens.map((token) => token.text).join('');
}
