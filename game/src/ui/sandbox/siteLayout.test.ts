import { describe, expect, it } from 'vitest';
import { SITE_LAYOUTS } from '../../model/sites';
import { blueprintCards, SITE_WHY_LINKS, UPCOMING_BLUEPRINTS } from './blueprints';
import { createLocalSitePort, doorTarget, presetLayout, siteSceneInput, SITE_LAYOUT_IDS, SITE_STORAGE_KEY, type KeyValueStore } from './siteLayout';

const memStore = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

describe('site layout view (from model/sites.ts)', () => {
  it('every preset mirrors the model: rooms, buildings, sites, links between existing rooms', () => {
    for (const id of SITE_LAYOUT_IDS) {
      const l = presetLayout(id);
      expect(l.rooms.map((r) => r.id)).toEqual(SITE_LAYOUTS[id].rooms.map((r) => r.id));
      const rooms = new Set(l.rooms.map((r) => r.id));
      for (const r of l.rooms) expect(l.buildings.some((b) => b.id === r.buildingId)).toBe(true);
      for (const b of l.buildings) expect(l.sites.some((s) => s.id === b.siteId)).toBe(true);
      for (const k of l.links) expect(rooms.has(k.from) && rooms.has(k.to)).toBe(true);
    }
    expect(presetLayout(null).rooms).toHaveLength(1);
  });

  it('door: two rooms -> the other room, more rooms -> overview', () => {
    const two = SITE_LAYOUT_IDS.find((id) => SITE_LAYOUTS[id].rooms.length === 2);
    if (two) {
      const [a, b] = presetLayout(two).rooms;
      expect(doorTarget(presetLayout(two), a!.id)).toBe(b!.id);
    }
    const single = SITE_LAYOUT_IDS.find((id) => SITE_LAYOUTS[id].rooms.length === 1)!;
    expect(doorTarget(presetLayout(single), presetLayout(single).rooms[0]!.id)).toBeNull();
  });

  it('scene input marks witness rooms', () => {
    const id = SITE_LAYOUT_IDS.find((x) => Object.values(SITE_LAYOUTS[x].defaultAssignment).includes('witness'));
    if (!id) return;
    const input = siteSceneInput(presetLayout(id), () => []);
    expect(input.rooms.some((r) => r.witness)).toBe(true);
  });
});

describe('local site port', () => {
  it('persists choice, role and rack-room assignment; resets them on a new layout', () => {
    const store = memStore();
    const p = createLocalSitePort(store);
    expect(p.layout().preset).toBeNull();
    p.choose('two-buildings', null);
    const [r1, r2] = p.layout().rooms;
    p.setAz(r2!.id, 'az2');
    p.setAz(r1!.id, null);
    p.assignRack('R1', r2!.id);
    const q = createLocalSitePort(store);
    expect(q.layout().preset).toBe('two-buildings');
    expect(q.layout().rooms.find((r) => r.id === r2!.id)?.az).toBe('az2');
    expect(q.layout().rooms.find((r) => r.id === r1!.id)?.az).toBeNull();
    expect(q.roomOfRack('R1')).toBe(r2!.id);
    expect(q.roomOfRack('R9')).toBe(r1!.id);
    q.choose('small-room', 'x');
    expect(q.roomOfRack('R1')).toBe(q.layout().rooms[0]!.id);
  });

  it('survives broken or unavailable storage', () => {
    const store = memStore();
    store.data.set(SITE_STORAGE_KEY, '{not json');
    expect(createLocalSitePort(store).layout().preset).toBeNull();
    const throwing: KeyValueStore = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('full'); } };
    const p = createLocalSitePort(throwing);
    p.choose('large-room', null);
    expect(p.layout().preset).toBe('large-room');
  });

  it('notifies subscribers', () => {
    const p = createLocalSitePort(null);
    let n = 0;
    const off = p.subscribe(() => n++);
    p.setAz('room-a1', 'az1');
    off();
    p.setAz('room-a1', null);
    expect(n).toBe(1);
  });
});

describe('blueprint cards', () => {
  it('five fleet blueprints with TechDocs links, fleet model, hosts and spec refs', () => {
    const cards = blueprintCards();
    expect(cards).toHaveLength(5);
    for (const c of cards) {
      expect(c.url.startsWith('https://techdocs.broadcom.com/')).toBe(true);
      expect(c.specRef).toMatch(/^06 §2\.\d/);
      expect(c.variants.length).toBeGreaterThan(0);
      expect(c.fleetModel).toBeTruthy();
      expect(c.hosts).toBeTruthy();
    }
    const siteHa = cards.find((c) => c.blueprintId === 'vcf-fleet-multiple-sites-single-region')!;
    expect(siteHa.variants.map((v) => v.layout)).toEqual(expect.arrayContaining(['two-rooms-one-building', 'two-buildings']));
    for (const l of [...SITE_WHY_LINKS, ...UPCOMING_BLUEPRINTS]) expect(l.url.startsWith('https://techdocs.broadcom.com/')).toBe(true);
  });
});
