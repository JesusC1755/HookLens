// El último destino usado en cada endpoint: casi siempre se reenvía al mismo sitio.
const keyFor = (slug: string) => `hooklens:replay-target:${slug}`;

export function readLastTarget(slug: string): string | null {
  try {
    return localStorage.getItem(keyFor(slug));
  } catch {
    return null;
  }
}

export function saveLastTarget(slug: string, url: string) {
  try {
    localStorage.setItem(keyFor(slug), url);
  } catch {
    // Solo es una comodidad: si el navegador no deja guardar, no pasa nada.
  }
}
