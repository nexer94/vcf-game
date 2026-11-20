import { describe, expect, it } from 'vitest';
import { buildLayout } from '../scene/layout';
import { loadBand } from '../traffic/loadStyle';
import { createDemoTopology } from './demoTopology';
import { DemoTrafficSource, burstEnvelope, vMotionBurstAt } from './demoTraffic';

describe('demo traffic', () => {
  const topo = createDemoTopology();
  const src = new DemoTrafficSource();

  it('covers every cable of the demo topology', () => {
    const s = src.sample(1234);
    for (const c of topo.cables) expect(s.has(c.id)).toBe(true);
    expect(s.size).toBe(topo.cables.length);
  });

  it('is deterministic and non-negative', () => {
    const a = new DemoTrafficSource().sample(56_789);
    const b = new DemoTrafficSource().sample(56_789);
    expect([...a.values()]).toEqual([...b.values()]);
    for (const t of a.values()) {
      for (const c of t.mix) expect(c.gbps).toBeGreaterThanOrEqual(0);
      expect(t.utilization).toBeGreaterThanOrEqual(0);
      expect(t.utilization).toBeLessThanOrEqual(1);
    }
  });

  it('shows normal, warning and overloaded links over time', () => {
    const bands = new Set<string>();
    let drops = false;
    for (let t = 0; t < 240_000; t += 500) {
      for (const l of src.sample(t).values()) {
        bands.add(loadBand(l.utilization));
        if (l.dropsPerSec > 0) drops = true;
      }
    }
    expect(bands).toEqual(new Set(['normal', 'warn', 'crit']));
    expect(drops).toBe(true);
  });

  it('bursts only inside their window', () => {
    expect(burstEnvelope(1, 40, [3, 21])).toBe(0);
    expect(burstEnvelope(12, 40, [3, 21])).toBe(1);
    expect(burstEnvelope(21, 40, [3, 21])).toBe(0);
    expect(vMotionBurstAt(0)).toBeNull();
    expect(vMotionBurstAt(12)?.gbps).toBeGreaterThan(0);
  });

  it('builds a finite layout for the demo topology', () => {
    const layout = buildLayout(topo);
    expect(layout.cables).toHaveLength(topo.cables.length);
    for (const c of layout.cables) expect(c.length).toBeGreaterThan(10);
    expect(Number.isFinite(layout.bounds.width)).toBe(true);
  });
});
