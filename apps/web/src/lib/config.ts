const DEV_API_URL = 'http://localhost:3001';

export function resolveApiUrl(raw: string | undefined): string {
  const value = raw === undefined || raw.trim() === '' ? DEV_API_URL : raw.trim();
  if (!URL.canParse(value)) throw new Error(`VITE_API_URL no es una URL válida: ${value}`);

  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`VITE_API_URL debe ser http o https: ${value}`);
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

export const API_URL = resolveApiUrl(import.meta.env.VITE_API_URL);
