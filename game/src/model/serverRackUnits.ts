/**
 * Server rack height (U) from vendor spec sheets / datasheets (CLAUDE.md, user decision 2026-11-22: for the rack
 * height of a server the official vendor spec sheet is an allowed source – ONLY this value, always with a link).
 *
 * Data: docs/spec/data/server-rack-units.json (maintained by doc-researcher):
 *   { "models": [ { "vendor", "model", "bcgProductIds": [..], "rackUnits", "url" } ] }
 *
 * The file is optional: while it does not exist (or a model is not listed) the game uses
 * SERVER_RACK_UNITS_GAME_DEFAULT (2U, [SIMPL], `rackUnitsGameDefault: true`). The file is picked up with Vite's
 * `import.meta.glob` so a missing file is not a build error.
 *
 * Pure data module: no DOM, no PixiJS.
 */
/// <reference types="vite/types/import-meta.d.ts" />

/** One model entry of server-rack-units.json. */
export interface ServerRackUnitsEntry {
  readonly vendor: string;
  readonly model: string;
  /** BCG ReadyNode product ids the height applies to (ServerModel.productId). */
  readonly bcgProductIds: readonly number[];
  /** Height in rack units (positive integer). */
  readonly rackUnits: number;
  /** Vendor spec sheet / datasheet the value comes from. */
  readonly url: string;
}

export interface ServerRackUnitsData {
  readonly models: readonly ServerRackUnitsEntry[];
}

/** Lookup: BCG productId -> verified height + source. */
export type RackUnitsLookup = ReadonlyMap<number, { readonly rackUnits: number; readonly url: string }>;

const isPosInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;
const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/**
 * Validates the raw JSON. Invalid entries are skipped and reported in `problems` (a refreshed file with a changed
 * schema must not silently change heights; tests assert `problems` is empty).
 */
export function parseServerRackUnits(raw: unknown): { readonly data: ServerRackUnitsData; readonly problems: readonly string[] } {
  const problems: string[] = [];
  const models: ServerRackUnitsEntry[] = [];
  const list = typeof raw === 'object' && raw !== null ? (raw as { models?: unknown }).models : undefined;
  if (!Array.isArray(list)) return { data: { models: [] }, problems: ['server-rack-units: "models" must be a list'] };
  list.forEach((m: unknown, i) => {
    const r = (m ?? {}) as Record<string, unknown>;
    const ids = r['bcgProductIds'];
    const ok =
      isStr(r['vendor']) && isStr(r['model']) && Array.isArray(ids) && ids.length > 0 && ids.every(isPosInt) && isPosInt(r['rackUnits']) &&
      isStr(r['url']) && /^https:\/\//.test(r['url'] as string);
    if (!ok) problems.push(`server-rack-units: models[${i}] invalid (vendor, model, bcgProductIds[], rackUnits, https url)`);
    else models.push({ vendor: r['vendor'] as string, model: r['model'] as string, bcgProductIds: ids as number[], rackUnits: r['rackUnits'] as number, url: r['url'] as string });
  });
  return { data: { models }, problems };
}

export function rackUnitsLookup(data: ServerRackUnitsData | undefined): RackUnitsLookup {
  const m = new Map<number, { rackUnits: number; url: string }>();
  for (const e of data?.models ?? []) for (const id of e.bcgProductIds) m.set(id, { rackUnits: e.rackUnits, url: e.url });
  return m;
}

// Optional file: an empty object when it does not exist (Vite glob, eager).
const files = import.meta.glob('../../../docs/spec/data/server-rack-units.json', { eager: true, import: 'default' });
const rawFile: unknown = Object.values(files)[0];

/** Parsed repository data (undefined = file not present yet). */
export const SERVER_RACK_UNITS = rawFile === undefined ? undefined : parseServerRackUnits(rawFile);
