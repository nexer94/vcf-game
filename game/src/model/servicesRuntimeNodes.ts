/**
 * VCF services runtime (management services) node counts per instance role and sizing profile.
 * Single source of truth for bringup.ts (FIRST/ADDITIONAL_INSTANCE_SIZING) and deployedInventory.ts.
 *
 * Source: docs/spec/40-workload-domains.md §6.4 ("Počet worker uzlů – rozpor workbook × stránka").
 * The page [W6] (VCF Fleet Sizing Models) and the 9.1.1 workbook [WB SRT C332–C339] disagree on some worker counts;
 * the game uses the column that matches the documented CPU/RAM totals [W6] (40 §6.4 decision, open question 40 §8 q2).
 *
 * Pure TypeScript: no DOM, no PixiJS.
 */
import type { SizingProfile } from './bringup';

export type InstanceRole = 'first' | 'additional';

export interface WorkerNodeCount {
  /** Value on the sizing page [W6]. */
  readonly page: number;
  /** Value in the 9.1.1 workbook [WB SRT C332–C339]. */
  readonly workbook: number;
  /** Value used by the game = the one that fits the documented totals (40 §6.4). */
  readonly used: number;
}

/** Worker node counts (40 §6.4 table). `used` = column matching the documented CPU/RAM totals [W6]. */
export const WORKER_NODE_COUNTS: Readonly<Record<InstanceRole, Readonly<Record<SizingProfile, WorkerNodeCount>>>> = {
  first: {
    simple: { page: 2, workbook: 2, used: 2 },
    'ha-small': { page: 3, workbook: 3, used: 3 },
    'ha-medium': { page: 3, workbook: 3, used: 3 },
    'ha-large': { page: 4, workbook: 3, used: 4 },
  },
  additional: {
    simple: { page: 2, workbook: 1, used: 1 },
    'ha-small': { page: 2, workbook: 3, used: 2 },
    'ha-medium': { page: 2, workbook: 3, used: 2 },
    'ha-large': { page: 2, workbook: 3, used: 2 },
  },
};

/** Control plane nodes: Simple 1, HA 3 (40 §6.4, WB SRT C314–C315 = [W6]); same for first and additional instance. */
export const SERVICES_RUNTIME_CP_NODES: Readonly<Record<SizingProfile, number>> = {
  simple: 1,
  'ha-small': 3,
  'ha-medium': 3,
  'ha-large': 3,
};

/** Management services node counts for bringup sizing (40 §6.4). */
export function managementServicesNodes(
  role: InstanceRole,
  profile: SizingProfile,
): { readonly controlPlaneNodes: number; readonly workerNodes: number } {
  return { controlPlaneNodes: SERVICES_RUNTIME_CP_NODES[profile], workerNodes: WORKER_NODE_COUNTS[role][profile].used };
}
