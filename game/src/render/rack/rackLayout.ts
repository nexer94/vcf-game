/**
 * 2D front elevation of a rack – v3 (UX.md §19.3, GRAPHICS.md "Čelní pohled racku"). Pure geometry, no PixiJS.
 *
 * - Vertical rack, devices in U scale: 1 U = `uPx` (18 px at 1366×768, 22 px at 1920×1080); a 2U server is exactly
 *   twice a 1U ToR. U numbering from the top; the left ruler shows ranges ("7–8").
 * - Empty runs of >= 6 U are compressed into a band 3 U high ("18 U volné", break marks).
 * - The selected rack is the first column; other columns only when cables lead there.
 * - Servers: LED, NIC ports, free NIC slots "[+]" (UX 19.4), grey BMC port. Switches: two port rows, uplink framed.
 * - Reserved U for the recommended second ToR (UX 19.5): dashed outline row.
 * - Each column has a cable channel on its right; a thin grey bar above the racks leads to the ceiling tray.
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
  /** v3: NIC slots of a server (free = "[+]"); omitted = no slot info. */
  readonly nicSlots?: readonly { readonly slot: number; readonly free: boolean }[];
  /** v3: pre-installed (ToR-A / ToR-B) – badge "předinstalováno · herní". */
  readonly preinstalled?: boolean;
}

export interface ElevRack {
  readonly id: string;
  readonly label: string;
  readonly heightU: number;
  readonly devices: readonly ElevDevice[];
  /** v3: U reserved for the recommended second ToR (UX 19.5). */
  readonly reservedU?: number;
}

export type ElevRow =
  | { readonly kind: 'device'; readonly deviceId: string; readonly y: number; readonly h: number; readonly topU: number; readonly bottomU: number }
  | { readonly kind: 'reserved'; readonly y: number; readonly h: number; readonly topU: number; readonly bottomU: number }
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

export interface SlotGeom {
  readonly id: string;
  readonly deviceId: string;
  readonly slot: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
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
  /** y of the thin bar to the ceiling tray (cables leaving the view end here). */
  readonly trayY: number;
  readonly uPx: number;
  readonly columns: readonly ColumnLayout[];
  readonly devices: ReadonlyMap<string, DeviceGeom>;
  readonly ports: ReadonlyMap<string, PortGeom>;
  readonly slots: ReadonlyMap<string, SlotGeom>;
}

export const ELEV = {
  uPx: 18,
  /** Compressed empty band = 3 U high. */
  bandU: 3,
  /** Minimum empty run that gets compressed. */
  compressMin: 6,
  margin: 20,
  /** Space above the racks for the thin bar to the ceiling tray + labels. */
  trayH: 40,
  headerH: 22,
  /** Left rail with the U ruler. */
  railW: 34,
  faceW: 372,
  channelW: 30,
  colGap: 56,
  portW: 11,
  portH: 8,
  portPitch: 15,
  slotW: 16,
  switchRows: 2,
} as const;

/** Rows of a rack from the top, compressing empty runs (>= compressMin U -> one band of bandU). */
export function rackRows(rack: ElevRack, top: number, compress = true, uPx: number = ELEV.uPx): ElevRow[] {
  const at = new Map<number, ElevDevice>();
  for (const d of rack.devices) at.set(d.u + d.heightU - 1, d);
  const occupied = new Set<number>();
  for (const d of rack.devices) for (let u = d.u; u < d.u + d.heightU; u++) occupied.add(u);
  const reserved = rack.reservedU !== undefined && !occupied.has(rack.reservedU) ? rack.reservedU : undefined;
  const rows: ElevRow[] = [];
  let y = top;
  let u = rack.heightU;
  while (u >= 1) {
    const dev = at.get(u);
    if (dev) {
      const h = dev.heightU * uPx;
      rows.push({ kind: 'device', deviceId: dev.id, y, h, topU: u, bottomU: dev.u });
      y += h;
      u = dev.u - 1;
      continue;
    }
    if (u === reserved) {
      rows.push({ kind: 'reserved', y, h: uPx, topU: u, bottomU: u });
      y += uPx;
      u--;
      continue;
    }
    let run = 0;
    while (u - run >= 1 && !occupied.has(u - run) && u - run !== reserved) run++;
    if (compress && run >= ELEV.compressMin) {
      const h = ELEV.bandU * uPx;
      rows.push({ kind: 'empty', y, h, topU: u, bottomU: u - run + 1, compressed: true });
      y += h;
    } else {
      for (let i = 0; i < run; i++) {
        rows.push({ kind: 'empty', y, h: uPx, topU: u - i, bottomU: u - i, compressed: false });
        y += uPx;
      }
    }
    u -= run;
  }
  return rows;
}

/** Ruler text of a row: "7–8" for multi-U rows, "42" for one U. */
export const rowRange = (r: ElevRow): string => (r.topU === r.bottomU ? String(r.topU) : `${r.bottomU}–${r.topU}`);
/** Panel text of a device position: "U1–2" / "U42". */
export const uRangeLabel = (u: number, heightU: number): string => (heightU > 1 ? `U${u}–${u + heightU - 1}` : `U${u}`);

/** Port / slot centres of a device (relative to the device rect). */
function deviceParts(d: ElevDevice, w: number, h: number): { ports: { port: number | 'bmc'; x: number; y: number; stubDy: number }[]; slots: { slot: number; x: number }[] } {
  const ports: { port: number | 'bmc'; x: number; y: number; stubDy: number }[] = [];
  const slots: { slot: number; x: number }[] = [];
  const P = ELEV.portPitch;
  if (d.kind === 'server') {
    // Right part, right to left: LED (drawn), free NIC slots "[+]", NIC ports, BMC port (grey, game scope) first.
    const free = (d.nicSlots ?? []).filter((s) => s.free);
    let x = w - 22;
    for (let i = free.length - 1; i >= 0; i--) {
      x -= ELEV.slotW + 4;
      slots.unshift({ slot: free[i]!.slot, x: x + ELEV.slotW / 2 });
    }
    const n = d.nicPorts + (d.bmc ? 1 : 0);
    const startX = x - 8 - (n - 1) * P;
    const y = h / 2;
    let i = 0;
    if (d.bmc) ports.push({ port: 'bmc', x: startX + P * i++ - 6, y, stubDy: h / 2 - 2 });
    for (let p = 0; p < d.nicPorts; p++) ports.push({ port: p, x: startX + P * i++, y, stubDy: h / 2 - 2 });
    return { ports, slots };
  }
  // Switch: two rows, odd ports on top (p1, p3, ...) like many ToR faceplates; port 0 = p1.
  const perRow = Math.ceil(d.switchPorts / ELEV.switchRows);
  const startX = 96;
  const avail = w - startX - 10;
  const pitch = Math.min(P, avail / Math.max(1, perRow));
  const dy = Math.max(3.2, h / 4.4);
  for (let p = 0; p < d.switchPorts; p++) {
    const row = p % 2;
    const col = Math.floor(p / 2);
    const y = row === 0 ? h / 2 - dy : h / 2 + dy;
    ports.push({ port: p, x: startX + pitch * col + pitch / 2, y, stubDy: row === 0 ? -(y - 1) : h - y - 1 });
  }
  return { ports, slots };
}

export interface ElevationOptions {
  readonly compress?: boolean;
  readonly uPx?: number;
}

/** Layout of all columns. `racks[0]` = selected rack. */
export function layoutElevation(racks: readonly ElevRack[], opts: ElevationOptions | boolean = {}): ElevationLayout {
  const o: ElevationOptions = typeof opts === 'boolean' ? { compress: opts } : opts;
  const compress = o.compress ?? true;
  const uPx = o.uPx ?? ELEV.uPx;
  const columns: ColumnLayout[] = [];
  const devices = new Map<string, DeviceGeom>();
  const ports = new Map<string, PortGeom>();
  const slots = new Map<string, SlotGeom>();
  const top = ELEV.margin + ELEV.trayH + ELEV.headerH;
  let x = ELEV.margin;
  let maxBottom = top;
  const portH = Math.min(ELEV.portH, uPx * 0.42);
  racks.forEach((rack, index) => {
    const rows = rackRows(rack, top + 6, compress, uPx);
    const last = rows[rows.length - 1];
    const bottom = (last ? last.y + last.h : top) + 6;
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
      const parts = deviceParts(d, g.w, g.h);
      for (const s of parts.slots) {
        const sh = Math.min(g.h - 4, uPx * 1.2);
        slots.set(`${d.id}#${s.slot}`, { id: `${d.id}#${s.slot}`, deviceId: d.id, slot: s.slot, x: g.x + s.x - ELEV.slotW / 2, y: g.y + g.h / 2 - sh / 2, w: ELEV.slotW, h: sh });
      }
      const local = parts.ports;
      for (let i = 0; i < local.length; i++) {
        const lp = local[i]!;
        const cx = g.x + lp.x;
        const cy = g.y + lp.y;
        let half = 8;
        for (const q of local) if (q !== lp && q.y === lp.y) half = Math.min(half, Math.abs(q.x - lp.x) / 2);
        const cellH = d.kind === 'switch' ? Math.max(6, g.h / 2 - 1) : Math.min(20, g.h - 4);
        const id = `${d.id}:${lp.port}`;
        const pw = d.kind === 'switch' ? Math.min(ELEV.portW, half * 2 - 2) : lp.port === 'bmc' ? portH : ELEV.portW;
        ports.set(id, {
          id,
          deviceId: d.id,
          port: lp.port,
          column: index,
          x: cx,
          y: cy,
          w: pw,
          h: d.kind === 'switch' ? Math.min(portH, g.h / 2 - 3) : portH,
          cell: { x: cx - half, y: d.kind === 'switch' ? (lp.y < g.h / 2 ? g.y : g.y + g.h / 2) : cy - cellH / 2, w: half * 2, h: cellH },
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
    trayY: ELEV.margin + 10,
    uPx,
    columns,
    devices,
    ports,
    slots,
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
