/**
 * View stack of the Sandbox server room (UX.md §7.1):
 *
 *   Místnost ─┬─ Rack (2D front elevation) ── Host – síť
 *             ├─ Tabule
 *             └─ Počítač ── aplikace
 *
 * Pure helpers (no DOM): hash segments <-> view, parent view (Esc = one level up).
 */

export type RoomView =
  | { readonly kind: 'room' }
  | { readonly kind: 'rack'; readonly rackId: string }
  | { readonly kind: 'host'; readonly rackId: string; readonly hostId: string }
  | { readonly kind: 'board' }
  | { readonly kind: 'pc'; readonly app: string };

export const ROOM_VIEW: RoomView = { kind: 'room' };

const RACK = 'rack';
const HOST = 'host';
const BOARD = 'tabule';
const PC = 'pocitac';
export const DEFAULT_PC_APP = 'plocha';

const ID_RE = /^[A-Za-z0-9._-]{1,64}$/;
const safeId = (s: string | undefined): string | null => {
  if (s === undefined) return null;
  let d: string;
  try {
    d = decodeURIComponent(s);
  } catch {
    return null;
  }
  return ID_RE.test(d) ? d : null;
};

/** Parse the path segments after `mistnost[/ukazka]`. Unknown input = the room. */
export function parseRoomView(segments: readonly string[]): RoomView {
  const [a, b, c, d] = segments;
  if (a === RACK) {
    const rackId = safeId(b);
    if (!rackId) return ROOM_VIEW;
    const hostId = c === HOST ? safeId(d) : null;
    return hostId ? { kind: 'host', rackId, hostId } : { kind: 'rack', rackId };
  }
  if (a === BOARD) return { kind: 'board' };
  if (a === PC) return { kind: 'pc', app: safeId(b) ?? DEFAULT_PC_APP };
  return ROOM_VIEW;
}

/** Path segments of a view ('' for the room). */
export function formatRoomView(v: RoomView): string {
  switch (v.kind) {
    case 'room':
      return '';
    case 'rack':
      return `/${RACK}/${encodeURIComponent(v.rackId)}`;
    case 'host':
      return `/${RACK}/${encodeURIComponent(v.rackId)}/${HOST}/${encodeURIComponent(v.hostId)}`;
    case 'board':
      return `/${BOARD}`;
    case 'pc':
      return `/${PC}/${encodeURIComponent(v.app)}`;
  }
}

/** One level up (Esc / Zpět). The room has no parent (null). */
export function parentView(v: RoomView): RoomView | null {
  switch (v.kind) {
    case 'room':
      return null;
    case 'host':
      return { kind: 'rack', rackId: v.rackId };
    default:
      return ROOM_VIEW;
  }
}

/** Depth in the stack (room = 0). */
export function viewDepth(v: RoomView): number {
  return v.kind === 'room' ? 0 : v.kind === 'host' ? 2 : 1;
}

export function sameView(a: RoomView, b: RoomView): boolean {
  return formatRoomView(a) === formatRoomView(b);
}

/** Human label of a view (breadcrumbs, aria-live). */
export function viewLabel(v: RoomView): string {
  switch (v.kind) {
    case 'room':
      return 'Místnost';
    case 'rack':
      return `Rack ${v.rackId}`;
    case 'host':
      return `Host ${v.hostId}`;
    case 'board':
      return 'Tabule';
    case 'pc':
      return 'Počítač';
  }
}
