import { describe, expect, it } from 'vitest';
import { isoToScreen } from '../iso';
import { planBounds, planSite, pointAlong, roomAt, type SiteSceneInput } from './siteGeom';

const room = (id: string, buildingId: string) => ({ id, label: id, cols: 10, rows: 8, buildingId, az: null, racks: [] });

describe('site plan', () => {
  it('two rooms in one building: corridor between them, no outdoor ground', () => {
    const input: SiteSceneInput = {
      rooms: [room('m1', 'b1'), room('m2', 'b1')],
      buildings: [{ id: 'b1', label: 'B', siteId: 's' }],
      sites: [{ id: 's', label: 'S', role: 'primary' }],
      links: [{ id: 'l', from: 'm1', to: 'm2', kind: 'corridor' }],
    };
    const plan = planSite(input);
    expect(plan.ground).toBeNull();
    expect(plan.buildings[0]!.corridors).toHaveLength(1);
    expect(plan.rooms[1]!.ox).toBeGreaterThan(plan.rooms[0]!.ox + 10);
    expect(plan.links).toHaveLength(1);
    const c = isoToScreen(plan.rooms[1]!.ox + 5, 4);
    expect(roomAt(plan, c.x, c.y)).toBe('m2');
    const b = planBounds(plan);
    expect(b.width).toBeGreaterThan(0);
  });

  it('remote site is far away and its link is marked not to scale', () => {
    const plan = planSite({
      rooms: [room('m1', 'b1'), room('m2', 'b2')],
      buildings: [{ id: 'b1', label: 'A', siteId: 'hq' }, { id: 'b2', label: 'B', siteId: 'dr' }],
      sites: [{ id: 'hq', label: 'HQ', role: 'primary' }, { id: 'dr', label: 'DR', role: 'remote' }],
      links: [{ id: 'l', from: 'm1', to: 'm2', kind: 'wan' }],
    });
    expect(plan.ground).not.toBeNull();
    expect(plan.links[0]!.breakAt).not.toBeNull();
    expect(plan.rooms[1]!.ox - plan.rooms[0]!.ox).toBeGreaterThan(25);
  });

  it('pointAlong walks a polyline and wraps', () => {
    const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    expect(pointAlong(pts, 5)).toEqual({ x: 5, y: 0 });
    expect(pointAlong(pts, 15).x).toBeCloseTo(5);
  });
});
