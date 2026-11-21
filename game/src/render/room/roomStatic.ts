/**
 * Static part of the server room: floor slab, tiles, two back walls and decor
 * (door, AC unit, cable trays, poster, clock, fire extinguisher).
 * Drawn once into a Graphics and baked into a texture (see RoomScene) - a frame
 * costs one sprite regardless of how much detail is here. Purely decorative.
 */
import { Graphics } from 'pixi.js';
import { isoToScreen } from '../iso';
import { createRng } from '../util/rng';
import { poly, prism, up, type P } from './draw';
import { DECOR, FLOOR, OUTLINE, SHADOW, WALL } from './palette';
import type { RoomSize } from './roomGrid';
import { WALL_JACK as SHARED_WALL_JACK, doorSpan, wallJackSpan } from '../../model/roomFixtures';

export const WALL_H = 150;
export const WALL_T = 0.28;
export const SLAB_H = 12;
/** Height of the overhead cable trays (cables between objects arc towards it). */
export const TRAY_Z = 128;

/** Point on the right back wall (gy = 0): u along +gx (tiles), h px above floor. */
const rw = (u: number, h: number): P => up(isoToScreen(u, 0), h);
/** Point on the left back wall (gx = 0): v along +gy (tiles), h px above floor. */
const lw = (v: number, h: number): P => up(isoToScreen(0, v), h);

type WallFn = (a: number, h: number) => P;
const wallRect = (f: WallFn, a0: number, a1: number, h0: number, h1: number): P[] => [f(a0, h1), f(a1, h1), f(a1, h0), f(a0, h0)];
/** Ellipse on a wall plane (circle in wall space). */
const wallCircle = (f: WallFn, a: number, h: number, ra: number, rh: number, n = 20): P[] =>
  Array.from({ length: n }, (_, i) => {
    const t = (i / n) * Math.PI * 2;
    return f(a + Math.cos(t) * ra, h + Math.sin(t) * rh);
  });

function drawFloor(g: Graphics, room: RoomSize): void {
  const { cols, rows } = room;
  // Slab sides (front-left and front-right) - the room reads as a little diorama.
  const fl0 = isoToScreen(0, rows);
  const fl1 = isoToScreen(cols, rows);
  const fr0 = isoToScreen(cols, 0);
  poly(g, [fl0, fl1, { x: fl1.x, y: fl1.y + SLAB_H }, { x: fl0.x, y: fl0.y + SLAB_H }], FLOOR.slabLeft);
  poly(g, [fr0, fl1, { x: fl1.x, y: fl1.y + SLAB_H }, { x: fr0.x, y: fr0.y + SLAB_H }], FLOOR.slabRight);

  const rng = createRng(7);
  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const a = isoToScreen(gx, gy);
      const b = isoToScreen(gx + 1, gy);
      const c = isoToScreen(gx + 1, gy + 1);
      const d = isoToScreen(gx, gy + 1);
      g.poly([a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y]).fill({ color: (gx + gy) % 2 === 0 ? FLOOR.a : FLOOR.b });
      // Some raised-floor tiles are perforated (dot grid) - decoration only.
      if (rng() < 0.16) {
        for (let i = 1; i <= 3; i++) {
          for (let j = 1; j <= 3; j++) {
            const p = isoToScreen(gx + i / 4, gy + j / 4);
            g.ellipse(p.x, p.y, 1.6, 0.9);
          }
        }
        g.fill({ color: FLOOR.perforated });
      }
    }
  }
  for (let gx = 0; gx <= cols; gx++) {
    const a = isoToScreen(gx, 0);
    const b = isoToScreen(gx, rows);
    g.moveTo(a.x, a.y).lineTo(b.x, b.y);
  }
  for (let gy = 0; gy <= rows; gy++) {
    const a = isoToScreen(0, gy);
    const b = isoToScreen(cols, gy);
    g.moveTo(a.x, a.y).lineTo(b.x, b.y);
  }
  g.stroke({ color: FLOOR.grout, width: 1 });
  // Floor outline.
  poly(g, [isoToScreen(0, 0), isoToScreen(cols, 0), isoToScreen(cols, rows), isoToScreen(0, rows)], 0, true, 0);
  // Soft ambient occlusion along the walls (stacked translucent bands, no filters).
  for (let i = 0; i < 4; i++) {
    const t = 0.1 + i * 0.1;
    g.poly([isoToScreen(0, 0), isoToScreen(cols, 0), isoToScreen(cols, t), isoToScreen(t, t), isoToScreen(t, rows), isoToScreen(0, rows)].flatMap((p) => [p.x, p.y]))
      .fill({ color: SHADOW, alpha: 0.05 });
  }
}

function drawWalls(g: Graphics, room: RoomSize): void {
  const { cols, rows } = room;
  const H = WALL_H;
  // Left wall face (gx = 0), shaded.
  poly(g, wallRect(lw, 0, rows, 0, H), WALL.left);
  g.poly(wallRect(lw, 0, rows, 0, 46).flatMap((p) => [p.x, p.y])).fill({ color: WALL.leftDark });
  poly(g, wallRect(lw, 0, rows, 0, 8), WALL.base);
  // Right wall face (gy = 0), lit.
  poly(g, wallRect(rw, 0, cols, 0, H), WALL.right);
  g.poly(wallRect(rw, 0, cols, 0, 46).flatMap((p) => [p.x, p.y])).fill({ color: WALL.rightDark });
  poly(g, wallRect(rw, 0, cols, 0, 8), WALL.base);
  // Brand stripe (T6 WALL.stripe): 6 px at 1/3 of the wall height - the only large red element in the scene.
  const sh = Math.round(H / 3);
  poly(g, wallRect(lw, 0, rows, sh, sh + 6), WALL.stripe, false);
  poly(g, wallRect(rw, 0, cols, sh, sh + 6), WALL.stripe, false);
  // Wall caps (thickness) + exposed wall ends.
  const T = WALL_T;
  poly(g, [up(isoToScreen(-T, -T), H), up(isoToScreen(cols, -T), H), up(isoToScreen(cols, 0), H), up(isoToScreen(0, 0), H), up(isoToScreen(0, rows), H), up(isoToScreen(-T, rows), H)], WALL.cap);
  poly(g, [isoToScreen(cols, -T), isoToScreen(cols, 0), up(isoToScreen(cols, 0), H), up(isoToScreen(cols, -T), H)], WALL.rightDark);
  poly(g, [isoToScreen(-T, rows), isoToScreen(0, rows), up(isoToScreen(0, rows), H), up(isoToScreen(-T, rows), H)], WALL.leftDark);
  // Corner seam.
  g.moveTo(isoToScreen(0, 0).x, isoToScreen(0, 0).y).lineTo(up(isoToScreen(0, 0), H).x, up(isoToScreen(0, 0), H).y).stroke({ color: OUTLINE, width: 1, alpha: 0.35 });
}

/**
 * The room door (left wall): wall span v0..v1, the floor tile in front of it (avatar leaves / enters the room
 * there) and its world-space bounding box (click target). Multi-room sites use it to move between rooms.
 */
export function roomDoor(room: RoomSize): { v0: number; v1: number; tile: { gx: number; gy: number }; rect: { x: number; y: number; width: number; height: number } } {
  const { v0, v1, tile } = doorSpan(room); // shared with the engine's rack placement rules (model/roomFixtures.ts)
  const pts = wallRect(lw, v0 - 0.15, v1 + 0.15, 0, 112);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { v0, v1, tile, rect: { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y } };
}

function drawDoor(g: Graphics, room: RoomSize): void {
  const { v0, v1 } = roomDoor(room);
  poly(g, wallRect(lw, v0 - 0.15, v1 + 0.15, 0, 112), DECOR.doorFrame);
  poly(g, wallRect(lw, v0, v1, 0, 104), DECOR.door);
  poly(g, wallRect(lw, v0 + 0.15, v1 - 0.15, 12, 46), DECOR.doorDark, true, 0.6);
  poly(g, wallRect(lw, v0 + 0.3, v1 - 0.3, 64, 92), DECOR.doorWindow);
  g.moveTo(lw(v0 + 0.32, 70).x, lw(v0 + 0.32, 70).y).lineTo(lw(v0 + 0.6, 88).x, lw(v0 + 0.6, 88).y).stroke({ color: 0xffffff, width: 2, alpha: 0.8 });
  poly(g, wallCircle(lw, v1 - 0.2, 52, 0.07, 4, 10), DECOR.handle);
  // Exit sign above the door: a green plate with an arrow (no text).
  poly(g, wallRect(lw, v0 + 0.35, v1 - 0.35, 120, 132), DECOR.sign);
  const a = lw(v0 + 0.5, 126);
  const b = lw(v1 - 0.5, 126);
  g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: 0xffffff, width: 2, cap: 'round' });
  const tip = lw(v1 - 0.55, 129);
  const tip2 = lw(v1 - 0.55, 123);
  g.moveTo(tip.x, tip.y).lineTo(b.x, b.y).lineTo(tip2.x, tip2.y).stroke({ color: 0xffffff, width: 2, cap: 'round', join: 'round' });
  // Fire extinguisher next to the door.
  const ev = v0 - 0.7;
  poly(g, wallRect(lw, ev - 0.12, ev + 0.12, 14, 46), DECOR.extinguisher);
  poly(g, wallRect(lw, ev - 0.06, ev + 0.06, 46, 54), OUTLINE);
  poly(g, wallRect(lw, ev - 0.1, ev + 0.1, 26, 32), 0xffffff, false);
}

function drawClock(g: Graphics): void {
  poly(g, wallCircle(rw, 4.6, 92, 0.42, 14, 24), 0xffffff);
  const c = rw(4.6, 92);
  const h1 = rw(4.6, 101);
  const h2 = rw(4.85, 92);
  g.moveTo(c.x, c.y).lineTo(h1.x, h1.y).moveTo(c.x, c.y).lineTo(h2.x, h2.y).stroke({ color: OUTLINE, width: 1.5, cap: 'round' });
}

function drawAc(g: Graphics, room: RoomSize): void {
  const u0 = Math.min(room.cols - 3, 6.6);
  const w = 2.4;
  prism(g, u0, 0, w, 0.4, 34, { top: DECOR.ac, front: DECOR.ac, side: DECOR.acShade }, 94);
  // Vents + status LED on the front face.
  for (let i = 0; i < 3; i++) {
    const h = 100 + i * 5;
    const a = up(isoToScreen(u0 + 0.25, 0.4), h);
    const b = up(isoToScreen(u0 + w - 0.6, 0.4), h);
    g.moveTo(a.x, a.y).lineTo(b.x, b.y);
  }
  g.stroke({ color: DECOR.acVent, width: 1.5, cap: 'round' });
  const led = up(isoToScreen(u0 + w - 0.3, 0.4), 118);
  g.circle(led.x, led.y, 2).fill({ color: DECOR.acLed }).stroke({ color: OUTLINE, width: 1 });
  // Cool airflow (light strokes).
  for (let i = 0; i < 3; i++) {
    const s = up(isoToScreen(u0 + 0.5 + i * 0.7, 0.6), 86);
    g.moveTo(s.x, s.y).quadraticCurveTo(s.x - 6, s.y + 12, s.x + 2, s.y + 24);
  }
  g.stroke({ color: 0xffffff, width: 2, alpha: 0.7, cap: 'round' });
}

/** "Síť firmy" wall patch panel (GAME abstraction of the customer network): right wall, near the far corner. */
export const WALL_JACK = SHARED_WALL_JACK;
/** Wall-jack geometry for a room (clamped to small rooms). */
export function wallJack(room: RoomSize): { u0: number; u1: number; h0: number; h1: number; port: P; label: P } {
  const { u0, u1 } = wallJackSpan(room);
  return { u0, u1, h0: WALL_JACK.h0, h1: WALL_JACK.h1, port: rw((u0 + u1) / 2, WALL_JACK.h1 - 12), label: rw((u0 + u1) / 2, WALL_JACK.h0 - 4) };
}

function drawWallJack(g: Graphics, room: RoomSize): void {
  const j = wallJack(room);
  // Original art: a small cream patch panel with a coloured stripe and a row of RJ-45 style sockets.
  poly(g, wallRect(rw, j.u0 - 0.06, j.u1 + 0.06, j.h0 - 3, j.h1 + 3), OUTLINE);
  poly(g, wallRect(rw, j.u0, j.u1, j.h0, j.h1), 0xf4efe1);
  poly(g, wallRect(rw, j.u0, j.u1, j.h1 - 7, j.h1), 0xffc94d, false);
  for (let i = 0; i < 4; i++) {
    const a = j.u0 + 0.14 + i * 0.2;
    poly(g, wallRect(rw, a, a + 0.13, j.h1 - 20, j.h1 - 12), 0x24324a);
  }
  // Conduit from the panel down into the floor ("the company network comes from outside").
  poly(g, wallRect(rw, (j.u0 + j.u1) / 2 - 0.05, (j.u0 + j.u1) / 2 + 0.05, 0, j.h0 - 3), DECOR.trayDark, true, 0.8);
}

function drawTrays(g: Graphics, room: RoomSize): void {
  const colors = { top: DECOR.tray, front: DECOR.trayDark, side: DECOR.trayDark };
  // Along the right wall, then the left wall (ladder trays hanging under the ceiling).
  prism(g, 0.55, 0.05, room.cols - 0.6, 0.5, 5, colors, TRAY_Z);
  prism(g, 0.05, 0.05, 0.5, room.rows - 0.6, 5, colors, TRAY_Z);
  for (let u = 1; u < room.cols; u += 0.5) {
    const a = up(isoToScreen(u, 0.05), TRAY_Z + 5);
    const b = up(isoToScreen(u, 0.55), TRAY_Z + 5);
    g.moveTo(a.x, a.y).lineTo(b.x, b.y);
  }
  for (let v = 1; v < room.rows - 0.5; v += 0.5) {
    const a = up(isoToScreen(0.05, v), TRAY_Z + 5);
    const b = up(isoToScreen(0.55, v), TRAY_Z + 5);
    g.moveTo(a.x, a.y).lineTo(b.x, b.y);
  }
  g.stroke({ color: DECOR.trayDark, width: 1.5 });
}

/** Build the whole static room as one Graphics (to be baked into a texture). */
export function drawStaticRoom(room: RoomSize): Graphics {
  const g = new Graphics();
  drawFloor(g, room);
  drawWalls(g, room);
  drawDoor(g, room);
  // Poster replaced by the interactive whiteboard (render/room/fixtures.ts).
  drawClock(g);
  drawAc(g, room);
  drawWallJack(g, room);
  drawTrays(g, room);
  return g;
}
