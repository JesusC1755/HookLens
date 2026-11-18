import { buildApp } from './app.js';
import { loadEnv } from './config/env.js';
import { createDb } from './db/client.js';

const env = loadEnv();

const { db, pool } = createDb(env.DATABASE_URL, (err) => {
  app.log.error({ err }, 'error en un cliente inactivo del pool de Postgres');
});

const app = buildApp({
  db,
  publicBaseUrl: env.PUBLIC_BASE_URL,
  trustProxy: env.TRUST_PROXY,
  corsOrigins: env.CORS_ORIGINS,
  logger: { level: env.LOG_LEVEL },
});

app.addHook('onClose', async () => {
  await pool.end();
});

// Cierre ordenado: deja de aceptar conexiones, termina las requests en curso y cierra el pool.
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'apagando el servidor');
    app.close().then(
      () => process.exit(0),
      (err: unknown) => {
        app.log.error({ err }, 'error durante el apagado');
        process.exit(1);
      },
    );
  });
}

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (err) {
  app.log.fatal({ err }, 'no se pudo iniciar el servidor');
  await pool.end();
  process.exit(1);
}
