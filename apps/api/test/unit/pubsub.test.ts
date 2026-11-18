import { describe, expect, it, vi } from 'vitest';
import { createMemoryPubSub } from '../../src/lib/pubsub.js';

describe('createMemoryPubSub', () => {
  it('entrega cada evento solo a los suscriptores de su canal', () => {
    const bus = createMemoryPubSub<number>();
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe('a', a);
    bus.subscribe('b', b);

    bus.publish('a', 1);

    expect(a).toHaveBeenCalledWith(1);
    expect(b).not.toHaveBeenCalled();
  });

  it('la función devuelta desuscribe y libera el canal', () => {
    const bus = createMemoryPubSub<number>();
    const listener = vi.fn();
    const unsubscribe = bus.subscribe('a', listener);
    expect(bus.subscriberCount('a')).toBe(1);

    unsubscribe();
    unsubscribe(); // idempotente
    bus.publish('a', 1);

    expect(listener).not.toHaveBeenCalled();
    expect(bus.subscriberCount('a')).toBe(0);
  });

  it('un suscriptor que falla no impide que los demás reciban el evento', () => {
    const onError = vi.fn();
    const bus = createMemoryPubSub<number>(onError);
    const healthy = vi.fn();
    bus.subscribe('a', () => {
      throw new Error('roto');
    });
    bus.subscribe('a', healthy);

    expect(() => {
      bus.publish('a', 1);
    }).not.toThrow();
    expect(healthy).toHaveBeenCalledWith(1);
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'roto' }));
  });

  it('desuscribirse durante el envío no salta a otros suscriptores', () => {
    const bus = createMemoryPubSub<number>();
    const second = vi.fn();
    const unsubscribeFirst = bus.subscribe('a', () => {
      unsubscribeFirst();
    });
    bus.subscribe('a', second);

    bus.publish('a', 1);

    expect(second).toHaveBeenCalledOnce();
  });
});
