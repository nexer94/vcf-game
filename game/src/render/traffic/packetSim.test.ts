import { describe, expect, it } from 'vitest';
import { sampleBezier, polylineLength, type CubicBezier } from '../geom/bezier';
import type { CableGeometry } from '../scene/layout';
import { DEFAULT_PACKET_SIM, DROP_COLOR, PacketSim } from './packetSim';
import { deriveLinkTraffic } from './trafficModel';
import { TRAFFIC_STYLE } from './trafficTypes';

const curve: CubicBezier = { p0: { x: 0, y: 0 }, p1: { x: 30, y: 0 }, p2: { x: 60, y: 0 }, p3: { x: 90, y: 0 } };
const samples = sampleBezier(curve, 8);
const cable: CableGeometry = {
  spec: { id: 'c', label: 'c', from: { deviceId: 'a', u: 0 }, to: { deviceId: 'b', u: 0 }, route: 'loopLeft', bulge: 0 },
  curve,
  samples,
  length: polylineLength(samples),
};

describe('PacketSim', () => {
  it('spawns packets proportional to load, coloured by traffic type', () => {
    const sim = new PacketSim([cable], { ...DEFAULT_PACKET_SIM, packetsPerGbps: 10 });
    const traffic = new Map([['c', deriveLinkTraffic('c', 10, [{ type: 'vsan', gbps: 2 }])]]);
    sim.step(100, 100, traffic); // 2 Gb/s * 10 * 0.1 s = 2 packets
    expect(sim.count).toBe(2);
    expect(sim.packets[0]!.color).toBe(TRAFFIC_STYLE.vsan.color);
  });

  it('freezes when the game is paused', () => {
    const sim = new PacketSim([cable]);
    const traffic = new Map([['c', deriveLinkTraffic('c', 10, [{ type: 'vm', gbps: 5 }])]]);
    sim.step(0, 16, traffic);
    expect(sim.count).toBe(0);
  });

  it('retires packets after they travel the whole cable', () => {
    const sim = new PacketSim([cable], { ...DEFAULT_PACKET_SIM, packetsPerGbps: 10 });
    const busy = new Map([['c', deriveLinkTraffic('c', 10, [{ type: 'vm', gbps: 1 }])]]);
    sim.step(100, 100, busy);
    expect(sim.count).toBe(1);
    const idle = new Map([['c', deriveLinkTraffic('c', 10, [])]]);
    sim.step(5000, 16, idle); // 90 px at 0.09 px/ms = 1000 ms
    expect(sim.count).toBe(0);
  });

  it('fast-forward spawns sparser, faster packets (density preserved on screen)', () => {
    const traffic = new Map([['c', deriveLinkTraffic('c', 10, [{ type: 'vsan', gbps: 2 }])]]);
    const s1 = new PacketSim([cable], { ...DEFAULT_PACKET_SIM, packetsPerGbps: 10 });
    const s16 = new PacketSim([cable], { ...DEFAULT_PACKET_SIM, packetsPerGbps: 10 });
    s1.step(400, 400, traffic, 1); // 8 packets
    s16.step(400, 25, traffic, 16); // 8 / sqrt(16) = 2 packets
    expect(s1.count).toBe(8);
    expect(s16.count).toBe(2);
    expect(s16.packets[0]!.speed).toBeCloseTo(s1.packets[0]!.speed / 4);
  });

  it('drops packets on overloaded links and never exceeds the pool', () => {
    const sim = new PacketSim([cable], { ...DEFAULT_PACKET_SIM, maxPackets: 50, packetsPerGbps: 20 });
    const overload = new Map([['c', deriveLinkTraffic('c', 10, [{ type: 'vmotion', gbps: 14 }])]]);
    let sawDrop = false;
    for (let i = 0; i < 60; i++) {
      sim.step(50, 16, overload);
      expect(sim.count).toBeLessThanOrEqual(50);
      for (let k = 0; k < sim.count; k++) if (sim.packets[k]!.color === DROP_COLOR) sawDrop = true;
    }
    expect(sawDrop).toBe(true);
    expect(sim.refused).toBeGreaterThan(0);
  });
});
