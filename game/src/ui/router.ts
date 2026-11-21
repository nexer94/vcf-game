import { isSandboxPhase, type SandboxPhaseId } from './sandbox/phases';
import { formatRoomView, parseRoomView, type RoomView } from './sandbox/roomViews';

/** App screens. Hash-based so browser back/forward and reload work without a server. */
export type Route =
  | { readonly name: 'menu' }
  | { readonly name: 'sandbox-intro' }
  /** Start choice „Vyber design blueprint“ (site layout) before entering the room. */
  | { readonly name: 'sandbox-site' }
  | { readonly name: 'sandbox'; readonly phase: SandboxPhaseId }
  /**
   * Server room; `demo` = illustrative furniture placed. `view` = opened object view (UX §7.1),
   * omitted = the room itself.
   */
  | {
      readonly name: 'sandbox-room';
      readonly demo: boolean;
      readonly view?: RoomView;
      /** Room of a multi-room site layout (omitted = the first room). */
      readonly roomId?: string;
      /** Site overview (building / campus / map) instead of a room. */
      readonly overview?: true;
      /** Career level id – the same room screen in Career mode (checklist + bubbles, budget, points). */
      readonly career?: string;
    }
  /** Career: level list (no `level`), briefing of a level, or its result screen. */
  | { readonly name: 'career'; readonly level?: string; readonly result?: true }
  /** Main menu entry 2 "Hotové scénáře": scenario list (`compare` = side-by-side comparison of two scenarios). */
  | { readonly name: 'scenarios'; readonly compare?: true }
  /** One pre-built, fully deployed scenario (room read-only + VM / Zdroje / Hosty / O scénáři panel). */
  | { readonly name: 'scenario'; readonly id: string }
  | { readonly name: 'traffic' };

export const MENU: Route = { name: 'menu' };

const ROOM_SEGMENT = 'mistnost';
const DEMO_SEGMENT = 'ukazka';
const SITE_SEGMENT = 'lokalita';
const OVERVIEW_SEGMENT = 'areal';
/** Segments that can never be a room id (view keywords). */
const RESERVED = new Set([DEMO_SEGMENT, OVERVIEW_SEGMENT, 'rack', 'tabule', 'pocitac', 'host']);
const ROOM_ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

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
        let i = demo ? 3 : 2;
        const seg = parts[i];
        if (seg === OVERVIEW_SEGMENT) return { name: 'sandbox-room', demo, overview: true };
        let roomId: string | undefined;
        if (seg !== undefined && !RESERVED.has(seg) && ROOM_ID_RE.test(seg)) {
          roomId = seg;
          i++;
        }
        const view = parseRoomView(parts.slice(i));
        return { name: 'sandbox-room', demo, ...(roomId ? { roomId } : {}), ...(view.kind === 'room' ? {} : { view }) };
      }
      if (b === SITE_SEGMENT) return { name: 'sandbox-site' };
      return isSandboxPhase(b) ? { name: 'sandbox', phase: b } : { name: 'sandbox-intro' };
    case 'kariera': {
      if (b === undefined || !ROOM_ID_RE.test(b)) return { name: 'career' };
      if (c === 'vysledek') return { name: 'career', level: b, result: true };
      if (c === ROOM_SEGMENT) {
        const view = parseRoomView(parts.slice(3));
        return { name: 'sandbox-room', demo: false, career: b, ...(view.kind === 'room' ? {} : { view }) };
      }
      return { name: 'career', level: b };
    }
    case 'scenare':
      if (b === 'porovnani') return { name: 'scenarios', compare: true };
      if (b !== undefined && ROOM_ID_RE.test(b)) return { name: 'scenario', id: b };
      return { name: 'scenarios' };
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
    case 'sandbox-site':
      return `#/sandbox/${SITE_SEGMENT}`;
    case 'sandbox-room': {
      if (r.career) return `#/kariera/${encodeURIComponent(r.career)}/${ROOM_SEGMENT}${r.view ? formatRoomView(r.view) : ''}`;
      const base = `#/sandbox/${ROOM_SEGMENT}${r.demo ? `/${DEMO_SEGMENT}` : ''}`;
      if (r.overview) return `${base}/${OVERVIEW_SEGMENT}`;
      return `${base}${r.roomId ? `/${encodeURIComponent(r.roomId)}` : ''}${r.view ? formatRoomView(r.view) : ''}`;
    }
    case 'career':
      return r.level ? `#/kariera/${encodeURIComponent(r.level)}${r.result ? '/vysledek' : ''}` : '#/kariera';
    case 'scenarios':
      return r.compare ? '#/scenare/porovnani' : '#/scenare';
    case 'scenario':
      return `#/scenare/${encodeURIComponent(r.id)}`;
    case 'traffic':
      return '#/provoz';
  }
}

export function sameScreen(a: Route, b: Route): boolean {
  return a.name === b.name;
}
