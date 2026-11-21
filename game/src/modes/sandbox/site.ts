/**
 * Sites and fleet Design Blueprints in the Sandbox: the start choice "Vyber design blueprint" (06 §1, §2.1–2.5,
 * §7a), room roles (AZ / witness / second VCF Instance) and the site view of the snapshot.
 *
 * VCF facts and rules come ONLY from the model (model/sites.ts: DESIGN_BLUEPRINTS, LAYOUT_BLUEPRINTS,
 * chooseSiteLayout, checkInterAzLink, checkWitnessFaultDomain, checkSecondaryInstanceLocation, checkHostsPerAz,
 * minStretchedHosts; model/design.ts DESIGN_DECISIONS). Game rules of this file (reported as `kind: 'flow'`):
 *  - the layout must belong to the blueprint (model LAYOUT_BLUEPRINTS, 06 §7a game mapping),
 *  - the blueprint cannot change while a bring-up validation / deployment runs,
 *  - the blueprint's documented design choices are pre-selected only in the design phase and before a bring-up
 *    (after it the design is history, validateRedesign); choosing the same blueprint again keeps the player's choices.
 *
 * GAME values: room floor sizes (tiles) – illustrative, rackLayout.roomFloorSize.
 */
import {
  type AzRole,
  type AzSummary,
  type BlueprintDef,
  type BlueprintId,
  type DesignChoices,
  type DesignDecisionId,
  type HardwareCatalog,
  type SiteLayoutId,
  type SiteLinkKind,
  type SiteState,
  type ValidationIssue,
  AZ_ROLES,
  DESIGN_BLUEPRINTS,
  DESIGN_DECISIONS,
  LAYOUT_BLUEPRINTS,
  SITE_LAYOUTS,
  availabilityZones,
  checkHostsPerAz,
  checkInterAzLink,
  checkSecondaryInstanceLocation,
  checkWitnessFaultDomain,
  chooseSiteLayout,
  isSiteLayoutId,
  minStretchedHosts,
  roomOfRack,
  sitesOf,
} from '../../model';
import { type IssueGroups, groupIssues } from './design';
import { type RoomFloor, type RoomPlacementView, roomFloorSize, roomPlacementView } from './rackLayout';
import { type Tx, flow, invalid, no, ok } from './tx';
import type { CommandResult, SandboxCommand, SandboxState } from './types';

// ===========================================================================
// Blueprint -> design defaults
// ===========================================================================

export const isBlueprintId = (x: unknown): x is BlueprintId => typeof x === 'string' && Object.prototype.hasOwnProperty.call(DESIGN_BLUEPRINTS, x);

/**
 * Documented Day-0 design choices of the blueprint that exist as a decision + option of the design model
 * (DESIGN_DECISIONS). Anything else (paraphrased selections, per-region differences, Day 2) is not pre-selected.
 */
export function blueprintDesignChoices(blueprintId: BlueprintId): DesignChoices {
  const bp = DESIGN_BLUEPRINTS[blueprintId];
  const out: Partial<Record<DesignDecisionId, string>> = {};
  for (const [k, v] of Object.entries(bp.documentedChoices) as [DesignDecisionId, string | undefined][]) {
    const def = DESIGN_DECISIONS.find((d) => d.id === k);
    if (v !== undefined && def?.options.some((o) => o.id === v)) out[k] = v;
  }
  return out as DesignChoices;
}

// ===========================================================================
// Commands
// ===========================================================================

export type SiteCommand = Extract<SandboxCommand, { type: 'chooseBlueprint' }>;

export const isSiteCommand = (cmd: SandboxCommand): cmd is SiteCommand => cmd.type === 'chooseBlueprint';

export interface SiteApplyHooks {
  /** Applies design choices (prunes acks, re-derives params, prefills the wizard) – reducer.withDesign. */
  readonly applyDesign: (tx: Tx, choices: DesignChoices) => void;
  /** Writes the room without undo (a different layout = different rooms; history would restore the old layout). */
  readonly commitRoom: (tx: Tx, room: SandboxState['room']) => void;
}

const BUSY = ['validating', 'deploying'];

export function applySite(tx: Tx, cmd: SiteCommand, hooks: SiteApplyHooks): CommandResult {
  const s = tx.s;
  if (!isBlueprintId(cmd.blueprintId)) return no(flow('invalid-input', `Neznámý design blueprint ${String(cmd.blueprintId)}.`));
  if (!isSiteLayoutId(cmd.layoutId)) return no(flow('invalid-input', `Neznámé herní rozvržení ${String(cmd.layoutId)}.`));
  const mapping = LAYOUT_BLUEPRINTS[cmd.layoutId];
  if (mapping.blueprintId !== cmd.blueprintId)
    return no(flow('blueprint-layout-mismatch', `Rozvržení „${SITE_LAYOUTS[cmd.layoutId].label}“ nepatří k blueprintu ${DESIGN_BLUEPRINTS[cmd.blueprintId].title} (herní přiřazení ${mapping.specRef}).`));
  if (BUSY.includes(s.deployment.status)) return no(flow('task-in-progress', 'Během validace nebo nasazení nelze měnit blueprint.'));
  const curLayout = sitesOf(s.room.physical).layoutId;
  if (s.blueprintId === cmd.blueprintId && curLayout === cmd.layoutId) return no(flow('nothing-to-do', 'Tento blueprint a rozvržení už jsou vybrané.'));

  // Layout: model rule – a different layout only before any rack exists.
  if (curLayout !== cmd.layoutId) {
    const r = chooseSiteLayout(s.room.physical, cmd.layoutId);
    if (!r.ok) return no(invalid([r.error]));
    hooks.commitRoom(tx, { ...tx.s.room, physical: r.state });
  }

  const sameBlueprint = s.blueprintId === cmd.blueprintId;
  tx.s = { ...tx.s, blueprintId: cmd.blueprintId };
  // Design defaults: only a new blueprint, only in the design phase and before any bring-up.
  if (!sameBlueprint && tx.s.phase === 'design' && !tx.s.deployedChoices) {
    hooks.applyDesign(tx, blueprintDesignChoices(cmd.blueprintId));
  } else if (!sameBlueprint) {
    tx.log({ kind: 'system', ok: true, message: 'Návrhová rozhodnutí blueprintu se předvyplňují jen ve fázi Návrh před nasazením – tvůj návrh zůstal beze změny.' });
  }
  tx.invalidateValidation();
  return ok();
}

export function describeSite(cmd: SiteCommand): string {
  return `Blueprint: ${isBlueprintId(cmd.blueprintId) ? DESIGN_BLUEPRINTS[cmd.blueprintId].title : String(cmd.blueprintId)} (${isSiteLayoutId(cmd.layoutId) ? SITE_LAYOUTS[cmd.layoutId].label : String(cmd.layoutId)})`;
}

// ===========================================================================
// Snapshot view
// ===========================================================================

export interface SiteRoomView {
  readonly id: string;
  readonly label: string;
  readonly siteId: string;
  readonly buildingId: string;
  /** [GAME] rack capacity (model). */
  readonly rackSlots: number;
  /** [GAME] floor size in tiles (illustrative). */
  readonly floor: RoomFloor;
  readonly role: AzRole | null;
  /** Racks assigned to the room (placed or still in the inventory). */
  readonly rackIds: readonly string[];
  /** Servers mounted in racks of the room. */
  readonly hostIds: readonly string[];
  /**
   * [GAME] rack placement rules of the room (rackLayout.ts / model roomLayout.ts): floor grid with door + fixtures,
   * standing racks with facing, free slots, ghost hints per rack model and cold / hot aisle tiles.
   */
  readonly placement: RoomPlacementView;
  readonly gameDefault: true;
}

export interface SiteLinkView {
  readonly id: string;
  readonly a: string;
  readonly b: string;
  readonly kind: SiteLinkKind;
  /** [GAME] illustrative values. */
  readonly rttMs: number;
  readonly bandwidthGbps: number;
  readonly gameDefault: true;
}

export interface SiteLayoutSnapshot {
  readonly id: SiteLayoutId;
  readonly label: string;
  readonly description: string;
  readonly rooms: readonly SiteRoomView[];
  readonly buildings: readonly { readonly id: string; readonly siteId: string; readonly label: string; readonly gameDefault: true }[];
  readonly sites: readonly { readonly id: string; readonly label: string; readonly gameDefault: true }[];
  readonly links: readonly SiteLinkView[];
  /** Rack id -> room id (model roomOfRack). */
  readonly rackRooms: Readonly<Record<string, string>>;
  /** Layout -> blueprint mapping (06 §7a). */
  readonly blueprintMapping: { readonly blueprintId: BlueprintId; readonly specRef: string };
  readonly gameDefault: true;
}

export interface BlueprintView extends BlueprintDef {
  /** Documented choices that exist in the design model and are pre-selected when the blueprint is chosen. */
  readonly designDefaults: DesignChoices;
  /** Total ESX hosts of the Minimum Requirements (sum of hostGroups, 06 §6.1). */
  readonly totalHosts: number;
}

/** Current choice differs from the blueprint's documented choice (information only; issues come from validateDesign). */
export interface BlueprintDeviation {
  readonly decision: DesignDecisionId;
  readonly blueprintOption: string;
  readonly currentOption?: string;
}

/**
 * Model site checks. Each list is ALWAYS computed (selectors of the objectives tracker read them); `stretched` /
 * `secondaryInstance` say which of them apply to the current design (fleet deployment model / stretched cluster
 * model of the design, else the chosen blueprint) – only those go into `SiteView.issues`.
 */
export interface SiteChecksView {
  readonly stretched: boolean;
  readonly secondaryInstance: boolean;
  readonly interAz: readonly ValidationIssue[];
  readonly witness: readonly ValidationIssue[];
  readonly secondary: readonly ValidationIssue[];
  /** Empty until hosts exist and both AZ1 and AZ2 have a room (as hardwareDesign.siteAvailability). */
  readonly hostsPerAz: readonly ValidationIssue[];
}

export interface SiteView {
  readonly blueprint?: BlueprintView;
  readonly deviations: readonly BlueprintDeviation[];
  readonly layout: SiteLayoutSnapshot;
  /** AZ / fault-domain summary with hosts per role (model availabilityZones). */
  readonly azs: readonly AzSummary[];
  readonly interAz: { readonly status: ReturnType<typeof checkInterAzLink>['status']; readonly rttMs?: number; readonly bandwidthGbps?: number };
  readonly checks: SiteChecksView;
  /** All applicable site check issues grouped by severity / scope. */
  readonly issues: IssueGroups;
}

const STRETCHED_FLEETS: readonly string[] = ['site-high-availability', 'fault-domains-and-dr'];
const SECONDARY_FLEETS: readonly string[] = ['disaster-recovery', 'fault-domains-and-dr'];

export function blueprintView(id: BlueprintId): BlueprintView {
  const bp = DESIGN_BLUEPRINTS[id];
  return { ...bp, designDefaults: blueprintDesignChoices(id), totalHosts: bp.hostGroups.reduce((a, g) => a + g.esxHosts, 0) };
}

function layoutSnapshot(room: SandboxState['room'], catalog: HardwareCatalog, sites: SiteState): SiteLayoutSnapshot {
  const p = room.physical;
  const l = SITE_LAYOUTS[sites.layoutId];
  const rackRooms: Record<string, string> = {};
  for (const r of p.racks) rackRooms[r.id] = roomOfRack(p, r.id) ?? r.roomId;
  return {
    id: sites.layoutId,
    label: l.label,
    description: l.description,
    rooms: sites.rooms.map((r): SiteRoomView => {
      const rackIds = p.racks.filter((x) => rackRooms[x.id] === r.id).map((x) => x.id);
      return {
        id: r.id,
        label: r.label,
        siteId: r.siteId,
        buildingId: r.buildingId,
        rackSlots: r.rackSlots,
        floor: roomFloorSize(r.rackSlots),
        role: sites.azAssignment[r.id] ?? null,
        rackIds,
        hostIds: p.servers.filter((x) => x.mount && rackIds.includes(x.mount.rackId)).map((x) => x.id),
        placement: roomPlacementView(room, catalog, r.id)!,
        gameDefault: true,
      };
    }),
    buildings: sites.buildings,
    sites: sites.sites,
    links: sites.links.map((k) => ({ id: k.id, a: k.a, b: k.b, kind: k.kind, rttMs: k.rttMs, bandwidthGbps: k.bandwidthGbps, gameDefault: true })),
    rackRooms,
    blueprintMapping: l.blueprint,
    gameDefault: true,
  };
}

export function siteView(s: SandboxState, catalog: HardwareCatalog): SiteView {
  const p = s.room.physical;
  const sites = sitesOf(p);
  const bp = s.blueprintId ? blueprintView(s.blueprintId) : undefined;
  const c = s.choices;
  const fleet = c['fleet-deployment-model'] ?? bp?.fleetModel;
  const stretched = (fleet !== undefined && STRETCHED_FLEETS.includes(fleet)) || c['mgmt-cluster-model'] === 'stretched' || c['wld-cluster-model'] === 'stretched';
  const secondaryInstance = fleet !== undefined && SECONDARY_FLEETS.includes(fleet);
  const azs = availabilityZones(p);
  const inter = checkInterAzLink(sites);
  const interAz = inter.issues;
  const witness = checkWitnessFaultDomain(sites);
  const secondary = checkSecondaryInstanceLocation(sites);
  // Hosts per AZ once hosts exist and both AZs are assigned (as in hardwareDesign.siteAvailability): the management
  // cluster is stretched on Day 2 (06 §2.3 [B11]) -> warnings.
  const both = azs.some((a) => a.role === 'az1') && azs.some((a) => a.role === 'az2');
  const hostsPerAz = both && p.servers.length > 0 ? checkHostsPerAz(azs, minStretchedHosts(c['deployment-model'], c['principal-storage']), 'warning') : [];
  const deviations: BlueprintDeviation[] = bp
    ? (Object.entries(bp.designDefaults) as [DesignDecisionId, string][])
        .filter(([k, v]) => c[k] !== v)
        .map(([k, v]) => ({ decision: k, blueprintOption: v, ...(c[k] !== undefined ? { currentOption: c[k] as string } : {}) }))
    : [];
  return {
    ...(bp ? { blueprint: bp } : {}),
    deviations,
    layout: layoutSnapshot(s.room, catalog, sites),
    azs,
    interAz: { status: inter.status, ...(inter.rttMs !== undefined ? { rttMs: inter.rttMs } : {}), ...(inter.bandwidthGbps !== undefined ? { bandwidthGbps: inter.bandwidthGbps } : {}) },
    checks: { stretched, secondaryInstance, interAz, witness, secondary, hostsPerAz },
    issues: groupIssues([...(stretched ? [...interAz, ...witness, ...hostsPerAz] : []), ...(secondaryInstance ? secondary : [])]),
  };
}

export const isAzRole = (x: unknown): x is AzRole => typeof x === 'string' && (AZ_ROLES as readonly string[]).includes(x);
