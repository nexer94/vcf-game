/**
 * Verified Broadcom Compatibility Guide (BCG) data – vSAN ESA ReadyNodes with Supported Release
 * "ESXi 9.1 (vSAN 9.1)" for Dell, HPE, Lenovo, Cisco and Supermicro (spec 15 §0 [H9][BCG]).
 *
 * Single source: docs/spec/data/bcg-vsan-esa-readynodes-esxi91.json (refreshed by tools/bcg/fetch-readynodes.sh).
 * The JSON is imported as is – nothing is copied or re-typed by hand. `parseBcgDataset` checks the shape at
 * runtime so a refreshed dataset with a changed schema fails loudly (tests) instead of silently.
 *
 * Pure data module: no DOM, no PixiJS.
 */
import raw from '../../../docs/spec/data/bcg-vsan-esa-readynodes-esxi91.json';

/** One ReadyNode record as stored by tools/bcg/build_dataset.py (field meaning: spec 15 §0 "Interpretace polí"). */
export interface BcgReadyNodeRecord {
  readonly productId: number;
  readonly vendor: string;
  readonly model: string;
  readonly cpuGeneration: string;
  readonly supportedReleases: readonly string[];
  readonly bcgUrl: string;
  readonly profiles: readonly string[];
  readonly maxCoresPerSocket: number;
  readonly maxSockets: number;
  readonly maxMemoryGB: number;
  readonly esaDrives: readonly string[];
  readonly cyberRecoveryDrives: readonly string[];
  readonly maxDrives: number;
  readonly nics: readonly string[];
  readonly bootDevice: string;
  readonly pcieSwitch: string;
  readonly notes: string;
}

export interface BcgDatasetMeta {
  readonly source: string;
  readonly release: string;
  readonly fetchedAt: string;
  readonly totalReadyNodesAllVendors: number;
  readonly vendors: Readonly<Record<string, number>>;
}

export interface BcgDataset {
  readonly meta: BcgDatasetMeta;
  readonly readyNodes: readonly BcgReadyNodeRecord[];
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);

/** Runtime shape check of the dataset (throws with the first offending record). */
export function parseBcgDataset(data: unknown): BcgDataset {
  const d = data as { meta?: Record<string, unknown>; readyNodes?: unknown };
  if (!d || typeof d !== 'object' || !d.meta || !Array.isArray(d.readyNodes)) throw new Error('BCG dataset: missing meta / readyNodes');
  const m = d.meta;
  if (!isStr(m['source']) || !isStr(m['release']) || !isStr(m['fetchedAt']) || !isNum(m['totalReadyNodesAllVendors']))
    throw new Error('BCG dataset: invalid meta');
  for (const r of d.readyNodes as Record<string, unknown>[]) {
    const ok =
      isNum(r['productId']) && isStr(r['vendor']) && isStr(r['model']) && isStr(r['cpuGeneration']) &&
      isStrArr(r['supportedReleases']) && isStr(r['bcgUrl']) && isStrArr(r['profiles']) &&
      isNum(r['maxCoresPerSocket']) && isNum(r['maxSockets']) && isNum(r['maxMemoryGB']) &&
      isStrArr(r['esaDrives']) && isStrArr(r['cyberRecoveryDrives']) && isNum(r['maxDrives']) &&
      isStrArr(r['nics']) && isStr(r['bootDevice']) && isStr(r['pcieSwitch']) && isStr(r['notes']);
    if (!ok) throw new Error(`BCG dataset: invalid ReadyNode record ${String(r['productId'])}`);
  }
  return data as BcgDataset;
}

/** The repository dataset (spec 15 [H9]). */
export const BCG_DATASET: BcgDataset = parseBcgDataset(raw);
