import { timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { endpoints } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { hashOwnerToken, SLUG_PATTERN } from '../../lib/tokens.js';

// El esquema es insensible a mayúsculas (RFC 9110); el token es base64url de 43 caracteres.
const BEARER_PATTERN = /^Bearer ([A-Za-z0-9_-]{43})$/i;

/**
 * El token viaja solo en `Authorization`, nunca en la URL: las URLs quedan en
 * logs de proxies, en el historial del navegador y en el header Referer.
 */
export function extractBearerToken(authorization: string | undefined): string | null {
  return BEARER_PATTERN.exec(authorization ?? '')?.[1] ?? null;
}

/** Comparación en tiempo constante: el tiempo de respuesta no revela cuánto coincide. */
export function tokenMatchesHash(token: string, storedHash: string): boolean {
  const candidate = Buffer.from(hashOwnerToken(token), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

export function requireBearerToken(authorization: string | undefined): string {
  const token = extractBearerToken(authorization);
  if (token === null) {
    throw new AppError(401, 'MISSING_TOKEN', 'Falta el header Authorization: Bearer <token>');
  }
  return token;
}

export interface OwnedEndpoint {
  id: string;
  slug: string;
  expiresAt: Date;
}

/** Verifica que el token sea el dueño del endpoint y que este no haya expirado. */
export async function authorizeEndpoint(
  db: Database,
  slug: string,
  authorization: string | undefined,
): Promise<OwnedEndpoint> {
  const token = requireBearerToken(authorization);

  const [endpoint] = SLUG_PATTERN.test(slug)
    ? await db
        .select({
          id: endpoints.id,
          slug: endpoints.slug,
          ownerTokenHash: endpoints.ownerTokenHash,
          expiresAt: endpoints.expiresAt,
        })
        .from(endpoints)
        .where(eq(endpoints.slug, slug))
        .limit(1)
    : [];

  if (!endpoint) throw new AppError(404, 'ENDPOINT_NOT_FOUND', 'El endpoint no existe');
  if (!tokenMatchesHash(token, endpoint.ownerTokenHash)) {
    throw new AppError(403, 'FORBIDDEN', 'El token no corresponde a este endpoint');
  }
  if (endpoint.expiresAt.getTime() <= Date.now()) {
    throw new AppError(410, 'ENDPOINT_EXPIRED', 'El endpoint expiró');
  }
  return { id: endpoint.id, slug: endpoint.slug, expiresAt: endpoint.expiresAt };
}
