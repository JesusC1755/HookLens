import { useEffect, useState } from 'react';

/**
 * Devuelve `value` cuando deja de cambiar durante `delayMs`. `value` debe mantener su
 * identidad mientras no cambie (estado o useMemo): con un objeto nuevo en cada render
 * el temporizador se reiniciaría sin fin.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(value);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [value, delayMs]);
  return debounced;
}
