import { describe, expect, it } from 'vitest';
import { layoutElevation, rackRows, rowAt, type ElevRack } from './rackLayout';
import { isOrthogonal, laneX, routeAll, simplify } from './rackRoute';

const rackA: ElevRack = {
  id: 'R1',
  label: 'R1',
  heightU: 42,
  devices: [
    { id: 'srv-01', kind: 'server', u: 1, heightU: 2, label: 'srv-01', nicPorts: 2, bmc: true, switchPorts: 0 },
    { id: 'srv-02', kind: 'server', u: 3, heightU: 2, label: 'srv-02', nicPorts: 4, bmc: true, switchPorts: 0 },
    { id: 'sw-a', kind: 'switch', u: 42, heightU: 1, label: 'sw-a', nicPorts: 0, bmc: false, switchPorts: 48 },
  ],
};
const rackB: ElevRack = {
  id: 'R2',
  label: 'R2',
  heightU: 42,
  devices: [{ id: 'sw-b', kind: 'switch', u: 42, heightU: 1, label: 'sw-b', nicPorts: 0, bmc: false, switchPorts: 48 }],
};

describe('rack elevation layout', () => {
  it('compresses empty runs of >= 4 U into one band', () => {
    const rows = rackRows(rackA, 0);
    expect(rows.map((r) => r.kind)).toEqual(['device', 'empty', 'device', 'device']);
    const band = rows[1]!;
    expect(band).toMatchObject({ kind: 'empty', compressed: true, topU: 41, bottomU: 5 });
    // Without compression every empty U has its own row.
    expect(rackRows(rackA, 0, false).filter((r) => r.kind === 'empty')).toHaveLength(37);
  });

  it('does not compress short gaps', () => {
    const r: ElevRack = { ...rackA, heightU: 6, devices: [{ ...rackA.devices[0]!, u: 4 }] };
    const rows = rackRows(r, 0);
    expect(rows.filter((x) => x.kind === 'empty').every((x) => x.kind === 'empty' && !x.compressed)).toBe(true);
  });

  it('places every port (NICs + BMC, switch ports) without overlapping cells', () => {
    const L = layoutElevation([rackA]);
    expect(L.ports.has('srv-01:bmc')).toBe(true);
    expect(L.ports.has('srv-02:3')).toBe(true);
    expect(L.ports.has('sw-a:47')).toBe(true);
    const cells = [...L.ports.values()].map((p) => p.cell);
    for (let i = 0; i < cells.length; i++)
      for (let j = i + 1; j < cells.length; j++) {
        const a = cells[i]!;
        const b = cells[j]!;
        const overlap = a.x < b.x + b.w - 0.01 && b.x < a.x + a.w - 0.01 && a.y < b.y + b.h - 0.01 && b.y < a.y + a.h - 0.01;
        expect(overlap).toBe(false);
      }
    const hit = rowAt(L, L.columns[0]!.innerX + 50, L.columns[0]!.rows[1]!.y + 5);
    expect(hit?.row.kind).toBe('empty');
  });
});

describe('rack cable auto-route', () => {
  it('routes within a rack through the side channel, orthogonally', () => {
    const L = layoutElevation([rackA]);
    const routes = routeAll(L, [{ id: 'c1', a: 'srv-01:0', b: 'sw-a:0' }]);
    const r = routes.get('c1')!;
    expect(isOrthogonal(r)).toBe(true);
    const p0 = L.ports.get('srv-01:0')!;
    const p1 = L.ports.get('sw-a:0')!;
    expect(r[0]).toEqual({ x: p0.x, y: p0.y });
    expect(r[r.length - 1]).toEqual({ x: p1.x, y: p1.y });
    const col = L.columns[0]!;
    // The vertical run is inside the channel.
    expect(r.some((p) => p.x >= col.channelX && p.x <= col.channelX + col.channelW)).toBe(true);
  });

  it('gives parallel cables separate lanes', () => {
    const L = layoutElevation([rackA]);
    const routes = routeAll(L, [
      { id: 'c1', a: 'srv-01:0', b: 'sw-a:0' },
      { id: 'c2', a: 'srv-01:1', b: 'sw-a:1' },
    ]);
    const xs = (id: string): number => Math.max(...routes.get(id)!.map((p) => p.x));
    expect(xs('c1')).not.toBe(xs('c2'));
    expect(laneX(0, 30, 1) - laneX(0, 30, 0)).toBe(3);
  });

  it('routes between racks over the overhead tray', () => {
    const L = layoutElevation([rackA, rackB]);
    const r = routeAll(L, [{ id: 'c1', a: 'srv-02:1', b: 'sw-b:3' }]).get('c1')!;
    expect(isOrthogonal(r)).toBe(true);
    expect(Math.min(...r.map((p) => p.y))).toBeLessThan(L.columns[0]!.y);
    expect(r[r.length - 1]!.x).toBeCloseTo(L.ports.get('sw-b:3')!.x);
  });

  it('skips cables with unknown ports and simplifies collinear points', () => {
    const L = layoutElevation([rackA]);
    expect(routeAll(L, [{ id: 'x', a: 'nope:0', b: 'sw-a:0' }]).size).toBe(0);
    expect(simplify([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }])).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
    ]);
  });
});
