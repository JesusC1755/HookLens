import { inArray, or, type SQL, sql } from 'drizzle-orm';
import { requests } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';

export interface RequestFilters {
  methods: string[];
  /** Texto libre: path, query, headers y body. */
  q: string | null;
  /** Presencia de un header, o un valor exacto si se da `value`. */
  header: { name: string; value: string | null } | null;
}

export interface RawFilters {
  method?: string;
  q?: string;
  header?: string;
}

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/** `x-github-event` (presencia) o `x-github-event:push` (valor exacto). */
function parseHeaderFilter(raw: string): RequestFilters['header'] {
  const colon = raw.indexOf(':');
  const name = (colon === -1 ? raw : raw.slice(0, colon)).trim().toLowerCase();
  if (!HEADER_NAME.test(name)) {
    throw new AppError(
      400,
      'INVALID_FILTER',
      'El filtro de header debe ser "nombre" o "nombre:valor"',
    );
  }
  return { name, value: colon === -1 ? null : raw.slice(colon + 1).trim() };
}

export function parseFilters({ method, q, header }: RawFilters): RequestFilters {
  const text = q?.trim() ?? '';
  return {
    methods: method === undefined ? [] : method.toUpperCase().split(','),
    q: text === '' ? null : text,
    header: header === undefined || header.trim() === '' ? null : parseHeaderFilter(header),
  };
}

// En LIKE, %, _ y \ son comodines: el texto del usuario se busca literal.
const likePattern = (text: string) => `%${text.replace(/[\\%_]/g, '\\$&')}%`;

export function filterConditions({ methods, q, header }: RequestFilters): SQL[] {
  const conditions: SQL[] = [];
  if (methods.length > 0) conditions.push(inArray(requests.method, methods));

  if (q !== null) {
    const pattern = likePattern(q);
    const textMatch = or(
      sql`(${requests.path} || '?' || ${requests.rawQuery}) ILIKE ${pattern}`,
      sql`${requests.headers}::text ILIKE ${pattern}`,
      // Sobre los bytes y no con convert_from(body, 'UTF8'): un body binario haría
      // fallar la consulta entera. position() en bytea busca la secuencia exacta.
      sql`position(${Buffer.from(q, 'utf8')}::bytea in ${requests.body}) > 0`,
    );
    if (textMatch) conditions.push(textMatch);
  }

  if (header !== null) {
    // Los nombres se guardan en minúsculas; los valores son un array por header.
    conditions.push(
      header.value === null
        ? sql`${requests.headers} ? ${header.name}`
        : sql`${requests.headers} @> ${JSON.stringify({ [header.name]: [header.value] })}::jsonb`,
    );
  }
  return conditions;
}
