import { useSyncExternalStore } from 'react';
import { SLUG_PATTERN } from './slug';

// El owner_token vive en localStorage porque no hay login. Cualquier XSS podría
// leerlo, así que el front nunca inserta HTML del usuario (sin dangerouslySetInnerHTML)
// y en el deploy se agrega una CSP estricta.

export interface StoredEndpoint {
  slug: string;
  token: string;
  url: string;
  expiresAt: string;
}

const STORAGE_KEY = 'hooklens:endpoints';
const CHANGE_EVENT = 'hooklens:endpoints-changed';

function isStoredEndpoint(value: unknown): value is StoredEndpoint {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.slug === 'string' &&
    SLUG_PATTERN.test(entry.slug) &&
    typeof entry.token === 'string' &&
    typeof entry.url === 'string' &&
    typeof entry.expiresAt === 'string' &&
    !Number.isNaN(Date.parse(entry.expiresAt))
  );
}

export function parseStoredEndpoints(raw: string | null): StoredEndpoint[] {
  if (raw === null) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter(isStoredEndpoint) : [];
  } catch {
    return [];
  }
}

function readRaw(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    // Almacenamiento bloqueado por el navegador (modo privado, política de cookies).
    return null;
  }
}

// useSyncExternalStore exige el mismo objeto mientras el dato no cambie.
let cachedRaw: string | null | undefined;
let cachedEndpoints: StoredEndpoint[] = [];

function getSnapshot(): StoredEndpoint[] {
  const raw = readRaw();
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedEndpoints = parseStoredEndpoints(raw);
  }
  return cachedEndpoints;
}

/** Lanza si el navegador no deja escribir: el llamador debe avisar, sin token no hay acceso. */
function write(endpoints: StoredEndpoint[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(endpoints));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function saveEndpoint(endpoint: StoredEndpoint, now = Date.now()) {
  // Aprovecha cada escritura para descartar los endpoints que ya expiraron.
  const others = getSnapshot().filter(
    (entry) => entry.slug !== endpoint.slug && Date.parse(entry.expiresAt) > now,
  );
  write([endpoint, ...others]);
}

export function forgetEndpoint(slug: string) {
  write(getSnapshot().filter((entry) => entry.slug !== slug));
}

function subscribe(onChange: () => void) {
  // `storage` avisa de los cambios hechos en otras pestañas; CHANGE_EVENT, de los de esta.
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

export function useStoredEndpoints(): StoredEndpoint[] {
  return useSyncExternalStore(subscribe, getSnapshot);
}
