import { setTimeout as sleep } from 'node:timers/promises';
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import type { Database } from '../../db/client.js';
import { AppError } from '../../lib/errors.js';
import { SLUG_PATTERN } from '../../lib/tokens.js';
import { findEndpointForIngest } from '../endpoints/service.js';
import { normalizeHeaders, normalizeIp, parseIngestUrl } from './normalize.js';
import { recordRequest } from './service.js';

export const INGEST_BODY_LIMIT_BYTES = 1024 * 1024;

interface IngestRoutesOptions {
  db: Database;
}

type IngestRequest = FastifyRequest<{ Params: { slug: string } }>;

/**
 * Plugin encapsulado: los cambios de parser y el hook solo afectan a /wh/*,
 * el resto de la API conserva el parser JSON de Fastify.
 */
export const ingestRoutes: FastifyPluginCallback<IngestRoutesOptions> = (app, { db }, done) => {
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
    await recordRequest(db, {
      endpointId: endpoint.id,
      method: request.method,
      ...parseIngestUrl(request.url),
      headers,
      body,
      contentType: headers['content-type']?.[0] ?? null,
      sizeBytes: body?.length ?? 0,
      ip: normalizeIp(request.ip),
    });

    if (endpoint.respDelayMs > 0) await sleep(endpoint.respDelayMs);

    return reply.code(endpoint.respStatus).headers(endpoint.respHeaders).send(endpoint.respBody);
  };

  const routeOptions = { bodyLimit: INGEST_BODY_LIMIT_BYTES };
  app.all('/wh/:slug', routeOptions, handler);
  app.all('/wh/:slug/*', routeOptions, handler);

  done();
};
