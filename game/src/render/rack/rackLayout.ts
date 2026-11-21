/**
 * 2D front elevation of racks (UX.md §9.1–9.2). Pure geometry, no PixiJS.
 *
 * - One column per rack (selected rack first). U numbering from the top (U42) down to U1.
 * - Empty runs of >= 4 U are compressed into one hatched band "N U volné" (clickable to expand later).
 * - Devices: servers (vendor tag, label, BMC port + NIC ports, LEDs), generic switches (numbered ports in
 *   two rows, uplink port framed). Port geometry is exported for picking, DOM buttons and cable routing.
 * - Each column has a cable channel on its right side; the overhead tray runs above all columns.
 *
 * All sizes are drawing scale only (no VCF facts).
 */

export interface ElevDevice {
  readonly id: string;
  readonly kind: 'server' | 'switch';
  /** Lowest occupied U (1-based). */
  readonly u: number;
  readonly heightU: number;
  readonly label: string;
  readonly sublabel?: string;
  readonly tagColor?: number;
  readonly nicPorts: number;
  readonly bmc: boolean;
  readonly switchPorts: number;
}

export interface ElevRack {
  readonly id: string;
  readonly label: string;
  readonly heightU: number;
  readonly devices: readonly ElevDevice[];
}

export type ElevRow =
  | { readonly kind: 'device'; readonly deviceId: string; readonly y: number; readonly h: number; readonly topU: number; readonly bottomU: number }
  | { readonly kind: 'empty'; readonly y: number; readonly h: number; readonly topU: number; readonly bottomU: number; readonly compressed: boolean };

export interface PortGeom {
  /** `${deviceId}:${port}` (same as sessionPort.portKeyId). */
  readonly id: string;
  readonly deviceId: string;
  readonly port: number | 'bmc';
  readonly column: number;
  /** Centre. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Hit / button cell (no overlap with neighbours). */
  readonly cell: { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
  /** y where cables leave the port row (below or above the port). */
  readonly stubY: number;
}

export interface DeviceGeom {
  readonly id: string;
  readonly kind: 'server' | 'switch';
  readonly column: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface ColumnLayout {
  readonly rackId: string;
  readonly label: string;
  readonly index: number;
  /** Outer frame. */
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  /** Mounting area between the rails. */
  readonly innerX: number;
  readonly innerW: number;
  /** Cable channel on the right of the mounting area. */
  readonly channelX: number;
  readonly channelW: number;
  readonly rows: readonly ElevRow[];
}

export interface ElevationLayout {
  readonly width: number;
  readonly height: number;
  readonly trayY: number;
  readonly columns: readonly ColumnLayout[];
  readonly devices: ReadonlyMap<string, DeviceGeom>;
  readonly ports: ReadonlyMap<string, PortGeom>;
}

export const ELEV = {
  uPx: 26,
  /** Height of a compressed empty band. */
  bandPx: 30,
  /** Minimum empty run that gets compressed. */
  compressMin: 4,
  margin: 24,
  trayH: 34,
  headerH: 26,
  railW: 26,
  faceW: 440,
  channelW: 30,
  colGap: 56,
  portW: 13,
  portH: 10,
  portPitch: 17,
  switchRows: 2,
} as const;

/** Rows of a rack from the top, compressing empty runs. */
export function rackRows(rack: ElevRack, top: number, compress = true): ElevRow[] {
  const at = new Map<number, ElevDevice>();
  for (const d of rack.devices) at.set(d.u + d.heightU - 1, d);
  const occupied = new Set<number>();
  for (const d of rack.devices) for (let u = d.u; u < d.u + d.heightU; u++) occupied.add(u);
  const rows: ElevRow[] = [];
  let y = top;
  let u = rack.heightU;
  while (u >= 1) {
    const dev = at.get(u);
    if (dev) {
      const h = deviceHeightPx(dev);
      rows.push({ kind: 'device', deviceId: dev.id, y, h, topU: u, bottomU: dev.u });
      y += h;
      u = dev.u - 1;
      continue;
    }
    let run = 0;
    while (u - run >= 1 && !occupied.has(u - run)) run++;
    if (compress && run >= ELEV.compressMin) {
      rows.push({ kind: 'empty', y, h: ELEV.bandPx, topU: u, bottomU: u - run + 1, compressed: true });
      y += ELEV.bandPx;
    } else {
      for (let i = 0; i < run; i++) {
        rows.push({ kind: 'empty', y, h: ELEV.uPx, topU: u - i, bottomU: u - i, compressed: false });
        y += ELEV.uPx;
      }
    }
    u -= run;
  }
  return rows;
}

export function deviceHeightPx(d: ElevDevice): number {
  return d.heightU * ELEV.uPx + (d.kind === 'switch' && d.heightU === 1 ? 10 : 0);
}

/** Port centres of a device (relative to the device rect). */
function devicePorts(d: ElevDevice, w: number, h: number): { port: number | 'bmc'; x: number; y: number; stubDy: number }[] {
  const out: { port: number | 'bmc'; x: number; y: number; stubDy: number }[] = [];
  const P = ELEV.portPitch;
  if (d.kind === 'server') {
    // Right half: BMC first (distinct, game scope), then NIC ports.
    const n = d.nicPorts + (d.bmc ? 1 : 0);
    const startX = w - 22 - (n - 1) * P;
    const y = h / 2;
    let i = 0;
    if (d.bmc) out.push({ port: 'bmc', x: startX + P * i++ - 6, y, stubDy: h / 2 - 3 });
    for (let p = 0; p < d.nicPorts; p++) out.push({ port: p, x: startX + P * i++, y, stubDy: h / 2 - 3 });
    return out;
  }
  // Switch: two rows, odd ports on top (p1, p3, ...) like many ToR faceplates; port 0 = p1.
  const perRow = Math.ceil(d.switchPorts / ELEV.switchRows);
  const startX = 92;
  const avail = w - startX - 16;
  const pitch = Math.min(P, avail / Math.max(1, perRow));
  for (let p = 0; p < d.switchPorts; p++) {
    const row = p % 2;
    const col = Math.floor(p / 2);
    const y = row === 0 ? h / 2 - 7 : h / 2 + 7;
    out.push({ port: p, x: startX + pitch * col + pitch / 2, y, stubDy: row === 0 ? -(y - 2) : h - y - 2 });
  }
  return out;
}

/** Layout of all columns. `racks[0]` = selected rack. */
export function layoutElevation(racks: readonly ElevRack[], compress = true): ElevationLayout {
  const columns: ColumnLayout[] = [];
  const devices = new Map<string, DeviceGeom>();
  const ports = new Map<string, PortGeom>();
  const top = ELEV.margin + ELEV.trayH + ELEV.headerH;
  let x = ELEV.margin;
  let maxBottom = top;
  racks.forEach((rack, index) => {
    const rows = rackRows(rack, top + 8, compress);
    const last = rows[rows.length - 1];
    const bottom = (last ? last.y + last.h : top) + 8;
    const innerX = x + ELEV.railW;
    const innerW = ELEV.faceW;
    const channelX = innerX + innerW + 4;
    const w = ELEV.railW + innerW + 4 + ELEV.channelW + 6;
    columns.push({ rackId: rack.id, label: rack.label, index, x, y: top, w, h: bottom - top, innerX, innerW, channelX, channelW: ELEV.channelW, rows });
    for (const row of rows) {
      if (row.kind !== 'device') continue;
      const d = rack.devices.find((dd) => dd.id === row.deviceId)!;
      const g: DeviceGeom = { id: d.id, kind: d.kind, column: index, x: innerX + 2, y: row.y + 1, w: innerW - 4, h: row.h - 2 };
      devices.set(d.id, g);
      const local = devicePorts(d, g.w, g.h);
      for (let i = 0; i < local.length; i++) {
        const lp = local[i]!;
        const cx = g.x + lp.x;
        const cy = g.y + lp.y;
        let half = 9;
        for (const o of local) if (o !== lp && o.y === lp.y) half = Math.min(half, Math.abs(o.x - lp.x) / 2);
        const cellH = d.kind === 'switch' ? 14 : Math.min(24, g.h - 4);
        const id = `${d.id}:${lp.port}`;
        ports.set(id, {
          id,
          deviceId: d.id,
          port: lp.port,
          column: index,
          x: cx,
          y: cy,
          w: lp.port === 'bmc' ? ELEV.portH : ELEV.portW,
          h: ELEV.portH,
          cell: { x: cx - half, y: cy - cellH / 2, w: half * 2, h: cellH },
          stubY: cy + lp.stubDy,
        });
      }
    }
    maxBottom = Math.max(maxBottom, bottom);
    x += w + ELEV.colGap;
  });
  return {
    width: x - ELEV.colGap + ELEV.margin,
    height: maxBottom + ELEV.margin,
    trayY: ELEV.margin + ELEV.trayH / 2,
    columns,
    devices,
    ports,
  };
}

/** Row under a point in a column (for "mount here" clicks on empty U). */
export function rowAt(layout: ElevationLayout, x: number, y: number): { column: ColumnLayout; row: ElevRow } | null {
  for (const c of layout.columns) {
    if (x < c.innerX || x > c.innerX + c.innerW) continue;
    const row = c.rows.find((r) => y >= r.y && y < r.y + r.h);
    if (row) return { column: c, row };
  }
  return null;
}
