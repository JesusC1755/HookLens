import { Link } from './components/Link';
import { EndpointPage } from './features/endpoints/EndpointPage';
import { HomePage } from './features/endpoints/HomePage';
import { type Route, useRoute } from './lib/router';

function renderRoute(route: Route) {
  switch (route.name) {
    case 'home':
      return <HomePage />;
    case 'endpoint':
      // key: al cambiar de endpoint se desmonta todo y se cierra el stream anterior.
      return <EndpointPage key={route.slug} slug={route.slug} />;
    case 'not-found':
      return (
        <div className="mx-auto max-w-xl px-4 py-16">
          <h1 className="text-xl font-semibold text-zinc-100">Página no encontrada</h1>
          <Link to="/" className="mt-4 inline-block text-sm text-emerald-300">
            ← Volver al inicio
          </Link>
        </div>
      );
  }
}

export function App() {
  const route = useRoute();
  return (
    <div className="flex h-dvh flex-col">
      <header className="border-b border-zinc-800 px-4 py-3">
        <Link to="/" className="font-semibold tracking-tight text-zinc-50">
          HookLens
        </Link>
      </header>
      <main className="flex min-h-0 flex-1 flex-col">{renderRoute(route)}</main>
    </div>
  );
}
