import { describe, expect, it } from 'vitest';
import { SandboxSession } from '../../modes/sandbox';
import { roomStateFromSnapshot } from './sessionMapper';
import { sessionHasPhysical } from './sessionPort';

describe('session adapter (SandboxSession v2)', () => {
  it('maps the real session snapshot', () => {
    const s = new SandboxSession({ objectives: true });
    expect(sessionHasPhysical(s)).toBe(true);
    const created = (cmd: Parameters<SandboxSession['dispatch']>[0]): string => {
      const r = s.dispatch(cmd);
      if (!r.ok) throw new Error(JSON.stringify(r.rejection));
      return r.created?.[0] ?? '';
    };
    const rack = created({ type: 'buyItem', itemId: 'rack-generic-42u' });
    s.dispatch({ type: 'placeRack', inventoryId: rack, tile: { gx: 2, gy: 2 } });
    const srv = created({ type: 'buyItem', itemId: 'dell-r670-med' });
    const sw = created({ type: 'buyItem', itemId: 'sw-generic-48x25g' });
    expect(s.dispatch({ type: 'mountDevice', inventoryId: srv, rackId: rack }).ok).toBe(true);
    expect(s.dispatch({ type: 'mountDevice', inventoryId: sw, rackId: rack, positionU: 42 }).ok).toBe(true);
    expect(s.dispatch({ type: 'connectCable', from: { deviceId: srv, port: 0 }, to: { deviceId: sw, port: 0 } }).ok).toBe(true);
    const st = roomStateFromSnapshot(s.snapshot())!;
    expect(st.racks[0]!.tile).toEqual({ gx: 2, gy: 2 });
    expect(st.devices.find((d) => d.id === srv)?.mount?.rackId).toBe(rack);
    expect(st.cables.filter((c) => !c.bmc)).toHaveLength(1);
    expect(st.cables.filter((c) => c.bmc)).toHaveLength(1); // pre-wired OOB (autoBmc)
    expect(st.catalog.servers.length).toBeGreaterThan(10);
    expect(st.spent).toBeGreaterThan(0);
    expect(st.objectives.length).toBeGreaterThan(0);
    expect(st.objectives.every((o) => ['todo', 'progress', 'done', 'skipped', 'problem'].includes(o.status))).toBe(true);
  });
});
