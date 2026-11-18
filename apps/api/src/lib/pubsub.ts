export type Listener<T> = (event: T) => void;

/**
 * Pub/sub por canal (un canal = un slug). La ingesta solo conoce `publish`:
 * agregar suscriptores (SSE hoy, el WebSocket del CLI después) o pasar a Redis
 * no la toca.
 */
export interface PubSub<T> {
  publish(channel: string, event: T): void;
  /** Devuelve la función para desuscribirse. */
  subscribe(channel: string, listener: Listener<T>): () => void;
  subscriberCount(channel: string): number;
}

/**
 * Implementación en memoria: sirve con una sola instancia del API. Con varias, un
 * evento publicado en la instancia A no llegaría a un suscriptor conectado a B;
 * ahí se reemplaza por Redis pub/sub detrás de esta misma interfaz.
 *
 * Map<canal, Set> en lugar de EventEmitter: sin límite de listeners que ajustar
 * y con aislamiento de errores por suscriptor.
 */
export function createMemoryPubSub<T>(onListenerError?: (err: unknown) => void): PubSub<T> {
  const channels = new Map<string, Set<Listener<T>>>();

  return {
    publish(channel, event) {
      // Copia: un listener que se desuscribe durante el envío no altera la iteración.
      for (const listener of [...(channels.get(channel) ?? [])]) {
        // Un suscriptor roto no debe impedir que los demás reciban el evento,
        // ni hacer fallar a quien publica.
        try {
          listener(event);
        } catch (err) {
          onListenerError?.(err);
        }
      }
    },

    subscribe(channel, listener) {
      let listeners = channels.get(channel);
      if (!listeners) {
        listeners = new Set();
        channels.set(channel, listeners);
      }
      listeners.add(listener);

      return () => {
        const current = channels.get(channel);
        if (!current) return;
        current.delete(listener);
        if (current.size === 0) channels.delete(channel);
      };
    },

    subscriberCount(channel) {
      return channels.get(channel)?.size ?? 0;
    },
  };
}
