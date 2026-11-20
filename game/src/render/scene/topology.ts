/**
 * Render-side view model of the physical layout (racks, devices, cables).
 * Grid coordinates are continuous iso tile units; box corners sit on them.
 * Later this will be built from the engine snapshot; for now see demo/demoTopology.ts.
 */
export type BoxKind = 'rack' | 'spine';
export type DeviceKind = 'host' | 'switch';
/** How a cable bulges away from the rack face. */
export type CableRoute = 'loopLeft' | 'loopRight' | 'uplink';

export interface BoxSpec {
  readonly id: string;
  readonly label: string;
  readonly kind: BoxKind;
  readonly gx: number;
  readonly gy: number;
  /** Size along +gx (tiles). */
  readonly w: number;
  /** Size along +gy (tiles); the +gy face is the "front". */
  readonly d: number;
  readonly heightPx: number;
}

export interface DeviceSpec {
  readonly id: string;
  readonly label: string;
  readonly kind: DeviceKind;
  readonly boxId: string;
  /** Vertical extent on the front face, 0 = floor, 1 = top. */
  readonly v0: number;
  readonly v1: number;
}

export interface CableEnd {
  readonly deviceId: string;
  /** Horizontal position on the front face, 0 = left edge, 1 = right edge. */
  readonly u: number;
}

export interface CableSpec {
  readonly id: string;
  readonly label: string;
  readonly from: CableEnd;
  readonly to: CableEnd;
  readonly route: CableRoute;
  /** Bulge distance (tiles for loops, px/100 for uplinks). */
  readonly bulge: number;
}

export interface FloorSpec {
  readonly cols: number;
  readonly rows: number;
  /** Rows (gy) tinted as a cold aisle in front of the racks. */
  readonly aisleRows: readonly number[];
}

export interface Topology {
  readonly floor: FloorSpec;
  readonly boxes: readonly BoxSpec[];
  readonly devices: readonly DeviceSpec[];
  readonly cables: readonly CableSpec[];
}
