import { createHash, randomBytes } from 'node:crypto';

// Base32 en minúsculas: seguro en URLs, sin caracteres ambiguos para el usuario
// y sin sesgo de módulo, porque 256 es múltiplo de 32.
const SLUG_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';
const SLUG_LENGTH = 12; // 60 bits de entropía: imposible de adivinar por fuerza bruta.
const TOKEN_BYTES = 32; // 256 bits.

/** Permite descartar slugs malformados sin consultar la base. */
export const SLUG_PATTERN = new RegExp(`^[${SLUG_ALPHABET}]{${SLUG_LENGTH}}$`);

export function generateSlug(): string {
  const bytes = randomBytes(SLUG_LENGTH);
  let slug = '';
  for (const byte of bytes) slug += SLUG_ALPHABET.charAt(byte & 31);
  return slug;
}

export function generateOwnerToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * SHA-256 sin sal ni bcrypt: el token es aleatorio de 256 bits, no una contraseña,
 * así que no hay diccionario contra el que atacar el hash.
 */
export function hashOwnerToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
