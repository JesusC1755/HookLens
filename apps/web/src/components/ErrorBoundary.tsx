import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Último recurso: si un componente lanza al renderizar (un body inesperado, un bug),
 * se muestra esto en vez de una pantalla en blanco. React solo lo permite con clases.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Error de render', error, info.componentStack);
  }

  override render() {
    if (this.state.error === null) return this.props.children;
    return (
      <div role="alert" className="mx-auto max-w-xl px-4 py-16">
        <h1 className="text-xl font-semibold text-zinc-100">Algo salió mal</h1>
        <p className="mt-2 text-sm text-zinc-400">
          La página encontró un error inesperado. Tus endpoints siguen guardados en este navegador.
        </p>
        <p className="mt-3 rounded-md bg-zinc-900 p-3 font-mono text-xs break-all text-rose-300">
          {this.state.error.message}
        </p>
        <button
          type="button"
          onClick={() => {
            window.location.reload();
          }}
          className="mt-6 rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-zinc-950 hover:bg-emerald-400"
        >
          Recargar
        </button>
      </div>
    );
  }
}
