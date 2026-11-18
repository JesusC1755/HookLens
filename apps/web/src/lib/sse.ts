import { type ApiError, bearer, toApiError } from './api';

// Cliente SSE sobre fetch: EventSource no permite mandar el header Authorization,
// y poner el token en la URL lo dejaría en logs de proxies y en el historial.

export interface SseEvent {
  event: string;
  data: string;
  id: string | null;
}

interface ParserHandlers {
  onEvent: (event: SseEvent) => void;
  onRetry: (ms: number) => void;
}

const LINE_BREAK = /\r\n|\r|\n/;
// Una línea sin fin indica un servidor roto: se corta antes de crecer sin límite.
const MAX_BUFFER_CHARS = 1024 * 1024;

/** Parser incremental del formato text/event-stream (WHATWG HTML, §9.2). */
export function createSseParser({ onEvent, onRetry }: ParserHandlers) {
  let buffer = '';
  let event = '';
  let data: string[] = [];
  let id: string | null = null;

  function dispatch() {
    if (data.length > 0) {
      onEvent({ event: event === '' ? 'message' : event, data: data.join('\n'), id });
    }
    event = '';
    data = [];
    id = null;
  }

  function processLine(line: string) {
    if (line === '') {
      dispatch();
      return;
    }
    if (line.startsWith(':')) return; // comentario (el heartbeat del servidor)

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const rawValue = colon === -1 ? '' : line.slice(colon + 1);
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;

    switch (field) {
      case 'event':
        event = value;
        break;
      case 'data':
        data.push(value);
        break;
      case 'id':
        if (!value.includes('\0')) id = value;
        break;
      case 'retry':
        if (/^\d+$/.test(value)) onRetry(Number(value));
        break;
      default:
        // La especificación pide ignorar los campos desconocidos.
        break;
    }
  }

  return {
    push(chunk: string) {
      buffer += chunk;
      let match: RegExpExecArray | null;
      while ((match = LINE_BREAK.exec(buffer)) !== null) {
        // Un \r al final puede ser la primera mitad de un \r\n que llega en el próximo chunk.
        if (match[0] === '\r' && match.index === buffer.length - 1) break;
        processLine(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
      }
      if (buffer.length > MAX_BUFFER_CHARS) throw new Error('Línea SSE demasiado larga');
    },
  };
}

export type StreamStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface EventStreamOptions {
  url: string;
  token: string;
  onEvent: (event: SseEvent) => void;
  onStatus: (status: StreamStatus, reason: string | null) => void;
  /** Error que reintentar no arregla (token inválido, endpoint expirado): el stream se detiene. */
  onFatalError: (error: ApiError) => void;
}

const FATAL_STATUSES = new Set([400, 401, 403, 404, 410]);
const DEFAULT_RETRY_MS = 3_000;
const MAX_RETRY_MS = 30_000;
// El servidor manda un ping cada 25 s. Si pasa más de un minuto sin datos, la
// conexión está muerta aunque TCP no se haya enterado (Wi-Fi caído, laptop suspendida).
const IDLE_TIMEOUT_MS = 60_000;
const IDLE_ABORT = Symbol('idle');

type Outcome = { kind: 'retry'; reason: string } | { kind: 'stop' };

/** Backoff exponencial con jitter, para que los clientes no reconecten todos a la vez. */
export function backoffDelay(baseMs: number, failures: number, random = Math.random): number {
  const exponential = Math.min(MAX_RETRY_MS, baseMs * 2 ** Math.max(0, failures - 1));
  return Math.round(exponential * (0.8 + random() * 0.4));
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish);
  });
}

/** Abre el stream y reconecta solo. Devuelve la función que lo cierra. */
export function openEventStream(options: EventStreamOptions): () => void {
  const closer = new AbortController();
  const isClosed = () => closer.signal.aborted;
  let retryMs = DEFAULT_RETRY_MS;
  let failures = 0;

  async function connectOnce(): Promise<Outcome> {
    const attempt = new AbortController();
    const abortAttempt = () => {
      attempt.abort();
    };
    closer.signal.addEventListener('abort', abortAttempt);
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const armIdleTimer = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        attempt.abort(IDLE_ABORT);
      }, IDLE_TIMEOUT_MS);
    };

    try {
      armIdleTimer();
      const res = await fetch(options.url, {
        headers: { ...bearer(options.token), accept: 'text/event-stream' },
        signal: attempt.signal,
        cache: 'no-store',
      });
      if (!res.ok) {
        const error = await toApiError(res);
        if (!FATAL_STATUSES.has(res.status)) return { kind: 'retry', reason: error.message };
        if (!isClosed()) options.onFatalError(error);
        return { kind: 'stop' };
      }
      if (res.body === null) return { kind: 'retry', reason: 'Respuesta sin body' };

      const parser = createSseParser({
        onEvent: (event) => {
          if (isClosed()) return;
          if (event.event === 'ready') {
            failures = 0;
            options.onStatus('open', null);
          }
          options.onEvent(event);
        },
        onRetry: (ms) => {
          retryMs = ms;
        },
      });
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return { kind: 'retry', reason: 'El servidor cerró la conexión' };
        armIdleTimer();
        parser.push(value);
      }
    } catch {
      const idle = attempt.signal.reason === IDLE_ABORT;
      return { kind: 'retry', reason: idle ? 'Sin señal del servidor' : 'Se perdió la conexión' };
    } finally {
      clearTimeout(idleTimer);
      closer.signal.removeEventListener('abort', abortAttempt);
    }
  }

  async function run() {
    while (!isClosed()) {
      const outcome = await connectOnce();
      if (isClosed()) return;
      if (outcome.kind === 'stop') {
        options.onStatus('closed', null);
        return;
      }
      failures += 1;
      options.onStatus('reconnecting', outcome.reason);
      await sleep(backoffDelay(retryMs, failures), closer.signal);
    }
  }

  void run();
  return () => {
    closer.abort();
  };
}
