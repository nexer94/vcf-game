import { isSandboxPhase, type SandboxPhaseId } from './sandbox/phases';

/** App screens. Hash-based so browser back/forward and reload work without a server. */
export type Route =
  | { readonly name: 'menu' }
  | { readonly name: 'sandbox-intro' }
  | { readonly name: 'sandbox'; readonly phase: SandboxPhaseId }
  | { readonly name: 'career' }
  | { readonly name: 'traffic' };

export const MENU: Route = { name: 'menu' };

/** Parse a location hash ("#/sandbox/navrh"). Unknown hashes fall back to the menu. */
export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [a, b] = parts;
  switch (a) {
    case undefined:
      return MENU;
    case 'sandbox':
      if (b === undefined) return { name: 'sandbox-intro' };
      return isSandboxPhase(b) ? { name: 'sandbox', phase: b } : { name: 'sandbox-intro' };
    case 'kariera':
      return { name: 'career' };
    case 'provoz':
      return { name: 'traffic' };
    default:
      return MENU;
  }
}

export function formatRoute(r: Route): string {
  switch (r.name) {
    case 'menu':
      return '#/';
    case 'sandbox-intro':
      return '#/sandbox';
    case 'sandbox':
      return `#/sandbox/${r.phase}`;
    case 'career':
      return '#/kariera';
    case 'traffic':
      return '#/provoz';
  }
}

export function sameScreen(a: Route, b: Route): boolean {
  return a.name === b.name;
}
