import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isPublicAddress } from '../src/modules/replays/ssrf.js';
import type { ReplayDetail, ReplaySummary } from '../src/modules/replays/serializers.js';
import type { RequestSummary } from '../src/modules/requests/serializers.js';
import { buildTestApp, createEndpoint, type TestEndpoint } from './helpers/app.js';
import { createTestDb, resetDb } from './helpers/db.js';

// El destino es un servidor local real. Para alcanzarlo, esta app permite loopback;
// `strict` usa la política de producción y prueba que ahí queda bloqueado.
const handle = createTestDb();
const allowLoopback = (ip: string) =>
  ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || isPublicAddress(ip);
const app = buildTestApp(handle.db, {
  replay: { isAllowedAddress: allowLoopback, timeoutMs: 500 },
});
const strict = buildTestApp(handle.db);

interface Received {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  rawHeaders: string[];
  body: Buffer;
}

let received: Received[] = [];
let respond: (req: IncomingMessage, res: ServerResponse) => void;
const target = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (chunk: Buffer) => chunks.push(chunk));
  req.on('end', () => {
    received.push({
      method: req.method ?? '',
      url: req.url ?? '',
      headers: req.headers,
      rawHeaders: req.rawHeaders,
      body: Buffer.concat(chunks),
    });
    respond(req, res);
  });
});
let targetUrl: string;
let owner: TestEndpoint;

beforeAll(async () => {
  await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
  targetUrl = `http://127.0.0.1:${(target.address() as AddressInfo).port}`;
});

beforeEach(async () => {
  await resetDb(handle);
  owner = await createEndpoint(app);
  received = [];
  respond = (_req, res) => {
    res.writeHead(202, { 'content-type': 'application/json', 'x-target': 'ok' });
    res.end('{"recibido":true}');
  };
});

afterAll(async () => {
  target.closeAllConnections();
  await new Promise((resolve) => target.close(resolve));
  await app.close();
  await strict.close();
  await handle.pool.end();
});

const BINARY_BODY = Buffer.from([0x7b, 0x00, 0xff, 0x0a, 0x7d]);

async function captureRequest(): Promise<string> {
  await app.inject({
    method: 'POST',
    url: `/wh/${owner.slug}/github?a=1`,
    headers: {
      'content-type': 'application/octet-stream',
      'x-hub-signature-256': 'sha256=abc',
      'x-dup': ['uno', 'dos'],
      'x-forwarded-for': '1.2.3.4',
      'accept-encoding': 'gzip',
    },
    payload: BINARY_BODY,
  });
  const list = await app.inject({
    method: 'GET',
    url: `/api/endpoints/${owner.slug}/requests`,
    headers: owner.auth,
  });
  const id = list.json<{ items: RequestSummary[] }>().items[0]?.id;
  if (!id) throw new Error('no se capturó la request');
  return id;
}

function replay(id: string, payload: Record<string, unknown>, server = app) {
  return server.inject({
    method: 'POST',
    url: `/api/requests/${id}/replays`,
    headers: owner.auth,
    payload,
  });
}

describe('POST /api/requests/:id/replays', () => {
  it('sin ediciones reenvía método, headers y body exactamente como llegaron', async () => {
    const id = await captureRequest();

    const res = await replay(id, { targetUrl: `${targetUrl}/hooks/github?entorno=staging` });

    expect(res.statusCode).toBe(201);
    const [sent] = received;
    expect(sent?.method).toBe('POST');
    expect(sent?.url).toBe('/hooks/github?entorno=staging');
    expect(sent?.body.equals(BINARY_BODY)).toBe(true);
    expect(sent?.headers['x-hub-signature-256']).toBe('sha256=abc');
    // Los headers repetidos viajan como líneas separadas, no unidos por coma.
    expect(sent?.rawHeaders.filter((_v, i, all) => all[i - 1] === 'x-dup')).toEqual(['uno', 'dos']);
    expect(sent?.headers['content-length']).toBe(String(BINARY_BODY.length));
  });

  it('no reenvía headers hop-by-hop ni los que agregó la infraestructura', async () => {
    const id = await captureRequest();

    await replay(id, { targetUrl });

    const headers = received[0]?.headers ?? {};
    expect(headers['x-forwarded-for']).toBeUndefined();
    expect(headers['accept-encoding']).toBeUndefined();
    expect(headers.host).toBe(new URL(targetUrl).host);
  });

  it('guarda la respuesta del destino en el historial', async () => {
    const id = await captureRequest();

    const res = await replay(id, { targetUrl });
    const detail = res.json<ReplayDetail>();

    expect(detail).toMatchObject({
      requestId: id,
      method: 'POST',
      status: 202,
      error: null,
      response: { headers: { 'x-target': ['ok'] } },
    });
    expect(Buffer.from(detail.response?.body ?? '', 'base64').toString()).toBe('{"recibido":true}');
    expect(detail.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('aplica las ediciones: método, headers y body', async () => {
    const id = await captureRequest();

    const res = await replay(id, {
      targetUrl,
      method: 'PUT',
      headers: { 'content-type': ['application/json'], 'x-editado': ['sí'] },
      body: Buffer.from('{"editado":true}').toString('base64'),
    });

    expect(res.statusCode).toBe(201);
    const [sent] = received;
    expect(sent?.method).toBe('PUT');
    expect(sent?.body.toString()).toBe('{"editado":true}');
    expect(sent?.headers['x-hub-signature-256']).toBeUndefined();
    // HTTP/1.1 transporta los headers en latin-1: "í" (0xED) cabe en un byte y llega igual.
    expect(sent?.headers['x-editado']).toBe('sí');
    expect(res.json<ReplayDetail>().sent.headers).toEqual({
      'content-type': ['application/json'],
      'x-editado': ['sí'],
    });
  });

  it('body null envía la request sin body', async () => {
    const id = await captureRequest();

    await replay(id, { targetUrl, body: null });

    expect(received[0]?.body.length).toBe(0);
  });

  it('no sigue redirects: un 302 se guarda como respuesta', async () => {
    respond = (_req, res) => {
      res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
      res.end();
    };
    const id = await captureRequest();

    const res = await replay(id, { targetUrl });

    expect(res.json<ReplayDetail>()).toMatchObject({ status: 302, error: null });
    expect(received).toHaveLength(1);
  });

  it('registra el error si el destino rechaza la conexión', async () => {
    const id = await captureRequest();

    // El puerto 1 en loopback no tiene nada escuchando.
    const res = await replay(id, { targetUrl: 'http://127.0.0.1:1/' });

    expect(res.statusCode).toBe(201);
    expect(res.json<ReplayDetail>()).toMatchObject({
      status: null,
      response: null,
      error: 'El destino rechazó la conexión',
    });
  });

  it('corta por timeout si el destino no responde', async () => {
    respond = () => {
      // Nunca responde.
    };
    const id = await captureRequest();

    const res = await replay(id, { targetUrl });

    expect(res.json<ReplayDetail>()).toMatchObject({
      status: null,
      error: 'Sin respuesta en 0.5 s',
    });
  });

  it('descarta un body de respuesta mayor a 1 MB, pero guarda el status', async () => {
    respond = (_req, res) => {
      res.writeHead(200);
      res.end(Buffer.alloc(1024 * 1024 + 1));
    };
    const id = await captureRequest();

    const res = await replay(id, { targetUrl });

    expect(res.json<ReplayDetail>()).toMatchObject({
      status: 200,
      response: { body: null },
      error: 'La respuesta superó 1 MB: se descartó el body',
    });
  });

  it.each([
    ['un método no permitido', { method: 'CONNECT' }],
    ['un header con salto de línea', { headers: { 'x-a': ['ok\r\nx-inyectado: 1'] } }],
    ['un header fuera de latin-1', { headers: { 'x-a': ['🚀'] } }],
    ['un body que no es base64', { body: 'no es base64!' }],
  ])('responde 400 con %s', async (_case, override) => {
    const id = await captureRequest();

    const res = await replay(id, { targetUrl, ...override });

    expect(res.statusCode).toBe(400);
    expect(received).toHaveLength(0);
  });

  it('con el token de otro endpoint responde 404 y no envía nada', async () => {
    const id = await captureRequest();
    const intruder = await createEndpoint(app);

    const res = await app.inject({
      method: 'POST',
      url: `/api/requests/${id}/replays`,
      headers: intruder.auth,
      payload: { targetUrl },
    });

    expect(res.statusCode).toBe(404);
    expect(received).toHaveLength(0);
  });
});

describe('protección SSRF (política de producción)', () => {
  it.each([
    ['la IP de loopback', () => targetUrl],
    ['un nombre que resuelve a loopback', () => targetUrl.replace('127.0.0.1', 'localhost')],
    ['el servicio de metadatos de la nube', () => 'http://169.254.169.254/latest/meta-data/'],
    ['una IPv6 privada', () => 'http://[fd00::1]/'],
  ])('bloquea %s con 422, sin enviar ni guardar nada', async (_case, url) => {
    const id = await captureRequest();

    const res = await replay(id, { targetUrl: url() }, strict);

    expect(res.statusCode).toBe(422);
    expect(res.json()).toMatchObject({ error: { code: 'TARGET_NOT_ALLOWED' } });
    expect(received).toHaveLength(0);
    const history = await app.inject({
      method: 'GET',
      url: `/api/requests/${id}/replays`,
      headers: owner.auth,
    });
    expect(history.json<{ items: unknown[] }>().items).toHaveLength(0);
  });
});

describe('historial de replays', () => {
  it('lista del más reciente al más antiguo, sin bodies', async () => {
    const id = await captureRequest();
    await replay(id, { targetUrl: `${targetUrl}/primero` });
    await replay(id, { targetUrl: `${targetUrl}/segundo` });

    const res = await app.inject({
      method: 'GET',
      url: `/api/requests/${id}/replays`,
      headers: owner.auth,
    });

    const items = res.json<{ items: ReplaySummary[] }>().items;
    expect(items.map((item) => new URL(item.targetUrl).pathname)).toEqual(['/segundo', '/primero']);
    expect(items[0]).not.toHaveProperty('response');
  });

  it('devuelve el detalle de un replay solo a su dueño', async () => {
    const id = await captureRequest();
    const created = (await replay(id, { targetUrl })).json<ReplayDetail>();
    const intruder = await createEndpoint(app);

    const own = await app.inject({
      method: 'GET',
      url: `/api/replays/${created.id}`,
      headers: owner.auth,
    });
    const foreign = await app.inject({
      method: 'GET',
      url: `/api/replays/${created.id}`,
      headers: intruder.auth,
    });

    expect(own.json<ReplayDetail>()).toEqual(created);
    expect(foreign.statusCode).toBe(404);
  });

  it('al vaciar el endpoint se borran también sus replays', async () => {
    const id = await captureRequest();
    const created = (await replay(id, { targetUrl })).json<ReplayDetail>();

    await app.inject({
      method: 'DELETE',
      url: `/api/endpoints/${owner.slug}/requests`,
      headers: owner.auth,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/replays/${created.id}`,
      headers: owner.auth,
    });
    expect(res.statusCode).toBe(404);
  });
});
