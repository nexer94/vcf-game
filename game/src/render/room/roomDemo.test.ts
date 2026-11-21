import { describe, expect, it } from 'vitest';
import { ROOM_DEMO_CABLES, RoomDemoTraffic } from './roomDemo';

describe('RoomDemoTraffic (illustrative)', () => {
  it('is deterministic and covers every demo cable', () => {
    const a = new RoomDemoTraffic().sample(12_345);
    const b = new RoomDemoTraffic().sample(12_345);
    expect([...a.keys()].sort()).toEqual(ROOM_DEMO_CABLES.map((c) => c.id).sort());
    for (const [k, v] of a) expect(b.get(k)).toEqual(v);
  });

  it('periodically overloads one link so drops are visible', () => {
    const src = new RoomDemoTraffic();
    let maxDrop = 0;
    for (let t = 0; t < 30_000; t += 250) {
      for (const v of src.sample(t).values()) maxDrop = Math.max(maxDrop, v.dropFraction);
    }
    expect(maxDrop).toBeGreaterThan(0);
  });
});
