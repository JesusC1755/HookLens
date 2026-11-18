export interface SseEvent {
  event: string;
  data: string;
  id?: string;
}

/**
 * Lector SSE mínimo sobre fetch, el mismo enfoque que usará el front (EventSource
 * no permite enviar el header Authorization).
 */
export function openSseReader(body: ReadableStream<Uint8Array>) {
  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  const queue: SseEvent[] = [];
  let buffer = '';

  function drainBuffer() {
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event: SseEvent = { event: 'message', data: '' };
      let hasData = false;
      for (const line of block.split('\n')) {
        if (line.startsWith(':')) continue; // comentario (heartbeat)
        const [field, ...rest] = line.split(':');
        const value = rest.join(':').replace(/^ /, '');
        if (field === 'event') event.event = value;
        if (field === 'id') event.id = value;
        if (field === 'data') {
          event.data += value;
          hasData = true;
        }
      }
      if (hasData) queue.push(event);
      boundary = buffer.indexOf('\n\n');
    }
  }

  return {
    /** Devuelve el siguiente evento con datos o falla tras `timeoutMs`. */
    async next(timeoutMs = 2_000): Promise<SseEvent> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const queued = queue.shift();
        if (queued) return queued;
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('timeout esperando un evento SSE');
        const chunk = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) =>
            setTimeout(() => {
              reject(new Error('timeout esperando un evento SSE'));
            }, remaining),
          ),
        ]);
        if (chunk.done) throw new Error('el stream SSE se cerró');
        buffer += chunk.value;
        drainBuffer();
      }
    },
    cancel: () => reader.cancel(),
  };
}

/** Reintenta `check` hasta que devuelva true; útil para esperar efectos asíncronos. */
export async function waitFor(check: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('waitFor: la condición no se cumplió a tiempo');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
