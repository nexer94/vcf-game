import { describe, expect, it } from 'vitest';
import { deriveLinkTraffic } from './trafficModel';

describe('deriveLinkTraffic', () => {
  it('idle link: no queue, no drops', () => {
    const t = deriveLinkTraffic('l', 10, []);
    expect(t.utilization).toBe(0);
    expect(t.queueDepth).toBe(0);
    expect(t.dropFraction).toBe(0);
    expect(t.dropsPerSec).toBe(0);
  });

  it('moderate load: utilisation proportional, no drops', () => {
    const t = deriveLinkTraffic('l', 10, [
      { type: 'vsan', gbps: 3 },
      { type: 'management', gbps: 1 },
    ]);
    expect(t.demandGbps).toBe(4);
    expect(t.utilization).toBeCloseTo(0.4);
    expect(t.queueDepth).toBe(0);
    expect(t.dropFraction).toBe(0);
  });

  it('overload: throughput capped, queue full, drops > 0', () => {
    const t = deriveLinkTraffic('l', 10, [{ type: 'vmotion', gbps: 12 }]);
    expect(t.throughputGbps).toBe(10);
    expect(t.utilization).toBe(1);
    expect(t.queueDepth).toBeGreaterThan(0);
    expect(t.dropFraction).toBeGreaterThan(0);
    expect(t.dropsPerSec).toBeGreaterThan(0);
    expect(t.latencyMs).toBeGreaterThan(1);
  });
});
