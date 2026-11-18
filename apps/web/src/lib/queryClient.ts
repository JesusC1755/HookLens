import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

function shouldRetry(failureCount: number, error: Error): boolean {
  // Un 4xx no cambia al reintentar (token inválido, endpoint expirado, id inexistente).
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetry,
      // Los datos en vivo llegan por SSE: refrescar al volver a la pestaña solo duplica tráfico.
      refetchOnWindowFocus: false,
    },
    mutations: { retry: false },
  },
});
