import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from '../../components/Link';
import { createEndpoint } from '../../lib/api';
import { formatExpiry } from '../../lib/format';
import { endpointPath, navigate } from '../../lib/router';
import { forgetEndpoint, saveEndpoint, useStoredEndpoints } from '../../lib/storage';
import { useNow } from '../../lib/useNow';

const HOW_IT_WORKS = [
  ['Crea un endpoint', 'Obtienes una URL única, válida por 7 días.'],
  ['Apunta tus webhooks', 'GitHub, Stripe, Slack o cualquier sistema que haga requests HTTP.'],
  ['Inspecciona y reenvía', 'Headers, body tal cual llegó, diff entre requests y replay.'],
] as const;

export function HomePage() {
  const now = useNow();
  const endpoints = useStoredEndpoints().filter((entry) => Date.parse(entry.expiresAt) > now);
  const [storageError, setStorageError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => createEndpoint(),
    onSuccess: ({ slug, token, url, expiresAt }) => {
      try {
        saveEndpoint({ slug, token, url, expiresAt });
      } catch {
        setStorageError(
          'El navegador no permite guardar el token (almacenamiento bloqueado). Sin él no podrás ver las requests de este endpoint.',
        );
        return;
      }
      navigate(endpointPath(slug));
    },
  });

  function forget(slug: string) {
    const confirmed = window.confirm(
      'Se borrará el token de este navegador y no podrás volver a ver las requests de este endpoint. ¿Continuar?',
    );
    if (confirmed) forgetEndpoint(slug);
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-2xl px-4 py-10 sm:py-16">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-50 sm:text-3xl">
          Inspecciona webhooks de cualquier proveedor
        </h1>
        <p className="mt-3 text-zinc-400">
          Crea una URL temporal, apúntale tus webhooks y mira cada request en vivo, tal como llegó.
          Sin cuenta: el acceso queda guardado en este navegador durante 7 días.
        </p>

        <button
          type="button"
          disabled={create.isPending}
          onClick={() => {
            setStorageError(null);
            create.mutate();
          }}
          className="mt-8 rounded-md bg-emerald-500 px-4 py-2 font-medium text-zinc-950 transition hover:bg-emerald-400 disabled:opacity-60"
        >
          {create.isPending ? 'Creando…' : 'Crear endpoint'}
        </button>

        {(create.isError || storageError !== null) && (
          <p role="alert" className="mt-3 text-sm text-rose-300">
            {storageError ?? `No se pudo crear el endpoint: ${create.error?.message ?? ''}`}
          </p>
        )}

        {endpoints.length === 0 && (
          <ol className="mt-12 grid gap-4 text-sm sm:grid-cols-3">
            {HOW_IT_WORKS.map(([title, text], index) => (
              <li key={title} className="rounded-md border border-zinc-800 p-4">
                <p className="font-mono text-xs text-emerald-300">{index + 1}</p>
                <p className="mt-1 font-medium text-zinc-200">{title}</p>
                <p className="mt-1 text-zinc-500">{text}</p>
              </li>
            ))}
          </ol>
        )}

        {endpoints.length > 0 && (
          <section className="mt-14">
            <h2 className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
              Tus endpoints
            </h2>
            <ul className="mt-3 divide-y divide-zinc-800 rounded-md border border-zinc-800">
              {endpoints.map((entry) => (
                <li key={entry.slug} className="flex items-center gap-4 px-4 py-3">
                  <Link
                    to={endpointPath(entry.slug)}
                    className="font-mono text-sm text-zinc-100 hover:text-emerald-300"
                  >
                    {entry.slug}
                  </Link>
                  <span className="flex-1 text-xs text-zinc-500">
                    {formatExpiry(entry.expiresAt, now)}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      forget(entry.slug);
                    }}
                    className="text-xs text-zinc-500 hover:text-rose-300"
                  >
                    Olvidar
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
