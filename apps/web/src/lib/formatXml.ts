type XmlTokenKind = 'open' | 'close' | 'self-closing' | 'other' | 'text';

interface XmlToken {
  kind: XmlTokenKind;
  text: string;
}

// Los valores de atributo pueden contener ">", por eso las comillas se reconocen aparte.
const ATTRIBUTES = `(?:[^>"']|"[^"]*"|'[^']*')*`;
const XML_TOKEN = new RegExp(
  [
    '<!--[\\s\\S]*?-->',
    '<!\\[CDATA\\[[\\s\\S]*?\\]\\]>',
    '<\\?[\\s\\S]*?\\?>',
    `<!${ATTRIBUTES}>`,
    `</?[A-Za-z_][^\\s/>]*${ATTRIBUTES}>`,
    '[^<]+',
  ].join('|'),
  'y',
);
const TAG_NAME = /^<\/?([^\s/>]+)/;

function tokenize(source: string): XmlToken[] | null {
  const tokens: XmlToken[] = [];
  XML_TOKEN.lastIndex = 0;
  while (XML_TOKEN.lastIndex < source.length) {
    const match = XML_TOKEN.exec(source);
    if (match === null) return null; // un "<" que no abre nada válido
    const text = match[0];
    if (!text.startsWith('<')) {
      const trimmed = text.trim();
      if (trimmed !== '') tokens.push({ kind: 'text', text: trimmed });
    } else if (text.startsWith('</')) {
      tokens.push({ kind: 'close', text });
    } else if (text.startsWith('<!') || text.startsWith('<?')) {
      tokens.push({ kind: 'other', text });
    } else {
      tokens.push({ kind: text.endsWith('/>') ? 'self-closing' : 'open', text });
    }
  }
  return tokens;
}

function tagName(tag: string): string {
  return TAG_NAME.exec(tag)?.[1] ?? '';
}

/**
 * Reindenta XML copiando cada etiqueta tal cual (no se re-serializa con DOMParser,
 * que normalizaría comillas y entidades). Devuelve null si las etiquetas no cuadran.
 */
export function formatXml(source: string, indent = '  '): string | null {
  const tokens = tokenize(source);
  if (tokens === null) return null;

  const lines: string[] = [];
  const open: string[] = [];
  const pad = () => indent.repeat(open.length);

  for (let k = 0; k < tokens.length; k++) {
    const token = tokens[k];
    if (token === undefined) break;

    if (token.kind === 'open') {
      const next = tokens[k + 1];
      const afterNext = tokens[k + 2];
      const name = tagName(token.text);
      // <a>texto</a> y <a></a> quedan en una sola línea.
      if (
        next?.kind === 'text' &&
        afterNext?.kind === 'close' &&
        tagName(afterNext.text) === name
      ) {
        lines.push(pad() + token.text + next.text + afterNext.text);
        k += 2;
      } else if (next?.kind === 'close' && tagName(next.text) === name) {
        lines.push(pad() + token.text + next.text);
        k += 1;
      } else {
        lines.push(pad() + token.text);
        open.push(name);
      }
    } else if (token.kind === 'close') {
      if (open.pop() !== tagName(token.text)) return null;
      lines.push(pad() + token.text);
    } else {
      lines.push(pad() + token.text);
    }
  }
  return open.length === 0 ? lines.join('\n') : null;
}
