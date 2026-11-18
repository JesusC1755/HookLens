import type { FastifyError, FastifyInstance } from 'fastify';

/** Error de dominio con status y código estable para el cliente. */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// Errores de red de Node y códigos SQLSTATE de Postgres que indican que la base
// no está disponible (y no que la query sea incorrecta).
const DB_UNAVAILABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  '57P01', // admin_shutdown
  '57P02', // crash_shutdown
  '57P03', // cannot_connect_now
  '53300', // too_many_connections
]);

const DB_UNAVAILABLE_MESSAGES = [
  'timeout exceeded when trying to connect',
  'Connection terminated',
];

/** Recorre la cadena de `cause` (Drizzle envuelve el error de `pg`). */
export function isDatabaseUnavailable(err: unknown, depth = 0): boolean {
  if (depth > 5 || !(err instanceof Error)) return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code === 'string' && DB_UNAVAILABLE_CODES.has(code)) return true;
  if (DB_UNAVAILABLE_MESSAGES.some((m) => err.message.includes(m))) return true;
  if (
    err instanceof AggregateError &&
    err.errors.some((e) => isDatabaseUnavailable(e, depth + 1))
  ) {
    return true;
  }
  return isDatabaseUnavailable(err.cause, depth + 1);
}

export function isUniqueViolation(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code =
    (err as { code?: unknown }).code ?? (err.cause as { code?: unknown } | undefined)?.code;
  return code === '23505';
}

/** Formato de error uniforme para toda la API: `{ error: { code, message } }`. */
export function registerErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler<FastifyError | AppError>((err, request, reply) => {
    if (err instanceof AppError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
    }

    if (err.validation) {
      return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: err.message } });
    }

    // Errores del propio Fastify con status 4xx (413 por body grande, 400 por JSON inválido…).
    if (err.statusCode !== undefined && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
    }

    if (isDatabaseUnavailable(err)) {
      request.log.error({ err }, 'base de datos no disponible');
      return reply.code(503).send({
        error: { code: 'DATABASE_UNAVAILABLE', message: 'Servicio temporalmente no disponible' },
      });
    }

    request.log.error({ err }, 'error no controlado');
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Error interno' } });
  });

  app.setNotFoundHandler((_request, reply) => {
    return reply
      .code(404)
      .send({ error: { code: 'ROUTE_NOT_FOUND', message: 'Ruta no encontrada' } });
  });
}
