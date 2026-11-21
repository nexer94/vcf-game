import { describe, expect, it } from 'vitest';
import { computeZones, placePopover } from './layoutZones';
import { checklistModel } from './checklistModel';
import { resolveSources } from './sourceResolve';
import type { ObjectiveView } from './sessionPort';

describe('layout zones (UX 22)', () => {
  it('sizes zones for 1366×768 and 1920×1080', () => {
    const a = computeZones({ viewportW: 1366, viewportH: 768, checklist: 'open', rightPanel: true, shop: 'open' });
    expect(a).toMatchObject({ hudH: 48, checklistW: 264, shopH: 176 });
    expect(a.rightW).toBeGreaterThanOrEqual(320);
    expect(a.scene.h).toBe(768 - 48 - 176);
    const b = computeZones({ viewportW: 1920, viewportH: 1080, checklist: 'open', rightPanel: true, shop: 'open' });
    expect(b).toMatchObject({ checklistW: 288, rightW: 420, shopH: 212 });
    expect(computeZones({ viewportW: 1366, viewportH: 768, checklist: 'hidden', rightPanel: false, shop: 'collapsed' }).shopH).toBe(40);
  });

  it('auto-collapses the checklist on narrow windows', () => {
    expect(computeZones({ viewportW: 1100, viewportH: 700, checklist: 'open', rightPanel: false, shop: 'open' }).autoCollapseChecklist).toBe(true);
  });

  it('places a popover on a free side and clamps it into the viewport', () => {
    const vp = { w: 1366, h: 768 };
    const hud = { x: 0, y: 0, w: 1366, h: 48 };
    // anchor right under the HUD -> above would collide, goes below
    const p = placePopover({ x: 600, y: 60, w: 20, h: 20 }, { w: 300, h: 100 }, [hud], vp);
    expect(p.side).toBe('bottom');
    expect(p.y).toBeGreaterThanOrEqual(80);
    // near the right edge -> clamped inside
    const q = placePopover({ x: 1350, y: 400, w: 10, h: 10 }, { w: 300, h: 100 }, [], vp);
    expect(q.x + 300).toBeLessThanOrEqual(1366 - 8);
  });
});

const o = (id: string, group: string, status: ObjectiveView['status'], extra: Partial<ObjectiveView> = {}): ObjectiveView => ({ id, title: id, kind: 'doc-required', status, group, ...extra });

describe('checklist model (UX 17.2)', () => {
  const items = [
    o('a', 'G1', 'done'), o('b', 'G1', 'done'), o('c', 'G1', 'done'), o('d', 'G1', 'done'),
    o('e', 'G1', 'progress', { progress: { done: 2, total: 4 } }),
    o('rec', 'G1', 'todo', { kind: 'doc-recommended' }),
    o('f', 'G1', 'todo'), o('g', 'G1', 'todo'), o('h', 'G1', 'todo'),
    o('x', 'G2', 'todo'), o('y', 'G2', 'todo'),
  ];
  it('has exactly one active step, max 3 done, 2 future, other groups collapsed', () => {
    const m = checklistModel(items, 'e');
    expect(m.active?.id).toBe('e');
    expect(m.doneInGroup.map((x) => x.id)).toEqual(['b', 'c', 'd']);
    expect(m.olderDone).toBe(1);
    expect(m.future.map((x) => x.id)).toEqual(['f', 'g']);
    expect(m.recommendation?.id).toBe('rec');
    expect(m.otherGroups).toEqual([{ title: 'G2', steps: [items[9], items[10]] }]);
    expect(m.total).toBe(11); // like the engine: doc-recommended counts, bonus / game-optional do not
  });
  it('a regressed step becomes the active one', () => {
    const m = checklistModel([...items.slice(0, 3), o('d', 'G1', 'problem'), ...items.slice(4)], 'e');
    expect(m.active?.id).toBe('d');
    expect(m.problem).toBe(true);
  });
});

describe('Zdroj (UX 21)', () => {
  it('resolves spec refs to readable titles, never bracket ids', () => {
    const r = resolveSources({ specRef: '10-planning §3.3 [P19]' });
    expect(r.links[0]?.label).toMatch(/^Dokumentace: /);
    expect(r.links.every((l) => !/\[[A-Z]+\d+\]/.test(l.label))).toBe(true);
    expect(r.specLine).toBe('spec 10 §3.3');
  });
  it('puts an extra BCG link first and caps at 3', () => {
    const r = resolveSources({ extra: { label: 'Broadcom Compatibility Guide: X', url: 'https://compatibilityguide.broadcom.com/x' }, specRef: '06 §2.2, §6.1 [B6][B7]; 10 §3.3 [P19]' });
    expect(r.links[0]?.label).toBe('Broadcom Compatibility Guide: X');
    expect(r.links.length).toBeLessThanOrEqual(3);
  });
});
