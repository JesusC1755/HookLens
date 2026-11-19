import type { FastifyPluginCallback } from 'fastify';
import type { Database } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { authorizeEndpoint } from '../endpoints/auth.js';
import type { EndpointBus, EndpointEvent } from '../requests/events.js';

// Por debajo del timeout de inactividad típico de proxies y balanceadores (~60 s).
const HEARTBEAT_INTERVAL_MS = 25_000;
// Tiempo que el navegador espera antes de reconectar si se corta la conexión.
const CLIENT_RETRY_MS = 3_000;
// Cada stream mantiene un socket abierto: se limita por endpoint para que un
// token filtrado no pueda agotar las conexiones del servidor.
export const MAX_STREAMS_PER_ENDPOINT = 5;
// Si el cliente no consume y el buffer crece, se corta: al reconectar recupera
// el estado con la lista paginada, en lugar de acumular memoria en el servidor.
const MAX_BUFFERED_BYTES = 1024 * 1024;
// setTimeout se desborda por encima de 2^31-1 ms (~24,8 días) y dispara al instante.
const MAX_TIMER_MS = 2 ** 31 - 1;

interface StreamRoutesOptions {
  db: Database;
  bus: EndpointBus;
}

function toSseMessage(event: EndpointEvent): string {
  switch (event.type) {
    case 'request':
      return formatEvent('request', event.request, event.request.id);
    case 'cleared':
      return formatEvent('cleared', {});
  }
}

function formatEvent(event: string, data: unknown, id?: string): string {
  // JSON.stringify escapa los saltos de línea, así que `data` ocupa una sola línea.
  return `${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export const streamRoutes: FastifyPluginCallback<StreamRoutesOptions> = (
  app,
  { db, bus },
  done,
) => {
  const openStreams = new Set<() => void>();

  // Un stream abierto nunca termina por sí solo: sin esto, app.close() esperaría
  // para siempre a que se cierren las conexiones.
  app.addHook('preClose', (hookDone) => {
    for (const close of openStreams) close();
    hookDone();
  });

  app.get<{ Params: { slug: string } }>(
    '/api/endpoints/:slug/stream',
    {
      schema: {
        params: {
          type: 'object',
          properties: { slug: { type: 'string', maxLength: 64 } },
          required: ['slug'],
        },
      },
    },
    async (request, reply) => {
      const endpoint = await authorizeEndpoint(
        db,
        request.params.slug,
        request.headers.authorization,
      );
      if (bus.subscriberCount(endpoint.slug) >= MAX_STREAMS_PER_ENDPOINT) {
        throw new AppError(
          429,
          'TOO_MANY_STREAMS',
          'Demasiadas conexiones abiertas para este endpoint',
        );
      }

      // A partir de aquí Fastify deja de gestionar la respuesta. Los headers que ya
      // puso algún hook (CORS) se copian a mano, porque no pasarían por onSend.
      reply.hijack();
      const res = reply.raw;
      for (const [name, value] of Object.entries(reply.getHeaders())) {
        if (value !== undefined) res.setHeader(name, value);
      }
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        // Desactiva el buffering de nginx y proxies compatibles.
        'x-accel-buffering': 'no',
      });

      let closed = false;

      const unsubscribe = bus.subscribe(endpoint.slug, (event) => {
        write(toSseMessage(event));
      });
      const heartbeat = setInterval(() => {
        write(': ping\n\n');
      }, HEARTBEAT_INTERVAL_MS);
      // Al vencer, el cliente se entera en el momento: sin esto el stream seguiría
      // abierto y mudo hasta que el job de expiración borrara el endpoint.
      const expiry = setTimeout(
        () => {
          write(formatEvent('expired', {}));
          close();
        },
        Math.min(MAX_TIMER_MS, Math.max(0, endpoint.expiresAt.getTime() - Date.now())),
      );

      function close() {
        if (closed) return;
        closed = true;
        unsubscribe();
        clearInterval(heartbeat);
        clearTimeout(expiry);
        openStreams.delete(close);
        res.end();
      }

      function write(chunk: string) {
        if (closed) return;
        res.write(chunk);
        if (res.writableLength > MAX_BUFFERED_BYTES) {
          request.log.warn({ slug: endpoint.slug }, 'stream SSE cerrado: el cliente no consume');
          close();
        }
      }

      openStreams.add(close);
      request.raw.on('close', close);

      // `ready` avisa al cliente que ya está suscrito: recién entonces pide la lista,
      // así ninguna request que llegue en medio se pierde (se deduplica por id).
      write(`retry: ${CLIENT_RETRY_MS}\n\n`);
      write(formatEvent('ready', { slug: endpoint.slug }));
    },
  );

  done();
};
