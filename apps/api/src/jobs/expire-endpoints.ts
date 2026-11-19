import { inArray, lte, sql } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import type { Database } from '../db/client.js';
import { endpoints } from '../db/schema.js';

// Por lotes: un solo DELETE de miles de endpoints (con sus requests en cascada) sería
// una transacción larga que bloquea filas mientras la ingesta sigue escribiendo.
export const EXPIRATION_BATCH_SIZE = 200;
// Clave arbitraria pero fija del advisory lock del job.
export const EXPIRATION_LOCK_KEY = 0x484c_4558; // "HLEX"

/**
 * Borra los endpoints vencidos; sus requests y replays caen por ON DELETE CASCADE.
 * Con varias instancias del API, el advisory lock hace que un solo proceso trabaje
 * cada lote y los demás lo salteen en vez de esperar. Devuelve cuántos borró.
 */
export async function deleteExpiredEndpoints(db: Database, now = new Date()): Promise<number> {
  let total = 0;
  for (;;) {
    const deleted = await db.transaction(async (tx) => {
      const lock = await tx.execute<{ locked: boolean }>(
        sql`SELECT pg_try_advisory_xact_lock(${EXPIRATION_LOCK_KEY}) AS locked`,
      );
      if (lock.rows[0]?.locked !== true) return null;

      const expired = tx
        .select({ id: endpoints.id })
        .from(endpoints)
        .where(lte(endpoints.expiresAt, now))
        .limit(EXPIRATION_BATCH_SIZE);
      const rows = await tx
        .delete(endpoints)
        .where(inArray(endpoints.id, expired))
        .returning({ id: endpoints.id });
      return rows.length;
    });
    if (deleted === null) return total; // otra instancia está trabajando
    total += deleted;
    if (deleted < EXPIRATION_BATCH_SIZE) return total;
  }
}

export interface ExpirationJob {
  /** Detiene el intervalo y espera la pasada en curso (para cerrar el pool después). */
  stop(): Promise<void>;
}

export function startExpirationJob({
  db,
  log,
  intervalMs,
}: {
  db: Database;
  log: FastifyBaseLogger;
  intervalMs: number;
}): ExpirationJob {
  let running: Promise<void> | null = null;

  const run = () => {
    // Si una pasada tarda más que el intervalo, la siguiente se saltea.
    if (running !== null) return;
    running = deleteExpiredEndpoints(db)
      .then(
        (deleted) => {
          if (deleted > 0) log.info({ deleted }, 'endpoints expirados borrados');
        },
        (err: unknown) => {
          log.error({ err }, 'falló el job de expiración');
        },
      )
      .finally(() => {
        running = null;
      });
  };

  run();
  const timer = setInterval(run, intervalMs);
  // No mantiene vivo el proceso: al cerrar el servidor no queda esperando el intervalo.
  timer.unref();

  return {
    async stop() {
      clearInterval(timer);
      await running;
    },
  };
}
