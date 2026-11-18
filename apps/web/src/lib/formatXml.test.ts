import { describe, expect, it } from 'vitest';
import { formatXml } from './formatXml';

describe('formatXml', () => {
  it('indenta y deja en una línea los elementos con solo texto', () => {
    const source =
      '<?xml version="1.0"?><pedido id="7"><item>Café</item><vacío/><nota></nota></pedido>';

    expect(formatXml(source)).toBe(
      [
        '<?xml version="1.0"?>',
        '<pedido id="7">',
        '  <item>Café</item>',
        '  <vacío/>',
        '  <nota></nota>',
        '</pedido>',
      ].join('\n'),
    );
  });

  it('copia las etiquetas tal cual, incluso con ">" dentro de un atributo', () => {
    expect(formatXml(`<a x='1>0' y="&amp;"><b>t</b></a>`)).toBe(
      `<a x='1>0' y="&amp;">\n  <b>t</b>\n</a>`,
    );
  });

  it('respeta comentarios y CDATA', () => {
    expect(formatXml('<a><!-- <no> --><![CDATA[<x>]]></a>')).toBe(
      '<a>\n  <!-- <no> -->\n  <![CDATA[<x>]]>\n</a>',
    );
  });

  it.each([
    ['etiquetas que no cierran', '<a><b></a>'],
    ['cierre sin apertura', '</a>'],
    ['etiqueta sin terminar', '<a><b</a>'],
  ])('devuelve null con %s', (_case, source) => {
    expect(formatXml(source)).toBeNull();
  });
});
