import { describe, expect, it } from 'vitest';
import { sampleBezier, polylineLength, type CubicBezier } from '../geom/bezier';
import type { CableGeometry } from '../scene/layout';
import { emitRate } from './flowScale';
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

describe('PacketSim (v3 calibration, UX §28.4)', () => {
  it('emits logarithmically per traffic type, coloured and sized by volume', () => {
    const sim = new PacketSim([cable], { ...DEFAULT_PACKET_SIM, speedPxPerMs: 0.0001, budget: Infinity });
    const traffic = new Map([['c', deriveLinkTraffic('c', 25, [{ type: 'vsan', gbps: 4 }])]]);
    sim.step(1000, 16, traffic); // emitRate(4) ≈ 2.3 dots / s
    expect(sim.count).toBe(Math.floor(emitRate(4)));
    expect(sim.packets[0]!.color).toBe(TRAFFIC_STYLE.vsan.color);
    expect(sim.packets[0]!.scale).toBeGreaterThan(0.75);
  });

  it('every flow is visible: 1 Mb/s still emits 0.4 dots / s', () => {
    const sim = new PacketSim([cable], { ...DEFAULT_PACKET_SIM, speedPxPerMs: 0.0001 });
    const traffic = new Map([['c', deriveLinkTraffic('c', 25, [{ type: 'management', gbps: 0.001 }])]]);
    for (let i = 0; i < 10; i++) sim.step(500, 16, traffic); // 5 s
    expect(sim.count).toBe(2);
    expect(sim.packets[0]!.scale).toBeCloseTo(0.55);
  });

  it('each type of a mixed link gets its own (minimum) rate', () => {
    const sim = new PacketSim([cable], { ...DEFAULT_PACKET_SIM, speedPxPerMs: 0.0001 });
    const traffic = new Map([['c', deriveLinkTraffic('c', 25, [{ type: 'vsan', gbps: 8 }, { type: 'management', gbps: 0.001 }])]]);
    for (let i = 0; i < 10; i++) sim.step(500, 16, traffic);
    const types = new Set(sim.packets.slice(0, sim.count).map((p) => p.type));
    expect(types.has('management')).toBe(true);
    expect(types.has('vsan')).toBe(true);
  });

  it('freezes when the game is paused', () => {
    const sim = new PacketSim([cable]);
    const traffic = new Map([['c', deriveLinkTraffic('c', 10, [{ type: 'vm', gbps: 5 }])]]);
    sim.step(0, 16, traffic);
    expect(sim.count).toBe(0);
  });

  it('retires packets after they travel the whole cable', () => {
    const sim = new PacketSim([cable]);
    const busy = new Map([['c', deriveLinkTraffic('c', 10, [{ type: 'vm', gbps: 1 }])]]);
    sim.step(1000, 16, busy);
    expect(sim.count).toBeGreaterThan(0);
    const idle = new Map([['c', deriveLinkTraffic('c', 10, [])]]);
    sim.step(5000, 16, idle); // 90 px at 0.07 px/ms ≈ 1.3 s
    expect(sim.count).toBe(0);
  });

  it('speed is constant across volumes and slows only with congestion', () => {
    const a = new PacketSim([cable]);
    const b = new PacketSim([cable]);
    const c = new PacketSim([cable]);
    a.step(1000, 16, new Map([['c', deriveLinkTraffic('c', 25, [{ type: 'vsan', gbps: 0.01 }])]]));
    b.step(1000, 16, new Map([['c', deriveLinkTraffic('c', 25, [{ type: 'vsan', gbps: 10 }])]]));
    c.step(1000, 16, new Map([['c', deriveLinkTraffic('c', 10, [{ type: 'vsan', gbps: 12 }])]]));
    expect(a.packets[0]!.speed).toBeCloseTo(b.packets[0]!.speed);
    expect(c.packets[0]!.speed).toBeCloseTo(b.packets[0]!.speed * 0.4);
  });

  it('fast-forward spawns sparser, slower-on-screen packets (density preserved)', () => {
    const traffic = new Map([['c', deriveLinkTraffic('c', 100, [{ type: 'vsan', gbps: 100 }])]]); // 3 dots / s
    const slow = { ...DEFAULT_PACKET_SIM, speedPxPerMs: 0.0001, budget: Infinity };
    const s1 = new PacketSim([cable], slow);
    const s16 = new PacketSim([cable], slow);
    s1.step(4000, 400, traffic, 1); // 12
    s16.step(4000, 25, traffic, 16); // 12 / 4 = 3
    expect(s16.packets[0]!.speed).toBeCloseTo(s1.packets[0]!.speed / 4);
    expect(s1.count).toBe(12);
    expect(s16.count).toBe(3);
  });

  it('budget scales rates down but not below 0.25 / s per flow', () => {
    const cables = Array.from({ length: 40 }, (_, i) => ({ ...cable, spec: { ...cable.spec, id: `c${i}` } }));
    const traffic = new Map(cables.map((c) => [c.spec.id, deriveLinkTraffic(c.spec.id, 100, [{ type: 'vsan' as const, gbps: 100 }])]));
    const free = new PacketSim(cables, { ...DEFAULT_PACKET_SIM, maxPackets: 2000, speedPxPerMs: 0.0001, budget: Infinity });
    const tight = new PacketSim(cables, { ...DEFAULT_PACKET_SIM, speedPxPerMs: 0.0001, budget: 10 });
    for (let i = 0; i < 8; i++) {
      free.step(500, 16, traffic);
      tight.step(500, 16, traffic);
    }
    expect(free.count).toBe(40 * 12);
    expect(tight.count).toBe(40 * 1); // 0.25 / s × 4 s
  });

  it('drops packets on overloaded links and never exceeds the pool', () => {
    const sim = new PacketSim([cable], { ...DEFAULT_PACKET_SIM, maxPackets: 5, rateScale: 20 });
    const overload = new Map([['c', deriveLinkTraffic('c', 10, [{ type: 'vmotion', gbps: 14 }])]]);
    let sawDrop = false;
    for (let i = 0; i < 200; i++) {
      sim.step(50, 16, overload);
      expect(sim.count).toBeLessThanOrEqual(5);
      for (let k = 0; k < sim.count; k++) if (sim.packets[k]!.color === DROP_COLOR) sawDrop = true;
    }
    expect(sawDrop).toBe(true);
    expect(sim.refused).toBeGreaterThan(0);
  });
});
