import { setTimeout as sleep } from 'node:timers/promises';
import type { RateLimitPluginOptions } from '@fastify/rate-limit';
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import type { Database } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import type { Limit } from '../../lib/rate-limit.js';
import { SLUG_PATTERN } from '../../lib/tokens.js';
import { findEndpointForIngest } from '../endpoints/service.js';
import type { EndpointBus } from '../requests/events.js';
import { normalizeHeaders, normalizeIp, parseIngestUrl } from './normalize.js';
import { recordRequest, type Retention, trimRequests } from './service.js';

export const INGEST_BODY_LIMIT_BYTES = 1024 * 1024;

/**
 * Cualquiera puede crear un endpoint que responda HTML. Sin esto, la URL del webhook
 * serviría una página con scripts en el dominio del API (phishing, XSS alojado):
 * `sandbox` la aísla en un origen opaco y sin scripts, `nosniff` evita que el navegador
 * reinterprete el content-type. El usuario no puede sobrescribirlos (BLOCKED_RESPONSE_HEADERS).
 */
const INGEST_SECURITY_HEADERS = {
  'content-security-policy': 'sandbox',
  'x-content-type-options': 'nosniff',
};
const DEFAULT_RESPONSE_CONTENT_TYPE = 'text/plain; charset=utf-8';

interface IngestRoutesOptions {
  db: Database;
  /** La ingesta solo publica: no sabe quién escucha (SSE, CLI…). */
  bus: Pick<EndpointBus, 'publish'>;
  limit: Limit;
  retention: Retention;
}

type IngestRequest = FastifyRequest<{ Params: { slug: string } }>;

/**
 * Plugin encapsulado: los cambios de parser y el hook solo afectan a /wh/*,
 * el resto de la API conserva el parser JSON de Fastify.
 */
export const ingestRoutes: FastifyPluginCallback<IngestRoutesOptions> = (
  app,
  { db, bus, limit, retention },
  done,
) => {
  // Cualquier content-type, incluso ausente, llega al handler como Buffer sin tocar.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, body, parsed) => {
    parsed(null, body);
  });

  // Fastify responde 415 a un Content-Type malformado antes de llamar a cualquier parser.
  // Un inspector debe capturar justamente esas requests, así que se neutraliza aquí;
  // el valor original sigue intacto en `rawHeaders`, de donde se leen los headers a guardar.
  app.addHook('onRequest', (request, _reply, next) => {
    if (request.raw.headers['content-type'] !== undefined) {
      request.raw.headers['content-type'] = 'application/octet-stream';
    }
    next();
  });

  const handler = async (request: IngestRequest, reply: FastifyReply) => {
    const { slug } = request.params;
    const endpoint = SLUG_PATTERN.test(slug) ? await findEndpointForIngest(db, slug) : undefined;
    if (!endpoint) {
      throw new AppError(404, 'ENDPOINT_NOT_FOUND', 'El endpoint no existe');
    }
    if (endpoint.expiresAt.getTime() <= Date.now()) {
      throw new AppError(410, 'ENDPOINT_EXPIRED', 'El endpoint expiró');
    }

    const headers = normalizeHeaders(request.raw.rawHeaders);
    const body = Buffer.isBuffer(request.body) && request.body.length > 0 ? request.body : null;

    // Se persiste antes del retraso: si el emisor corta por timeout, la request no se pierde.
    const summary = await recordRequest(db, {
      endpointId: endpoint.id,
      method: request.method,
      ...parseIngestUrl(request.url),
      headers,
      body,
      contentType: headers['content-type']?.[0] ?? null,
      sizeBytes: body?.length ?? 0,
      ip: normalizeIp(request.ip),
    });
    await trimRequests(db, endpoint.id, retention);
    // Se publica después del insert: quien reciba el evento ya puede pedir el detalle.
    bus.publish(slug, { type: 'request', request: summary });

    if (endpoint.respDelayMs > 0) await sleep(endpoint.respDelayMs);

    // Buffer y no string: con un string Fastify le agrega "; charset=utf-8" al
    // content-type configurado, y la respuesta debe salir tal cual se definió.
    return reply
      .code(endpoint.respStatus)
      .headers({
        'content-type': DEFAULT_RESPONSE_CONTENT_TYPE,
        ...endpoint.respHeaders,
        ...INGEST_SECURITY_HEADERS,
      })
      .send(Buffer.from(endpoint.respBody, 'utf8'));
  };

  const limiterOptions: RateLimitPluginOptions = {
    max: limit.max,
    timeWindow: limit.timeWindowMs,
    // Por slug: la ingesta es pública y muchos emisores comparten IP (GitHub, Stripe).
    keyGenerator: (request) => `slug:${(request.params as { slug: string }).slug}`,
    // Sin x-ratelimit-* en las respuestas normales: el emisor debe recibir exactamente
    // la respuesta configurada. Al exceder, solo retry-after. (Las opciones reemplazan
    // el objeto entero, por eso van todas las claves.)
    addHeadersOnExceeding: {
      'x-ratelimit-limit': false,
      'x-ratelimit-remaining': false,
      'x-ratelimit-reset': false,
    },
    addHeaders: {
      'x-ratelimit-limit': false,
      'x-ratelimit-remaining': false,
      'x-ratelimit-reset': false,
      'retry-after': true,
    },
  };
  const routeOptions = {
    bodyLimit: INGEST_BODY_LIMIT_BYTES,
    // Un solo limitador para las dos rutas: con `config.rateLimit` por ruta, el almacén
    // en memoria crea un contador por ruta y /wh/x y /wh/x/algo tendrían el doble de cupo.
    // Va en onRequest: una request rechazada no llega a leerse (hasta 1 MB) ni a tocar la base.
    onRequest: app.rateLimit(limiterOptions),
  };
  app.all<{ Params: { slug: string } }>('/wh/:slug', routeOptions, handler);
  app.all<{ Params: { slug: string } }>('/wh/:slug/*', routeOptions, handler);

  done();
};
