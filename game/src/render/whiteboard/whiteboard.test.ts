import { describe, expect, it } from 'vitest';
import { describeBoard, layoutBoard, layoutKey, MAX_HOSTS_PER_RACK, type BoardInput } from './hldLayout';
import { BoardNotes, emptyNotes, LIMITS, NOTES_X, parseNotes, saveNotes, loadNotes, serializeNotes } from './notes';
import { dashPolyline, hashSeed, sketchRect, simplifyRdp, distToPolyline } from './sketch';

const EMPTY: BoardInput = { racks: [], switches: [], hosts: [], company: null, networks: [], logical: null };

function input(nHosts: number, racks = 1): BoardInput {
  return {
    racks: Array.from({ length: racks }, (_, i) => ({ id: `R${i + 1}`, label: `R${i + 1}` })),
    switches: [{ id: 'sw-1', label: 'sw-1', ports: 16, mtus: [1500], vlanSummary: ['access 1'] }],
    hosts: Array.from({ length: nHosts }, (_, i) => ({
      id: `srv-${i}`, label: `esx-${String(i + 1).padStart(2, '0')}`, rackId: `R${(i % racks) + 1}`, nicTotal: 2, esx: false,
      links: i % 2 ? [] : [{ switchId: 'sw-1', nic: 'vmnic0', up: true }],
    })),
    company: { switchId: 'sw-1', port: 15 },
    networks: [],
    logical: null,
  };
}

describe('sketch', () => {
  it('is deterministic per seed', () => {
    const a = sketchRect(0, 0, 100, 50, hashSeed('x'));
    const b = sketchRect(0, 0, 100, 50, hashSeed('x'));
    expect(a).toEqual(b);
    expect(sketchRect(0, 0, 100, 50, hashSeed('y'))).not.toEqual(a);
  });
  it('jitter stays small', () => {
    for (const side of sketchRect(0, 0, 200, 0, 7)) for (const p of side) expect(Math.abs(p.y)).toBeLessThanOrEqual(1.6);
  });
  it('dashes and simplifies', () => {
    expect(dashPolyline([{ x: 0, y: 0 }, { x: 100, y: 0 }], 10, 10).length).toBe(5);
    const line = Array.from({ length: 50 }, (_, i) => ({ x: i, y: 0 }));
    expect(simplifyRdp(line)).toEqual([{ x: 0, y: 0 }, { x: 49, y: 0 }]);
    expect(distToPolyline({ x: 5, y: 3 }, line)).toBeCloseTo(3);
  });
});

describe('hld layout', () => {
  it('empty room = one dashed "?" box', () => {
    const l = layoutBoard(EMPTY, 'fyzicky');
    expect(l.empty).toBe(true);
    expect(l.nodes[0]!.dashed).toBe(true);
  });
  it('keeps the auto diagram out of the notes strip', () => {
    for (const page of ['fyzicky', 'sit', 'logicky'] as const)
      for (const n of layoutBoard(input(12, 3), page).nodes) expect(n.x + n.w).toBeLessThanOrEqual(NOTES_X);
  });
  it('collapses big racks into a group', () => {
    const l = layoutBoard(input(MAX_HOSTS_PER_RACK + 2), 'fyzicky');
    expect(l.nodes.filter((n) => n.kind === 'group')).toHaveLength(1);
    expect(l.nodes.filter((n) => n.kind === 'host')).toHaveLength(0);
  });
  it('draws uplink and host edges, stable layout', () => {
    const l = layoutBoard(input(3), 'fyzicky');
    expect(l.edges.some((e) => e.id === 'uplink')).toBe(true);
    expect(l.edges.filter((e) => e.id.startsWith('e:'))).toHaveLength(2);
    expect(layoutKey(layoutBoard(input(3), 'fyzicky'))).toBe(layoutKey(l));
  });
  it('logical page undecided = dashed', () => {
    const l = layoutBoard(EMPTY, 'logicky');
    expect(l.nodes.every((n) => n.dashed)).toBe(true);
  });
  it('text alternative lists hosts', () => {
    const d = describeBoard(input(2), 'fyzicky').join('\n');
    expect(d).toContain('esx-01');
    expect(d).toContain('sw-1');
  });
});

describe('notes', () => {
  it('undo / redo / clear', () => {
    const n = new BoardNotes();
    expect(n.addStroke('fyzicky', 'red', 1, [{ x: 1, y: 1 }, { x: 50, y: 50 }]).ok).toBe(true);
    expect(n.addText('fyzicky', 10, 10, 'green', ' ahoj ').ok).toBe(true);
    expect(n.page('fyzicky').texts[0]!.text).toBe('ahoj');
    expect(n.clearPage('fyzicky')).toBe(2);
    expect(n.page('fyzicky').strokes).toHaveLength(0);
    n.undo();
    expect(n.page('fyzicky').strokes).toHaveLength(1);
    n.redo();
    expect(n.page('fyzicky').texts).toHaveLength(0);
  });
  it('eraser removes whole strokes', () => {
    const n = new BoardNotes();
    n.addStroke('sit', 'red', 0, [{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    expect(n.eraseAt('sit', { x: 50, y: 4 }, 6)).toBe(1);
    expect(n.eraseAt('sit', { x: 50, y: 4 }, 6)).toBe(0);
  });
  it('limits', () => {
    const n = new BoardNotes();
    expect(n.addText('sit', 0, 0, 'red', 'x'.repeat(LIMITS.textChars + 1))).toEqual({ ok: false, reason: 'too-long' });
  });
  it('round-trips serialisation and tolerates garbage', () => {
    const n = new BoardNotes();
    n.addStroke('logicky', 'orange', 2, [{ x: 10.4, y: 10 }, { x: 30, y: 80 }, { x: 90, y: 20 }]);
    n.addText('logicky', 5, 6, 'red', 'koupit 4. host?');
    const back = parseNotes(serializeNotes(n.notes));
    expect(back.logicky.strokes[0]!.points).toEqual(n.page('logicky').strokes[0]!.points);
    expect(back.logicky.texts[0]!.text).toBe('koupit 4. host?');
    expect(parseNotes('{bad')).toEqual(emptyNotes());
    expect(parseNotes('{"v":1,"pages":{"sit":{"strokes":[{"c":"blue","w":1,"p":[1,2]}]}}}').sit.strokes).toHaveLength(0);
  });
  it('storage failures never throw', () => {
    const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('quota'); } };
    expect(loadNotes(broken, 'a')).toEqual(emptyNotes());
    expect(saveNotes(broken, 'a', emptyNotes())).toEqual({ ok: false, reason: 'storage' });
    const mem = new Map<string, string>();
    const ok = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    const n = new BoardNotes();
    n.addText('sit', 1, 1, 'red', 'x');
    expect(saveNotes(ok, 'a', n.notes).ok).toBe(true);
    expect(loadNotes(ok, 'a').sit.texts).toHaveLength(1);
  });
});
