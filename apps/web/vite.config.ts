import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

// El front tiene su propio .env (apps/web/.env), separado del API: si leyera el
// .env raíz heredaría NODE_ENV=development y empaquetaría React en modo desarrollo.
const ENV_DIR = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, ENV_DIR, 'VITE_');
  // Sin esto, un build de producción apuntaría en silencio a localhost.
  if (command === 'build' && !env.VITE_API_URL) {
    throw new Error('Falta VITE_API_URL: el build necesita la URL pública del API');
  }

  return {
    envDir: ENV_DIR,
    plugins: [react(), tailwindcss()],
  };
});
