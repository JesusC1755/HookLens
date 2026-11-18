import { customType } from 'drizzle-orm/pg-core';

/**
 * BYTEA ↔ Buffer. Drizzle no trae este tipo; `pg` ya serializa y deserializa
 * Buffer de forma nativa, así que el body nunca pasa por una decodificación UTF-8.
 */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

/** Headers y query normalizados: nombre → todos sus valores (conserva duplicados). */
export type MultiValueMap = Record<string, string[]>;
