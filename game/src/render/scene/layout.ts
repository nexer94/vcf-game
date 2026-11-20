/** Pure geometry: topology (grid units) -> world-space points and cable curves. */
import { sampleBezier, polylineLength, type CubicBezier, type Vec2 } from '../geom/bezier';
import { isoToScreen, TILE_H, TILE_W } from '../iso';
import type { BoxSpec, CableSpec, DeviceSpec, Topology } from './topology';

/** Point on the front (+gy) face of a box. u: 0..1 left->right, v: 0..1 floor->top. */
export function facePoint(box: BoxSpec, u: number, v: number): Vec2 {
  const a = isoToScreen(box.gx, box.gy + box.d);
  const b = isoToScreen(box.gx + box.w, box.gy + box.d);
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u - v * box.heightPx };
}

/** Screen-space unit vectors of the +gy (front-left) and +gx (front-right) directions, per tile. */
export const FRONT_LEFT: Vec2 = { x: -TILE_W / 2, y: TILE_H / 2 };
export const FRONT_RIGHT: Vec2 = { x: TILE_W / 2, y: TILE_H / 2 };

export interface CableGeometry {
  readonly spec: CableSpec;
  readonly curve: CubicBezier;
  /** Flat polyline used for hit-testing. */
  readonly samples: Float32Array;
  readonly length: number;
}

export function portPoint(box: BoxSpec, device: DeviceSpec, u: number): Vec2 {
  return facePoint(box, u, (device.v0 + device.v1) / 2);
}

export function cableCurve(p0: Vec2, p3: Vec2, spec: CableSpec): CubicBezier {
  let dir: Vec2;
  let k: number;
  switch (spec.route) {
    case 'loopLeft':
      dir = FRONT_LEFT;
      k = spec.bulge;
      break;
    case 'loopRight':
      dir = FRONT_RIGHT;
      k = spec.bulge;
      break;
    case 'uplink':
      dir = { x: 0, y: -100 };
      k = spec.bulge;
      break;
  }
  return {
    p0,
    p1: { x: p0.x + dir.x * k, y: p0.y + dir.y * k },
    p2: { x: p3.x + dir.x * k, y: p3.y + dir.y * k },
    p3,
  };
}

export interface SceneLayout {
  readonly boxById: ReadonlyMap<string, BoxSpec>;
  readonly deviceById: ReadonlyMap<string, DeviceSpec>;
  readonly cables: readonly CableGeometry[];
  /** World bounds of floor + boxes. */
  readonly bounds: { x: number; y: number; width: number; height: number };
}

export function buildLayout(topo: Topology): SceneLayout {
  const boxById = new Map(topo.boxes.map((b) => [b.id, b]));
  const deviceById = new Map(topo.devices.map((d) => [d.id, d]));
  const endPoint = (deviceId: string, u: number): Vec2 => {
    const dev = deviceById.get(deviceId);
    if (!dev) throw new Error(`Unknown device ${deviceId}`);
    const box = boxById.get(dev.boxId);
    if (!box) throw new Error(`Unknown box ${dev.boxId}`);
    return portPoint(box, dev, u);
  };
  const cables = topo.cables.map((spec) => {
    const curve = cableCurve(endPoint(spec.from.deviceId, spec.from.u), endPoint(spec.to.deviceId, spec.to.u), spec);
    const samples = sampleBezier(curve, 24);
    return { spec, curve, samples, length: polylineLength(samples) };
  });

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const add = (p: Vec2): void => {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  };
  const { cols, rows } = topo.floor;
  [isoToScreen(0, 0), isoToScreen(cols, 0), isoToScreen(0, rows), isoToScreen(cols, rows)].forEach(add);
  for (const b of topo.boxes) {
    add({ x: isoToScreen(b.gx, b.gy).x, y: isoToScreen(b.gx, b.gy).y - b.heightPx });
  }
  for (const c of cables) {
    for (let i = 0; i + 1 < c.samples.length; i += 2) add({ x: c.samples[i]!, y: c.samples[i + 1]! });
  }
  return { boxById, deviceById, cables, bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY } };
}
