import { useSyncExternalStore } from 'react';
import { SLUG_PATTERN } from './slug';

// Dos rutas no justifican una dependencia: History API + useSyncExternalStore.

export type Route = { name: 'home' } | { name: 'endpoint'; slug: string } | { name: 'not-found' };

const ENDPOINT_PATH = /^\/e\/([^/]+)\/?$/;
const NAVIGATE_EVENT = 'hooklens:navigate';

export function parseRoute(pathname: string): Route {
  if (pathname === '/') return { name: 'home' };
  const slug = ENDPOINT_PATH.exec(pathname)?.[1];
  if (slug !== undefined && SLUG_PATTERN.test(slug)) return { name: 'endpoint', slug };
  return { name: 'not-found' };
}

export function endpointPath(slug: string): string {
  return `/e/${slug}`;
}

export function navigate(path: string) {
  if (path === window.location.pathname) return;
  window.history.pushState(null, '', path);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener('popstate', onChange);
  window.addEventListener(NAVIGATE_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(NAVIGATE_EVENT, onChange);
  };
}

function getPathname() {
  return window.location.pathname;
}

export function useRoute(): Route {
  return parseRoute(useSyncExternalStore(subscribe, getPathname));
}
