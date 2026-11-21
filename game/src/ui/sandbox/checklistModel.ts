/** Pure model of the Career checklist (UX 17.2) – no DOM, unit-tested. */
import type { ObjectiveView } from './sessionPort';

export interface ChecklistModel {
  readonly done: number;
  readonly total: number;
  readonly active?: ObjectiveView;
  /** Problem step (regressed) shown as active with an orange frame. */
  readonly problem: boolean;
  readonly doneInGroup: readonly ObjectiveView[];
  readonly olderDone: number;
  readonly future: readonly ObjectiveView[];
  readonly recommendation?: ObjectiveView;
  readonly otherGroups: readonly { readonly title: string; readonly steps: readonly ObjectiveView[] }[];
}

export const isDone = (o: ObjectiveView): boolean => o.status === 'done' || o.status === 'skipped';

/** Pure: ObjectiveView[] + engine next id -> what the checklist shows. */
export function checklistModel(items: readonly ObjectiveView[], nextId?: string): ChecklistModel {
  const counted = items.filter((o) => o.kind !== 'game-optional' && !o.bonus);
  const problem = counted.find((o) => o.status === 'problem');
  const active = problem ?? (nextId ? items.find((o) => o.id === nextId) : undefined) ?? counted.find((o) => !isDone(o) && o.kind !== 'doc-recommended');
  const group = active?.group;
  const inGroup = items.filter((o) => o.group === group);
  const doneAll = inGroup.filter((o) => isDone(o) && o.kind !== 'doc-recommended');
  const idx = active ? items.indexOf(active) : -1;
  const future = active ? items.filter((o, i) => i > idx && o.group === group && !isDone(o) && o.kind !== 'doc-recommended' && o.kind !== 'game-optional' && !o.bonus).slice(0, 2) : [];
  const recommendation = inGroup.find((o) => (o.kind === 'doc-recommended' || o.bonus) && !isDone(o));
  const groups: { title: string; steps: ObjectiveView[] }[] = [];
  for (const o of items) {
    if (!o.group || o.group === group || o.kind === 'game-optional') continue;
    let g = groups.find((x) => x.title === o.group);
    if (!g) groups.push((g = { title: o.group, steps: [] }));
    g.steps.push(o);
  }
  const groupIdx = (t: string): number => items.findIndex((o) => o.group === t);
  const activeGroupIdx = group ? groupIdx(group) : -1;
  return {
    done: counted.filter(isDone).length,
    total: counted.length,
    ...(active ? { active } : {}),
    problem: !!problem,
    doneInGroup: doneAll.slice(-3),
    olderDone: Math.max(0, doneAll.length - 3),
    future,
    ...(recommendation ? { recommendation } : {}),
    // Only groups after the active one stay as collapsed rows (finished groups are summarised in the counter).
    otherGroups: groups.filter((g) => groupIdx(g.title) > activeGroupIdx && g.steps.some((s) => !isDone(s))),
  };
}

