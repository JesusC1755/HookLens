import http, { type IncomingMessage } from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import type { MultiValueMap } from '../../db/types.js';
import { normalizeHeaders } from '../ingest/normalize.js';
import { isTargetNotAllowed, targetNotAllowed } from './ssrf.js';

export interface OutgoingRequest {
  url: URL;
  method: string;
  headers: MultiValueMap;
  body: Buffer | null;
}

export interface ReplayOutcome {
  status: number | null;
  headers: MultiValueMap | null;
  body: Buffer | null;
  durationMs: number;
  error: string | null;
}

export interface SendOptions {
  lookup: LookupFunction;
  timeoutMs: number;
  maxResponseBytes: number;
}

function errorCode(err: unknown): string | undefined {
  if (typeof err !== 'object' || err === null || !('code' in err)) return undefined;
  return typeof err.code === 'string' ? err.code : undefined;
}

function describeNetworkError(err: unknown, timedOut: boolean, timeoutMs: number): string {
  if (timedOut) return `Sin respuesta en ${timeoutMs / 1000} s`;
  const code = errorCode(err);
  switch (code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'No se pudo resolver el host';
    case 'ECONNREFUSED':
      return 'El destino rechazó la conexión';
    case 'ECONNRESET':
      return 'El destino cerró la conexión';
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return 'El destino no es alcanzable';
    case undefined:
      return 'Error de red';
    default:
      if (/CERT|TLS|SSL/.test(code)) return `Error de TLS (${code})`;
      return `Error de red (${code})`;
  }
}

/**
 * Envía la request con node:http y no con fetch: permite inyectar `lookup` (la
 * protección SSRF) y no sigue redirects. Un 302 hacia 169.254.169.254 es el bypass
 * clásico, así que un 3xx se guarda como respuesta y no se sigue.
 */
export async function sendRequest(
  outgoing: OutgoingRequest,
  { lookup, timeoutMs, maxResponseBytes }: SendOptions,
): Promise<ReplayOutcome> {
  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);
  // Cubre todo: DNS, conexión, TLS, espera y lectura del body.
  const signal = AbortSignal.timeout(timeoutMs);
  const failure = (err: unknown, partial: Pick<ReplayOutcome, 'status' | 'headers'>) => ({
    ...partial,
    body: null,
    durationMs: elapsed(),
    error: describeNetworkError(err, signal.aborted, timeoutMs),
  });

  const headers: http.OutgoingHttpHeaders = { ...outgoing.headers };
  if (outgoing.body !== null) headers['content-length'] = outgoing.body.length;

  let res: IncomingMessage;
  try {
    res = await new Promise<IncomingMessage>((resolve, reject) => {
      const transport = outgoing.url.protocol === 'https:' ? https : http;
      const req = transport.request(
        outgoing.url,
        // agent: false → socket nuevo por replay, sin reutilizar conexiones de un pool.
        { method: outgoing.method, headers, lookup, signal, agent: false },
        resolve,
      );
      req.on('error', reject);
      if (outgoing.body === null) req.end();
      else req.end(outgoing.body);
    });
  } catch (err) {
    if (isTargetNotAllowed(err)) throw targetNotAllowed();
    return failure(err, { status: null, headers: null });
  }

  const status = res.statusCode ?? 0;
  const responseHeaders = normalizeHeaders(res.rawHeaders);
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of res as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > maxResponseBytes) {
        res.destroy();
        return {
          status,
          headers: responseHeaders,
          body: null,
          durationMs: elapsed(),
          error: `La respuesta superó ${maxResponseBytes / (1024 * 1024)} MB: se descartó el body`,
        };
      }
      chunks.push(chunk);
    }
  } catch (err) {
    return failure(err, { status, headers: responseHeaders });
  }

  return {
    status,
    headers: responseHeaders,
    body: size === 0 ? null : Buffer.concat(chunks),
    durationMs: elapsed(),
    error: null,
  };
}
