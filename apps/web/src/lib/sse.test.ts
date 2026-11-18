import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiError } from './api';
import {
  backoffDelay,
  createSseParser,
  openEventStream,
  type SseEvent,
  type StreamStatus,
} from './sse';

function parse(chunks: string[]) {
  const events: SseEvent[] = [];
  const retries: number[] = [];
  const parser = createSseParser({
    onEvent: (event) => events.push(event),
    onRetry: (ms) => retries.push(ms),
  });
  for (const chunk of chunks) parser.push(chunk);
  return { events, retries };
}

describe('createSseParser', () => {
  it('parsea eventos con id, tipo y data', () => {
    const { events } = parse(['id: 1\nevent: request\ndata: {"a":1}\n\n']);
    expect(events).toEqual([{ event: 'request', data: '{"a":1}', id: '1' }]);
  });

  it('arma un evento que llega partido en varios chunks', () => {
    const { events } = parse(['eve', 'nt: ready\nda', 'ta: {}', '\n', '\n']);
    expect(events).toEqual([{ event: 'ready', data: '{}', id: null }]);
  });

  it('acepta CRLF aunque el \\r y el \\n lleguen en chunks distintos', () => {
    // Un \r al final de un chunk queda en espera hasta ver si le sigue un \n.
    const { events } = parse(['data: uno\r', '\n\r\n', 'data: dos\r\r', 'data: tres\n\n']);
    expect(events.map((e) => e.data)).toEqual(['uno', 'dos', 'tres']);
  });

  it('ignora los comentarios del heartbeat y los bloques sin data', () => {
    const { events } = parse([': ping\n\n', 'event: vacio\n\n', 'data: x\n\n']);
    expect(events).toEqual([{ event: 'message', data: 'x', id: null }]);
  });

  it('une varias líneas data con saltos de línea', () => {
    const { events } = parse(['data: a\ndata: b\n\n']);
    expect(events[0]?.data).toBe('a\nb');
  });

  it('informa retry solo si es numérico', () => {
    const { retries } = parse(['retry: 3000\n\nretry: tres\n\n']);
    expect(retries).toEqual([3000]);
  });

  it('corta una línea que crece sin fin', () => {
    const parser = createSseParser({ onEvent: vi.fn(), onRetry: vi.fn() });
    expect(() => {
      parser.push('x'.repeat(1024 * 1024 + 1));
    }).toThrow('Línea SSE demasiado larga');
  });
});

describe('backoffDelay', () => {
  it('crece exponencialmente con tope de 30 s', () => {
    const noJitter = () => 0.5;
    expect(backoffDelay(3_000, 1, noJitter)).toBe(3_000);
    expect(backoffDelay(3_000, 3, noJitter)).toBe(12_000);
    expect(backoffDelay(3_000, 10, noJitter)).toBe(30_000);
  });
});

const encoder = new TextEncoder();
const READY = 'retry: 10\n\nevent: ready\ndata: {}\n\n';

function sseResponse(text: string, signal?: AbortSignal | null, keepOpen = false) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      // Igual que fetch real: abortar la request corta el body.
      signal?.addEventListener('abort', () => {
        controller.error(new DOMException('abortado', 'AbortError'));
      });
      if (!keepOpen) controller.close();
    },
  });
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('openEventStream', () => {
  const fetchMock = vi.fn<typeof fetch>();
  let events: SseEvent[];
  let statuses: { status: StreamStatus; reason: string | null }[];
  let fatal: ApiError[];
  let close: () => void = () => undefined;

  function open() {
    close = openEventStream({
      url: 'http://api.test/stream',
      token: 'secreto',
      onEvent: (event) => events.push(event),
      onStatus: (status, reason) => statuses.push({ status, reason }),
      onFatalError: (error) => fatal.push(error),
    });
  }

  beforeEach(() => {
    events = [];
    statuses = [];
    fatal = [];
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    close();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('manda el token en Authorization, nunca en la URL', async () => {
    fetchMock.mockImplementation((_url, init) =>
      Promise.resolve(sseResponse(READY, init?.signal, true)),
    );
    open();

    await vi.waitFor(() => {
      expect(statuses).toContainEqual({ status: 'open', reason: null });
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('http://api.test/stream');
    expect(init?.headers).toMatchObject({ authorization: 'Bearer secreto' });
  });

  it('reconecta cuando el servidor cierra el stream', async () => {
    fetchMock.mockImplementation((_url, init) => Promise.resolve(sseResponse(READY, init?.signal)));
    open();

    await vi.waitFor(() => {
      expect(events.filter((event) => event.event === 'ready').length).toBeGreaterThanOrEqual(2);
    });
    expect(statuses).toContainEqual({
      status: 'reconnecting',
      reason: 'El servidor cerró la conexión',
    });
  });

  it('se detiene ante un error que reintentar no arregla', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(410, { error: { code: 'ENDPOINT_EXPIRED', message: 'El endpoint expiró' } }),
    );
    open();

    await vi.waitFor(() => {
      expect(statuses).toContainEqual({ status: 'closed', reason: null });
    });
    expect(fatal[0]).toMatchObject({ status: 410, code: 'ENDPOINT_EXPIRED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reintenta con backoff ante un error transitorio', async () => {
    vi.useFakeTimers();
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(503, { error: { code: 'DATABASE_UNAVAILABLE', message: 'DB caída' } }),
      )
      .mockImplementation((_url, init) => Promise.resolve(sseResponse(READY, init?.signal, true)));
    open();

    await vi.advanceTimersByTimeAsync(0);
    expect(statuses).toEqual([{ status: 'reconnecting', reason: 'DB caída' }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Backoff inicial: 3 s ± 20 %.
    await vi.advanceTimersByTimeAsync(3_600);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(statuses.at(-1)).toEqual({ status: 'open', reason: null });
  });

  it('reconecta si pasa un minuto sin datos (conexión muerta)', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url, init) =>
      Promise.resolve(sseResponse(READY, init?.signal, true)),
    );
    open();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(60_000);

    expect(statuses).toContainEqual({ status: 'reconnecting', reason: 'Sin señal del servidor' });
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('al cerrar no vuelve a conectar ni notifica', async () => {
    fetchMock.mockImplementation((_url, init) =>
      Promise.resolve(sseResponse(READY, init?.signal, true)),
    );
    open();
    await vi.waitFor(() => {
      expect(events).toHaveLength(1);
    });

    close();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(statuses).toEqual([{ status: 'open', reason: null }]);
  });
});
