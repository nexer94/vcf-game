/**
 * Room "furniture": cabinets (generic racks 24U / 42U / 48U, low network stand) with mounted devices
 * (generic servers, generic switches). Pure drawing + geometry; textures are baked
 * and cached by RoomScene. No VCF facts: unit counts come from the catalog (generic game racks), the px scale
 * is just drawing; vendor is only a coloured tag (no logos).
 *
 * Facing (where the rack front points, engine `rackTiles[].rotation` -> model Facing): S = +gy, E = +gx,
 * N = -gy, W = -gx. The iso camera sees the +gy and +gx faces: S / E racks show their front (devices, drive
 * bays), N / W racks show their rear (vented door, device backs with the ports) on the same visible face.
 * Ports and cable risers therefore always sit on the visible face of the facing axis.
 */
import type { Graphics } from 'pixi.js';
import { isoToScreen } from '../iso';
import { frontFace, frontQuad, poly, prism, sideFace, sideQuad, type P } from './draw';
import { CABINET, DEVICE, OUTLINE } from './palette';

export type CabinetKind = 'rack' | 'stand';
export type RoomDeviceKind = 'server' | 'switch';
/** Where the rack front points (model Facing; render-side copy so render stays model-free). */
export type CabinetFacing = 'N' | 'E' | 'S' | 'W';

export interface CabinetSpec {
  readonly id: string;
  readonly kind: CabinetKind;
  readonly gx: number;
  readonly gy: number;
  readonly label?: string;
  /** Rack height in U (catalog: 24 / 42 / 48). Default 42. */
  readonly units?: number;
  /** Default 'S' (front towards +gy). */
  readonly facing?: CabinetFacing;
}

export interface RoomDeviceSpec {
  readonly id: string;
  readonly kind: RoomDeviceKind;
  /** Lowest occupied unit, 1-based (1 = bottom). */
  readonly u: number;
  readonly heightU: number;
  /** Colour of the label tag on the face (e.g. vendor colour). Default by kind. */
  readonly tagColor?: number;
  readonly label?: string;
}

export interface CabinetGeometry {
  readonly units: number;
  readonly uPx: number;
  /** Interior bottom above the floor (px). */
  readonly base: number;
  readonly heightPx: number;
  readonly w: number;
  readonly d: number;
}

/** Drawing geometry per kind (default 42U rack); the stand is a low table for a standalone switch. */
export const CABINETS: Readonly<Record<CabinetKind, CabinetGeometry>> = {
  rack: { units: 42, uPx: 2.6, base: 6, heightPx: 6 + 42 * 2.6 + 6, w: 1, d: 1 },
  stand: { units: 4, uPx: 7, base: 22, heightPx: 22 + 4 * 7 + 4, w: 1, d: 1 },
};

const rackGeoCache = new Map<number, CabinetGeometry>();
/** Geometry of a cabinet: racks of other heights keep the U scale, so a 24U rack is visibly lower than a 48U one. */
export function cabinetGeometry(cab: CabinetKind | { readonly kind: CabinetKind; readonly units?: number | undefined }): CabinetGeometry {
  const kind = typeof cab === 'string' ? cab : cab.kind;
  const units = typeof cab === 'string' ? undefined : cab.units;
  if (kind !== 'rack' || units === undefined || units === CABINETS.rack.units || units < 1) return CABINETS[kind];
  let g = rackGeoCache.get(units);
  if (!g) {
    const b = CABINETS.rack;
    g = { ...b, units, heightPx: b.base + units * b.uPx + 6 };
    rackGeoCache.set(units, g);
  }
  return g;
}

const facingOf = (cab: { readonly facing?: CabinetFacing | undefined }): CabinetFacing => cab.facing ?? 'S';
/** True when the visible face of the facing axis is the rack front (S / E); N / W show the rear. */
export const showsFront = (cab: { readonly facing?: CabinetFacing | undefined }): boolean => facingOf(cab) === 'S' || facingOf(cab) === 'E';

/**
 * Point on the visible face of the cabinet's facing axis (+gy face for S / N, +gx face for E / W),
 * u: 0..1 left -> right on screen, h px above the floor. Cabinet at (gx, gy).
 */
export function cabinetFace(cab: { readonly facing?: CabinetFacing | undefined }, gx: number, gy: number, geo: CabinetGeometry, u: number, h: number): P {
  const f = facingOf(cab);
  return f === 'S' || f === 'N' ? frontFace(gx, gy, geo.w, geo.d, u, h) : sideFace(gx, gy, geo.w, geo.d, 1 - u, h);
}

function faceQuad(cab: { readonly facing?: CabinetFacing | undefined }, geo: CabinetGeometry, u0: number, u1: number, h0: number, h1: number): P[] {
  const f = facingOf(cab);
  return f === 'S' || f === 'N' ? frontQuad(0, 0, geo.w, geo.d, u0, u1, h0, h1) : sideQuad(0, 0, geo.w, geo.d, 1 - u0, 1 - u1, h0, h1);
}

const FACE_U0 = 0.1;
const FACE_U1 = 0.9;
export const MAX_SERVER_PORTS = 4;
export const MAX_SWITCH_PORTS = 16;

type CabRef = CabinetKind | { readonly kind: CabinetKind; readonly units?: number | undefined };

/** True if the device fits into the cabinet and does not overlap other devices. */
export function canMount(kind: CabRef, existing: readonly RoomDeviceSpec[], dev: RoomDeviceSpec): boolean {
  const geo = cabinetGeometry(kind);
  if (dev.u < 1 || dev.heightU < 1 || dev.u + dev.heightU - 1 > geo.units) return false;
  return existing.every((e) => dev.u + dev.heightU <= e.u || e.u + e.heightU <= dev.u);
}

/** Lowest free slot for a device of `heightU` units, or null when full. */
export function firstFreeU(kind: CabRef, existing: readonly RoomDeviceSpec[], heightU: number): number | null {
  const geo = cabinetGeometry(kind);
  for (let u = 1; u + heightU - 1 <= geo.units; u++) {
    if (canMount(kind, existing, { id: '', kind: 'server', u, heightU })) return u;
  }
  return null;
}

/** Centre of the rack number plate in cabinet-local coordinates (for the baked number Text). */
export function rackPlateCenter(cab: { readonly units?: number | undefined; readonly facing?: CabinetFacing | undefined }): P {
  const geo = cabinetGeometry({ kind: 'rack', units: cab.units });
  return cabinetFace(cab, 0, 0, geo, 0.5, geo.heightPx - 3.1);
}

/** Vertical px range of a device on the cabinet face. */
function deviceSpan(geo: CabinetGeometry, dev: RoomDeviceSpec): { h0: number; h1: number } {
  const h0 = geo.base + (dev.u - 1) * geo.uPx;
  return { h0: h0 + 0.3, h1: h0 + dev.heightU * geo.uPx - 0.3 };
}

/**
 * Port position (world px) of a device in a cabinet placed at (gx, gy).
 * Servers: up to 4 ports on the right half; switches: a row of 16.
 */
export function devicePortPoint(cab: CabinetSpec, dev: RoomDeviceSpec, port: number): P {
  const geo = cabinetGeometry(cab);
  const { h0, h1 } = deviceSpan(geo, dev);
  const h = (h0 + h1) / 2;
  // port < 0 = BMC port of a server (left of the NIC ports).
  const u =
    dev.kind === 'server'
      ? port < 0
        ? 0.5
        : 0.56 + 0.08 * (port % MAX_SERVER_PORTS)
      : 0.22 + 0.04 * (Math.abs(port) % MAX_SWITCH_PORTS);
  return cabinetFace(cab, cab.gx, cab.gy, geo, u, h);
}

type FaceRef = { readonly facing?: CabinetFacing | undefined };

function drawServer(g: Graphics, geo: CabinetGeometry, dev: RoomDeviceSpec, cab: FaceRef): void {
  const { h0, h1 } = deviceSpan(geo, dev);
  const f = (u0: number, u1: number, a: number, b: number): P[] => faceQuad(cab, geo, u0, u1, a, b);
  const at = (u: number, h: number): P => cabinetFace(cab, 0, 0, geo, u, h);
  const front = showsFront(cab);
  poly(g, f(FACE_U0 + 0.02, FACE_U1 - 0.02, h0, h1), front ? DEVICE.serverFace : DEVICE.serverShade);
  // Vendor / label tag (colour only).
  poly(g, f(FACE_U0 + 0.05, FACE_U0 + 0.16, h0 + 0.6, h1 - 0.6), dev.tagColor ?? 0x2560c4, false);
  if (front) {
    // Drive bays.
    for (let u = 0.3; u < 0.52; u += 0.055) {
      const a = at(u, h0 + 0.8);
      const b = at(u, h1 - 0.8);
      g.moveTo(a.x, a.y).lineTo(b.x, b.y);
    }
    g.stroke({ color: DEVICE.bay, width: 1 });
  } else {
    // Rear: PSU grille + the NIC ports (where the cables plug in).
    for (let u = 0.2; u < 0.34; u += 0.045) {
      const a = at(u, h0 + 0.8);
      const b = at(u, h1 - 0.8);
      g.moveTo(a.x, a.y).lineTo(b.x, b.y);
    }
    g.stroke({ color: DEVICE.bay, width: 1 });
    for (let i = 0; i < MAX_SERVER_PORTS; i++) {
      const p = at(0.56 + 0.08 * i, (h0 + h1) / 2);
      g.rect(p.x - 0.8, p.y - 0.9, 1.6, 1.8);
    }
    g.fill({ color: DEVICE.port });
  }
  const led = at(0.84, (h0 + h1) / 2);
  g.circle(led.x, led.y, 1.1).fill({ color: DEVICE.ledOk });
}

function drawSwitch(g: Graphics, geo: CabinetGeometry, dev: RoomDeviceSpec, cab: FaceRef): void {
  const { h0, h1 } = deviceSpan(geo, dev);
  poly(g, faceQuad(cab, geo, FACE_U0 + 0.01, FACE_U1 - 0.01, h0, h1), DEVICE.switchFace);
  poly(g, faceQuad(cab, geo, FACE_U0 + 0.03, FACE_U0 + 0.1, h0 + 0.8, h1 - 0.8), dev.tagColor ?? DEVICE.ledAct, false);
  const mid = (h0 + h1) / 2;
  for (let i = 0; i < MAX_SWITCH_PORTS; i++) {
    const p = cabinetFace(cab, 0, 0, geo, 0.22 + 0.04 * i, mid);
    g.rect(p.x - 0.7, p.y - 0.9, 1.4, 1.8);
  }
  g.fill({ color: DEVICE.port });
  const led = cabinetFace(cab, 0, 0, geo, 0.86, mid);
  g.circle(led.x, led.y, 1).fill({ color: DEVICE.ledOk });
}

/**
 * Draw a cabinet with its devices in cabinet-local coordinates
 * (origin = back corner of the footprint at floor level).
 */
export function drawCabinet(g: Graphics, kind: CabinetKind, devices: readonly RoomDeviceSpec[], cab: { readonly units?: number | undefined; readonly facing?: CabinetFacing | undefined } = {}): void {
  const geo = cabinetGeometry({ kind, units: cab.units });
  const { w, d, heightPx: H } = geo;
  const at = (u: number, h: number): P => cabinetFace(cab, 0, 0, geo, u, h);
  const sideways = cab.facing === 'E' || cab.facing === 'W';
  if (kind === 'rack') {
    prism(g, 0, 0, w, d, H, { top: CABINET.top, front: CABINET.front, side: CABINET.side });
    // Recessed interior + rails (on the visible face of the facing axis).
    poly(g, faceQuad(cab, geo, FACE_U0 - 0.02, FACE_U1 + 0.02, geo.base - 2, geo.base + geo.units * geo.uPx + 2), CABINET.inner);
    for (const u of [FACE_U0, FACE_U1]) {
      const a = at(u, geo.base);
      const b = at(u, geo.base + geo.units * geo.uPx);
      g.moveTo(a.x, a.y).lineTo(b.x, b.y);
    }
    g.stroke({ color: CABINET.rail, width: 1.2 });
    // Unit marks every 6U.
    for (let i = 6; i < geo.units; i += 6) {
      const a = at(FACE_U0, geo.base + i * geo.uPx);
      const b = at(FACE_U0 + 0.03, geo.base + i * geo.uPx);
      g.moveTo(a.x, a.y).lineTo(b.x, b.y);
    }
    g.stroke({ color: CABINET.rail, width: 1, alpha: 0.7 });
    // Vents on the other visible face + top grille.
    const vents = Math.max(1, Math.min(4, Math.floor((H - 30) / 18)));
    for (let i = 0; i < vents; i++) {
      const q = sideways ? frontQuad(0, 0, w, d, 0.3, 0.7, 30 + i * 18, 34 + i * 18) : sideQuad(0, 0, w, d, 0.3, 0.7, 30 + i * 18, 34 + i * 18);
      poly(g, q, CABINET.inner, false, 0.5);
    }
    const t0 = isoToScreen(0.3, 0.3);
    const t1 = isoToScreen(0.7, 0.3);
    for (let i = 0; i < 3; i++) {
      const o = isoToScreen(0, 0.15 * (i + 1) + 0.15);
      g.moveTo(t0.x + o.x, t0.y + o.y - H).lineTo(t1.x + o.x, t1.y + o.y - H);
    }
    g.stroke({ color: CABINET.side, width: 1.2, cap: 'round' });
  } else {
    // Low stand: four legs + a shelf; the switch(es) sit on top.
    const legs: [number, number][] = [[0.08, 0.08], [0.82, 0.08], [0.08, 0.82], [0.82, 0.82]];
    for (const [lx, ly] of legs) prism(g, lx, ly, 0.1, 0.1, geo.base - 4, { top: CABINET.netTop, front: CABINET.netFront, side: CABINET.netSide });
    prism(g, 0, 0, w, d, 4, { top: CABINET.netTop, front: CABINET.netFront, side: CABINET.netSide }, geo.base - 4);
  }
  for (const dev of devices) {
    if (kind === 'stand') {
      // Standalone switch: a chunky box sitting on the stand.
      const { h0, h1 } = deviceSpan(geo, dev);
      prism(g, 0, 0, w, d, h1 - h0, { top: DEVICE.serverShade, front: DEVICE.switchShade, side: DEVICE.switchShade }, h0);
    }
    if (dev.kind === 'server') drawServer(g, geo, dev, cab);
    else drawSwitch(g, geo, dev, cab);
  }
  if (kind === 'rack') {
    if (showsFront(cab)) {
      // Glass door glint (cartoon highlight).
      const a = at(0.2, H - 14);
      const b = at(0.42, H - 34);
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ color: 0xffffff, width: 2, alpha: 0.35, cap: 'round' });
    }
    // Rack number plate (T6 CABINET.label): small red plate at the top of the visible face; the number is a Text
    // baked over it by RoomScene (rackPlateCenter).
    poly(g, faceQuad(cab, geo, 0.32, 0.68, H - 5.5, H - 0.8), CABINET.label, true);
  }
  // Floor contact line.
  const c01 = isoToScreen(0, d);
  const c11 = isoToScreen(w, d);
  const c10 = isoToScreen(w, 0);
  g.moveTo(c01.x, c01.y).lineTo(c11.x, c11.y).lineTo(c10.x, c10.y).stroke({ color: OUTLINE, width: 2, alpha: 0.9 });
}
