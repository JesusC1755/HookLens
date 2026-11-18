import type { MultiValueMap } from './types';

export type BodyFormat = 'json' | 'xml' | 'form' | 'text';

export interface DetectedFormat {
  format: BodyFormat;
  /** true si lo dijo el content-type; false si se dedujo mirando el contenido. */
  declared: boolean;
}

/** "Application/JSON; charset=utf-8" → "application/json" */
export function mediaType(contentType: string | null): string | null {
  const essence = contentType?.split(';', 1)[0]?.trim().toLowerCase();
  return essence === undefined || essence === '' ? null : essence;
}

/**
 * Decide cómo mostrar un body de texto. Manda el content-type; solo si falta o es
 * genérico se mira el contenido (hay proveedores que mandan JSON como text/plain).
 */
export function detectFormat(contentType: string | null, text: string): DetectedFormat {
  const media = mediaType(contentType);
  if (media === 'application/json' || media === 'text/json' || media?.endsWith('+json')) {
    return { format: 'json', declared: true };
  }
  if (media === 'application/xml' || media === 'text/xml' || media?.endsWith('+xml')) {
    return { format: 'xml', declared: true };
  }
  if (media === 'application/x-www-form-urlencoded') return { format: 'form', declared: true };

  const generic = media === null || media === 'text/plain' || media === 'application/octet-stream';
  if (generic) {
    const start = text.trimStart();
    if (start.startsWith('{') || start.startsWith('[')) return { format: 'json', declared: false };
    if (start.startsWith('<?xml')) return { format: 'xml', declared: false };
  }
  return { format: 'text', declared: false };
}

/** application/x-www-form-urlencoded → { campo: [valores] }, igual que la query. */
export function parseFormBody(text: string): MultiValueMap {
  const values = new Map<string, string[]>();
  for (const [name, value] of new URLSearchParams(text)) {
    const list = values.get(name);
    if (list) list.push(value);
    else values.set(name, [value]);
  }
  return Object.fromEntries(values);
}
