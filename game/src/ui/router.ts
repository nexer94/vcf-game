import { isSandboxPhase, type SandboxPhaseId } from './sandbox/phases';
import { formatRoomView, parseRoomView, type RoomView } from './sandbox/roomViews';

/** App screens. Hash-based so browser back/forward and reload work without a server. */
export type Route =
  | { readonly name: 'menu' }
  | { readonly name: 'sandbox-intro' }
  | { readonly name: 'sandbox'; readonly phase: SandboxPhaseId }
  /**
   * Server room; `demo` = illustrative furniture placed. `view` = opened object view (UX §7.1),
   * omitted = the room itself.
   */
  | { readonly name: 'sandbox-room'; readonly demo: boolean; readonly view?: RoomView }
  | { readonly name: 'career' }
  | { readonly name: 'traffic' };

export const MENU: Route = { name: 'menu' };

const ROOM_SEGMENT = 'mistnost';
const DEMO_SEGMENT = 'ukazka';

/** Parse a location hash ("#/sandbox/navrh"). Unknown hashes fall back to the menu. */
export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [a, b, c] = parts;
  switch (a) {
    case undefined:
      return MENU;
    case 'sandbox':
      if (b === undefined) return { name: 'sandbox-intro' };
      if (b === ROOM_SEGMENT) {
        const demo = c === DEMO_SEGMENT;
        const view = parseRoomView(parts.slice(demo ? 3 : 2));
        return view.kind === 'room' ? { name: 'sandbox-room', demo } : { name: 'sandbox-room', demo, view };
      }
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
    case 'sandbox-room':
      return `#/sandbox/${ROOM_SEGMENT}${r.demo ? `/${DEMO_SEGMENT}` : ''}${r.view ? formatRoomView(r.view) : ''}`;
    case 'career':
      return '#/kariera';
    case 'traffic':
      return '#/provoz';
  }
}

export function sameScreen(a: Route, b: Route): boolean {
  return a.name === b.name;
}
