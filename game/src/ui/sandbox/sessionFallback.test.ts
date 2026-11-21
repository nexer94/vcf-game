import { describe, expect, it } from 'vitest';
import { LocalRoomPort } from './sessionFallback';

describe('local room port (fallback over model transitions)', () => {
  it('buys, places, mounts and cables through the model', () => {
    const port = new LocalRoomPort();
    const st0 = port.state();
    expect(st0.catalog.servers.length).toBeGreaterThan(10);
    expect(new Set(st0.catalog.servers.map((s) => s.vendor))).toEqual(new Set(['Dell', 'HPE', 'Lenovo', 'Cisco', 'Supermicro']));
    expect(st0.catalog.servers.every((s) => s.price > 0)).toBe(true);

    const rack = port.buyItem('rack-generic-42u');
    expect(rack.ok).toBe(true);
    const rackId = (rack as { id: string }).id;
    expect(port.state().inventory.map((i) => i.id)).toEqual([rackId]);
    expect(port.placeRack(rackId, { gx: 2, gy: 2 }).ok).toBe(true);
    expect(port.state().inventory).toEqual([]);

    const srv = port.buyItem('dell-r670-med') as { ok: true; id: string };
    const sw = port.buyItem('sw-generic-48x25g') as { ok: true; id: string };
    expect(port.mountDevice(srv.id, rackId).ok).toBe(true);
    expect(port.mountDevice(sw.id, rackId, 40).ok).toBe(true);
    const st = port.state();
    expect(st.devices.find((d) => d.id === srv.id)?.mount).toEqual({ rackId, positionU: 1 });
    expect(st.devices.find((d) => d.id === srv.id)?.nicPorts.map((p) => p.label)).toEqual(['NIC 1', 'NIC 2']);
    // Host not cabled -> model issue shown as badge.
    expect(st.issues.map((i) => i.code)).toContain('PHYS_HOST_NOT_CONNECTED');
    expect(st.objectives.find((o) => o.id === 'room.cable')?.status).toBe('todo');

    // Overlap is a model (room) rule.
    const srv2 = port.buyItem('dell-r670-med') as { ok: true; id: string };
    const bad = port.mountDevice(srv2.id, rackId, 1);
    expect(bad.ok).toBe(false);

    const c = port.connectCable({ deviceId: srv.id, port: 0 }, { deviceId: sw.id, port: 0 });
    expect(c.ok).toBe(true);
    const st2 = port.state();
    expect(st2.cables).toHaveLength(1);
    expect(st2.cables[0]!.linkUp).toBe(true);
    expect(st2.issues.map((i) => i.code)).toContain('PHYS_SINGLE_TOR');
    expect(st2.issues.map((i) => i.code)).not.toContain('PHYS_HOST_NOT_CONNECTED');
    // Port in use is rejected by the model.
    expect(port.connectCable({ deviceId: srv.id, port: 1 }, { deviceId: sw.id, port: 0 }).ok).toBe(false);
    // Server <-> server is rejected by the model.
    expect(port.connectCable({ deviceId: srv.id, port: 1 }, { deviceId: srv2.id, port: 0 }).ok).toBe(false);

    expect(port.disconnectCable(st2.cables[0]!.id).ok).toBe(true);
    expect(port.state().cables).toHaveLength(0);
    expect(port.state().spent).toBeGreaterThan(0);
  });

  it('rack with devices cannot be removed; unmount drops cables', () => {
    const port = new LocalRoomPort();
    const r = (port.buyItem('rack-generic-42u') as { id: string }).id;
    port.placeRack(r, { gx: 1, gy: 1 });
    const s = (port.buyItem('hpe-dl380g12-med') as { id: string }).id;
    const w = (port.buyItem('sw-generic-48x25g') as { id: string }).id;
    port.mountDevice(s, r);
    port.mountDevice(w, r);
    port.connectCable({ deviceId: s, port: 'bmc' }, { deviceId: w, port: 5 });
    expect(port.state().cables[0]!.bmc).toBe(true);
    expect(port.removeItem(r).ok).toBe(false);
    port.unmountDevice(s);
    expect(port.state().cables).toHaveLength(0);
    expect(port.state().inventory.map((i) => i.id)).toEqual([s]);
  });
});
