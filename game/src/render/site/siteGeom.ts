/**
 * Pure geometry of the site overview (no PixiJS): where rooms, buildings and sites sit on the iso ground,
 * link routes between rooms, hit testing. Distances are drawing distances only – the far DR site is drawn
 * "not to scale" (break marks on the link); the illustrative game values are shown as text by the UI.
 */
import { isoToScreen } from '../iso';
import { worldToGrid } from '../room/roomGrid';

export interface SiteSceneRoom {
  readonly id: string;
  readonly label: string;
  readonly cols: number;
  readonly rows: number;
  readonly buildingId: string;
  /** AZ label shown on the room (null = none). */
  readonly az: string | null;
  /** Witness location (drawn with a small flag). */
  readonly witness?: boolean;
  /** Rack tiles inside the room (for the miniature). */
  readonly racks: readonly { readonly gx: number; readonly gy: number }[];
}

export interface SiteSceneInput {
  readonly rooms: readonly SiteSceneRoom[];
  readonly buildings: readonly { readonly id: string; readonly label: string; readonly siteId: string }[];
  readonly sites: readonly { readonly id: string; readonly label: string; readonly role: 'primary' | 'remote' }[];
  readonly links: readonly { readonly id: string; readonly from: string; readonly to: string; readonly kind: 'corridor' | 'campus' | 'wan' }[];
}

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface PlacedRoom {
  readonly room: SiteSceneRoom;
  /** Grid origin of the room floor in the overview. */
  readonly ox: number;
  readonly oy: number;
}

export interface PlacedBuilding {
  readonly id: string;
  readonly label: string;
  readonly siteId: string;
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  /** Corridor strips between rooms (grid rects). */
  readonly corridors: readonly { x0: number; y0: number; x1: number; y1: number }[];
}

export interface PlacedSite {
  readonly id: string;
  readonly label: string;
  readonly role: 'primary' | 'remote';
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
}

export interface PlacedLink {
  readonly id: string;
  readonly kind: 'corridor' | 'campus' | 'wan';
  /** World polyline (px), heights already applied. */
  readonly points: readonly { x: number; y: number }[];
  /** World point where the "not to scale" break marks go (wan links). */
  readonly breakAt: { x: number; y: number } | null;
}

export interface SitePlan {
  readonly rooms: readonly PlacedRoom[];
  readonly buildings: readonly PlacedBuilding[];
  readonly sites: readonly PlacedSite[];
  readonly links: readonly PlacedLink[];
  /** Grass ground (grid rect) – null for a single building without outdoor area. */
  readonly ground: { x0: number; y0: number; x1: number; y1: number } | null;
}

export const CORRIDOR_TILES = 2;
export const BUILDING_GAP = 7;
export const SITE_GAP = 22;
export const ROOM_WALL_H = 40;

/** Lay the site out along +gx: sites -> buildings -> rooms (corridor between rooms of one building). */
export function planSite(input: SiteSceneInput): SitePlan {
  const rooms: PlacedRoom[] = [];
  const buildings: PlacedBuilding[] = [];
  const sites: PlacedSite[] = [];
  let x = 0;
  input.sites.forEach((site, si) => {
    if (si > 0) x += SITE_GAP;
    const sx0 = x;
    let sy1 = 0;
    const blds = input.buildings.filter((b) => b.siteId === site.id);
    blds.forEach((b, bi) => {
      if (bi > 0) x += BUILDING_GAP;
      const bx0 = x;
      const corridors: { x0: number; y0: number; x1: number; y1: number }[] = [];
      const inB = input.rooms.filter((r) => r.buildingId === b.id);
      let by1 = 0;
      inB.forEach((r, ri) => {
        if (ri > 0) {
          const maxRows = Math.max(...inB.map((q) => q.rows));
          corridors.push({ x0: x, y0: 0, x1: x + CORRIDOR_TILES, y1: maxRows });
          x += CORRIDOR_TILES;
        }
        rooms.push({ room: r, ox: x, oy: 0 });
        x += r.cols;
        by1 = Math.max(by1, r.rows);
      });
      buildings.push({ id: b.id, label: b.label, siteId: b.siteId, x0: bx0, y0: 0, x1: x, y1: by1, corridors });
      sy1 = Math.max(sy1, by1);
    });
    sites.push({ id: site.id, label: site.label, role: site.role, x0: sx0, y0: 0, x1: x, y1: sy1 });
  });
  const roomById = new Map(rooms.map((r) => [r.room.id, r]));
  const links: PlacedLink[] = [];
  let lane = 0;
  for (const l of input.links) {
    const a = roomById.get(l.from);
    const b = roomById.get(l.to);
    if (!a || !b) continue;
    const lo = Math.min(a.ox, b.ox);
    const hi = Math.max(a.ox, b.ox);
    // Rooms in between -> the link cannot go straight through them: route it in front (own lane per link).
    const blocked = rooms.some((r) => r !== a && r !== b && r.ox > lo && r.ox < hi);
    const kind = l.kind === 'corridor' && blocked ? 'campus' : l.kind;
    links.push(routeLink(l.id, kind, a, b, kind === 'campus' ? lane++ : 0, l.kind));
  }
  const outdoor = input.buildings.length > 1 || input.sites.length > 1;
  const maxY = Math.max(1, ...sites.map((s) => s.y1));
  const ground = outdoor ? { x0: -3, y0: -3, x1: x + 3, y1: maxY + 6 } : null;
  return { rooms, buildings, sites, links, ground };
}

const lift = (gx: number, gy: number, h: number): { x: number; y: number } => {
  const p = isoToScreen(gx, gy);
  return { x: p.x, y: p.y - h };
};

function routeLink(id: string, kind: PlacedLink['kind'], a: PlacedRoom, b: PlacedRoom, lane = 0, drawnAs: PlacedLink['kind'] = kind): PlacedLink {
  const [l, r] = a.ox <= b.ox ? [a, b] : [b, a];
  const ay = l.room.rows / 2;
  const by = r.room.rows / 2;
  const ax = l.ox + l.room.cols;
  const bx = r.ox;
  if (kind === 'corridor') {
    // Along the ceiling tray height, through the corridor wall openings.
    const h = 30;
    return { id, kind, points: [lift(ax - 0.6, ay, h), lift(ax, ay, h), lift(bx, by, h), lift(bx + 0.6, by, h)], breakAt: null };
  }
  if (kind === 'campus') {
    // Out of the building, down into a trench in front of the buildings (one lane per link), back up.
    const front = Math.max(l.room.rows, r.room.rows) + 1.6 + lane * 0.8;
    const ex = ax + 0.6 + lane * 0.35;
    const en = bx - 0.6 - lane * 0.35;
    const z = drawnAs === 'corridor' ? 8 : 0;
    return {
      id,
      kind: drawnAs,
      points: [lift(ax - 0.6, ay, 20), lift(ex, ay, z + 2), lift(ex, front, z), lift(en, front, z), lift(en, by, z + 2), lift(bx + 0.6, by, 20)],
      breakAt: null,
    };
  }
  // WAN: a long arc high above the ground (sampled quadratic curve).
  const p0 = lift(ax + 0.4, ay, 24);
  const p2 = lift(bx - 0.4, by, 24);
  const c = { x: (p0.x + p2.x) / 2, y: Math.min(p0.y, p2.y) - 150 };
  const points: { x: number; y: number }[] = [];
  const N = 32;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const u = 1 - t;
    points.push({ x: u * u * p0.x + 2 * u * t * c.x + t * t * p2.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p2.y });
  }
  return { id, kind, points, breakAt: points[N / 2]! };
}

/** World bounding box of a placed room (floor + cut-away walls). */
export function roomWorldRect(p: PlacedRoom): Rect {
  const { cols, rows } = p.room;
  const left = isoToScreen(p.ox, p.oy + rows).x;
  const right = isoToScreen(p.ox + cols, p.oy).x;
  const top = isoToScreen(p.ox, p.oy).y - ROOM_WALL_H - 30;
  const bottom = isoToScreen(p.ox + cols, p.oy + rows).y + 8;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Bounds of the whole plan (px). */
export function planBounds(plan: SitePlan): Rect {
  const g = plan.ground ?? {
    x0: Math.min(...plan.buildings.map((b) => b.x0)) - 1,
    y0: -1,
    x1: Math.max(...plan.buildings.map((b) => b.x1)) + 1,
    y1: Math.max(...plan.buildings.map((b) => b.y1)) + 1,
  };
  const pts = [isoToScreen(g.x0, g.y0), isoToScreen(g.x1, g.y0), isoToScreen(g.x1, g.y1), isoToScreen(g.x0, g.y1)];
  let y0 = Math.min(...pts.map((p) => p.y)) - ROOM_WALL_H - 60;
  for (const l of plan.links) for (const p of l.points) y0 = Math.min(y0, p.y - 20);
  const x0 = Math.min(...pts.map((p) => p.x));
  const x1 = Math.max(...pts.map((p) => p.x));
  const y1 = Math.max(...pts.map((p) => p.y)) + 16;
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** Room under a world point (floor or its walls / label area), or null. */
export function roomAt(plan: SitePlan, wx: number, wy: number): string | null {
  const g = worldToGrid(wx, wy);
  for (const p of plan.rooms) {
    if (g.gx >= p.ox && g.gx < p.ox + p.room.cols && g.gy >= p.oy && g.gy < p.oy + p.room.rows) return p.room.id;
  }
  for (const p of plan.rooms) {
    const r = roomWorldRect(p);
    if (wx >= r.x && wx <= r.x + r.width && wy >= r.y && wy <= r.y + r.height) return p.room.id;
  }
  return null;
}

/** Total length of a polyline + position at distance `d` (wraps). */
export function pointAlong(points: readonly { x: number; y: number }[], d: number): { x: number; y: number } {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  if (total === 0) return points[0] ?? { x: 0, y: 0 };
  let rest = ((d % total) + total) % total;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (rest <= len) {
      const t = len === 0 ? 0 : rest / len;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    rest -= len;
  }
  return points[points.length - 1]!;
}

export function polylineLength(points: readonly { x: number; y: number }[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  return total;
}
