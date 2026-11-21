/**
 * Cable runs between devices in the room. Geometry is pure (unit-tested); the
 * colour follows the traffic type of the cable (GRAPHICS.md), thickness = load,
 * above 80 % yellow, above 95 % red (traffic/loadStyle.ts).
 */
import { Graphics } from 'pixi.js';
import { polylineLength, sampleBezier, type CubicBezier, type Vec2 } from '../geom/bezier';
import { LOAD_COLORS, loadBand, loadWidth } from '../traffic/loadStyle';
import type { PacketPath } from '../traffic/packetSim';
import type { LinkTraffic } from '../traffic/trafficModel';
import { TRAFFIC_STYLE, type TrafficType } from '../traffic/trafficTypes';
import { OUTLINE } from './palette';

export interface PortRef {
  readonly deviceId: string;
  /** Port index on the device face (servers 0..3, switches 0..15). */
  readonly port: number;
}

export interface RoomCableSpec {
  /** Link id - also the key into TrafficSource.sample(). */
  readonly id: string;
  readonly from: PortRef;
  readonly to: PortRef;
  /** Traffic type the cable carries (colour of the idle cable). */
  readonly type: TrafficType;
  readonly label?: string;
}

export interface RoomCableGeometry extends PacketPath {
  readonly spec: RoomCableSpec;
  readonly curve: CubicBezier;
  readonly samples: Float32Array;
  readonly length: number;
}

/** Out-of-face direction of the +gy (front) faces, per tile (screen px). */
const OUT: Vec2 = { x: -32, y: 16 };

/**
 * Curve between two port points on front faces. Within one cabinet the cable
 * loops out in front of the face; between cabinets it arcs up and over
 * (towards the overhead tray), higher for longer runs.
 */
export function roomCableCurve(p0: Vec2, p3: Vec2, sameCabinet: boolean, spread = 0, maxLift = 140): CubicBezier {
  if (sameCabinet) {
    const k = 0.3 + Math.min(0.4, Math.abs(p3.y - p0.y) / 120) + spread * 0.08;
    return {
      p0,
      p1: { x: p0.x + OUT.x * k, y: p0.y + OUT.y * k },
      p2: { x: p3.x + OUT.x * k, y: p3.y + OUT.y * k },
      p3,
    };
  }
  const dist = Math.hypot(p3.x - p0.x, p3.y - p0.y);
  // `spread` fans parallel cables apart so their colours stay readable.
  const lift = Math.min(maxLift, 30 + dist * 0.3 + spread * 14);
  return {
    p0,
    p1: { x: p0.x + OUT.x * 0.35, y: p0.y + OUT.y * 0.35 - lift },
    p2: { x: p3.x + OUT.x * 0.35, y: p3.y + OUT.y * 0.35 - lift },
    p3,
  };
}

export function buildRoomCable(spec: RoomCableSpec, p0: Vec2, p3: Vec2, sameCabinet: boolean, spread = 0): RoomCableGeometry {
  const curve = roomCableCurve(p0, p3, sameCabinet, spread);
  const samples = sampleBezier(curve, 24);
  return { spec, curve, samples, length: polylineLength(samples) };
}

/** Idle cable colour = traffic type colour; overload bands override it. */
export function roomCableColor(type: TrafficType, utilization: number): number {
  const band = loadBand(utilization);
  return band === 'normal' ? TRAFFIC_STYLE[type].color : LOAD_COLORS[band];
}

const WIDTH_STEP = 0.25;

/** One cable = one Graphics (so it can be depth-sorted with furniture); re-tessellated only on style change. */
export class RoomCableView {
  readonly view = new Graphics();
  private key = '';

  constructor(readonly geo: RoomCableGeometry) {}

  update(t: LinkTraffic | undefined, hovered: boolean): void {
    const u = t?.utilization ?? 0;
    const width = Math.round((1.5 + loadWidth(u) * 0.7) / WIDTH_STEP) * WIDTH_STEP;
    const color = roomCableColor(this.geo.spec.type, u);
    const key = `${color}|${width}|${hovered ? 1 : 0}`;
    if (key === this.key) return;
    this.key = key;
    const g = this.view;
    const { p0, p1, p2, p3 } = this.geo.curve;
    const path = (): Graphics => g.moveTo(p0.x, p0.y).bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
    g.clear();
    if (hovered) path().stroke({ color: 0xffffff, width: width + 7, alpha: 0.6, cap: 'round' });
    path().stroke({ color: OUTLINE, width: width + 2.5, cap: 'round' });
    path().stroke({ color, width, cap: 'round' });
    // Connector plugs at both ends.
    g.circle(p0.x, p0.y, 1.8).circle(p3.x, p3.y, 1.8).fill({ color: OUTLINE });
  }
}
