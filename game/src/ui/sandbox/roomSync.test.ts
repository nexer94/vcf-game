import { describe, expect, it } from 'vitest';
import { bmcTransfersOf, elevationRacks, linkTrafficOf, roomContentsOf } from './roomSync';
import { LocalRoomPort } from './sessionFallback';
import type { RoomState } from './sessionPort';

function built(): { port: LocalRoomPort; ids: Record<string, string> } {
  const port = new LocalRoomPort();
  const id = (r: { ok: boolean; id?: string }): string => (r as { id: string }).id;
  const r1 = id(port.buyItem('rack-generic-42u'));
  const r2 = id(port.buyItem('rack-generic-42u'));
  port.placeRack(r1, { gx: 2, gy: 2 });
  port.placeRack(r2, { gx: 5, gy: 2 });
  const s1 = id(port.buyItem('dell-r670-med'));
  const sw = id(port.buyItem('sw-generic-48x25g'));
  port.mountDevice(s1, r1);
  port.mountDevice(sw, r2, 42);
  port.connectCable({ deviceId: s1, port: 0 }, { deviceId: sw, port: 0 });
  port.connectCable({ deviceId: s1, port: 'bmc' }, { deviceId: sw, port: 1 });
  return { port, ids: { r1, r2, s1, sw } };
}

describe('room sync', () => {
  it('maps placed racks, mounted devices and cables (BMC = -1)', () => {
    const { port, ids } = built();
    const c = roomContentsOf(port.state());
    expect(c.cabinets.map((x) => x.spec.id)).toEqual([ids.r1, ids.r2]);
    expect(c.cabinets[0]!.devices[0]).toMatchObject({ id: ids.s1, kind: 'server', u: 1, heightU: 2 });
    expect(c.cabinets[0]!.devices[0]!.tagColor).toBeDefined();
    expect(c.cables.map((x) => x.from.port)).toEqual([0, -1]);
  });

  it('puts the selected rack first and linked racks next', () => {
    const { port, ids } = built();
    const cols = elevationRacks(port.state(), ids.r2);
    expect(cols.map((c) => c.id)).toEqual([ids.r2, ids.r1]);
    expect(cols[1]!.devices[0]).toMatchObject({ nicPorts: 2, bmc: true });
    expect(elevationRacks(port.state(), 'nope')).toEqual([]);
  });

  it('turns model link loads into dots; oob only as BMC transfer', () => {
    const fake = {
      traffic: [
        { cableId: 'a', speedGbE: 25, byClass: { management: 0.02 }, utilization: 0.001 },
        { cableId: 'b', speedGbE: 1, byClass: { oob: 0.01 }, utilization: 0.01 },
      ],
    } as unknown as RoomState;
    const m = linkTrafficOf(fake);
    expect([...m.keys()]).toEqual(['a']);
    expect(m.get('a')!.mix[0]!.type).toBe('management');
    expect(bmcTransfersOf(fake)).toEqual(['b']);
  });
});
