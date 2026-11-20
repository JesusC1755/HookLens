import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

// El front tiene su propio .env (apps/web/.env), separado del API: si leyera el
// .env raíz heredaría NODE_ENV=development y empaquetaría React en modo desarrollo.
const ENV_DIR = fileURLToPath(new URL('.', import.meta.url));

/**
 * CSP estricta en el HTML del build: sin scripts ni estilos inline, y la app solo puede
 * conectarse a sí misma y al API. Va en <meta> para que `connect-src` salga de la misma
 * VITE_API_URL del build; lo que un <meta> no admite (frame-ancestors) va en los headers
 * del hosting (vercel.json). En `vite dev` no se aplica: el HMR necesita inline y websockets.
 */
function contentSecurityPolicy(apiUrl: string): Plugin {
  const policy = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${new URL(apiUrl).origin}`,
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');

  return {
    name: 'hooklens:csp',
    apply: 'build',
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
        // Antes que cualquier script: la política solo rige lo que viene después.
        injectTo: 'head-prepend',
      },
    ],
  };
}

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, ENV_DIR, 'VITE_');
  const apiUrl = env.VITE_API_URL ?? '';
  if (command === 'build') {
    // Sin esto, un build de producción apuntaría en silencio a localhost.
    if (apiUrl === '') {
      throw new Error('Falta VITE_API_URL: el build necesita la URL pública del API');
    }
    if (!URL.canParse(apiUrl)) {
      throw new Error(`VITE_API_URL no es una URL válida: ${apiUrl}`);
    }
  }

  return {
    envDir: ENV_DIR,
    plugins: [
      react(),
      tailwindcss(),
      ...(command === 'build' ? [contentSecurityPolicy(apiUrl)] : []),
    ],
  };
});
