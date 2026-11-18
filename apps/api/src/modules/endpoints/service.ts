import { eq } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { endpoints } from '../../db/schema.js';
import { isUniqueViolation } from '../../lib/errors.js';
import { generateOwnerToken, generateSlug, hashOwnerToken } from '../../lib/tokens.js';

const MAX_SLUG_ATTEMPTS = 3;

export interface CreatedEndpoint {
  slug: string;
  /** Token en claro: solo existe en esta respuesta, la base guarda su hash. */
  token: string;
  expiresAt: Date;
}

export async function createEndpoint(db: Database): Promise<CreatedEndpoint> {
  const token = generateOwnerToken();
  const ownerTokenHash = hashOwnerToken(token);

  // Con 60 bits de slug una colisión es casi imposible, pero el UNIQUE es la garantía real.
  for (let attempt = 1; ; attempt++) {
    try {
      const [row] = await db
        .insert(endpoints)
        .values({ slug: generateSlug(), ownerTokenHash })
        .returning({ slug: endpoints.slug, expiresAt: endpoints.expiresAt });
      if (!row) throw new Error('INSERT ... RETURNING no devolvió filas');
      return { slug: row.slug, token, expiresAt: row.expiresAt };
    } catch (err) {
      if (!isUniqueViolation(err) || attempt >= MAX_SLUG_ATTEMPTS) throw err;
    }
  }
}

export type EndpointForIngest = Pick<
  typeof endpoints.$inferSelect,
  'id' | 'expiresAt' | 'respStatus' | 'respHeaders' | 'respBody' | 'respDelayMs'
>;

export async function findEndpointForIngest(
  db: Database,
  slug: string,
): Promise<EndpointForIngest | undefined> {
  const [row] = await db
    .select({
      id: endpoints.id,
      expiresAt: endpoints.expiresAt,
      respStatus: endpoints.respStatus,
      respHeaders: endpoints.respHeaders,
      respBody: endpoints.respBody,
      respDelayMs: endpoints.respDelayMs,
    })
    .from(endpoints)
    .where(eq(endpoints.slug, slug))
    .limit(1);
  return row;
}
