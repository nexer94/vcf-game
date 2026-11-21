/**
 * THE ONE adapter of the "Hotové scénáře" UI to the engine (like sessionPort.ts for the Sandbox).
 *
 * Preferred backend: engine-dev's `game/src/modes/scenarios` – `listScenarios()` + `new ScenarioSession(presetId)`,
 * whose snapshot is the normal Sandbox snapshot (room / physical / site) plus read-only
 * `scenario.{meta, inventory, placement, totals, utilisation, issues}`. The module is looked up with
 * `import.meta.glob`, so this file compiles before (and after) it lands.
 *
 * Any part of `snapshot.scenario` with an unexpected shape is recomputed with the same model functions
 * (model/deployedInventory.ts). Room traffic = the scenario's deployed flows (model flows, illustrative volumes);
 * without them an ILLUSTRATIVE animation is shown (badge "ilustrativní").
 *
 * Nothing here decides a VCF rule.
 */
import { loadHardwareCatalog, type HardwareCatalog } from '../../model/hardwareCatalog';
import {
  type ClusterUtilisation,
  type FleetInventory,
  type FleetTotals,
  type HostCapacity,
  type PlacementResult,
  type ScenarioPreset,
  hostCapacityFromConfig,
  presetById,
  SCENARIO_PRESETS,
} from '../../model/deployedInventory';
import type { ValidationIssue } from '../../model/validation';
import { RoomDemoTraffic } from '../../render/room/roomDemo';
import type { TrafficSource } from '../../render/traffic/trafficModel';
import type { TrafficType } from '../../render/traffic/trafficTypes';
import { roomStateFromSnapshot } from '../sandbox/sessionMapper';
import type { RoomState } from '../sandbox/sessionPort';
import { linkTrafficOf, bmcTransfersOf, StaticTrafficSource, trafficSourceOf } from '../sandbox/roomSync';
import { layoutFromSiteView, presetLayout, type SiteLayoutView } from '../sandbox/siteLayout';
import { layoutForPreset, scenarioModel, type ScenarioModelView, type ScenarioOverrides } from './scenarioData';

export type ScenarioOrigin = 'engine';

export interface ScenarioTraffic {
  readonly source: TrafficSource;
  readonly bmc: readonly string[];
  /** true = animation only (no model flows) – shown with the "ilustrativní" badge. */
  readonly illustrative: boolean;
}

export interface ScenarioSource {
  readonly origin: ScenarioOrigin;
  readonly model: ScenarioModelView;
  readonly layout: SiteLayoutView;
  /** Scenario notes (engine meta: Czech text + kind); undefined = the preset's own notes. */
  readonly notes?: readonly { readonly text: string; readonly kind: 'game' | 'spec' }[];
  roomState(): RoomState;
  roomOfRack(rackId: string): string;
  hostOfDevice(deviceId: string): string | undefined;
  deviceOfHost(hostId: string): string | undefined;
  rackOfHost(hostId: string): string | undefined;
  traffic(): ScenarioTraffic;
  /** Attach to the shared game clock (engine session only); returns cleanup. */
  attach(engine: { attach(system: never): () => void }): () => void;
}

/** Ids of the presets in menu order (engine `listScenarios()` when present, else the model's preset list). */
export async function listScenarioIds(): Promise<readonly string[]> {
  const mod = await engineModule();
  try {
    const list = mod?.listScenarios?.();
    if (Array.isArray(list) && list.length) {
      const ids = list.map((x: unknown) => (typeof x === 'string' ? x : (x as { id?: unknown })?.id)).filter((x): x is string => typeof x === 'string' && !!presetById(x));
      if (ids.length) return ids;
    }
  } catch {
    /* fall through */
  }
  return SCENARIO_PRESETS.map((p) => p.id);
}

// ---------------------------------------------------------------------------
// Engine module lookup (compiles whether or not modes/scenarios exists)
// ---------------------------------------------------------------------------

interface EngineScenarioModule {
  listScenarios?: () => unknown;
  ScenarioSession?: new (presetId: string) => EngineSessionLike;
}
interface EngineSessionLike {
  snapshot(): unknown;
  subscribe?(fn: (e: unknown) => void): () => void;
  attachTo?(engine: unknown): () => void;
}

const ENGINE_MODULES = import.meta.glob('../../modes/scenarios/index.ts');

async function engineModule(): Promise<EngineScenarioModule | null> {
  const load = ENGINE_MODULES['../../modes/scenarios/index.ts'];
  if (!load) return null;
  try {
    return (await load()) as EngineScenarioModule;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Host capacity (model hardware.ts over the starter configuration of the preset)
// ---------------------------------------------------------------------------

function capacityFn(catalog: HardwareCatalog | null) {
  return (hostId: string, configId: string): HostCapacity | undefined => {
    const s = catalog?.starterServers.find((x) => x.id === configId);
    if (!catalog || !s) return undefined;
    return hostCapacityFromConfig(catalog, hostId, s.config);
  };
}

// ---------------------------------------------------------------------------
// Load
// ---------------------------------------------------------------------------

export async function loadScenario(presetId: string): Promise<ScenarioSource> {
  const preset = presetById(presetId);
  if (!preset) throw new Error(`Neznámý scénář ${presetId}`);
  const catalog = await loadHardwareCatalog().catch(() => null);
  const mod = await engineModule();
  if (!mod?.ScenarioSession) throw new Error('Scénářová session enginu (modes/scenarios) není k dispozici.');
  return engineSource(preset, new mod.ScenarioSession(presetId), catalog);
}

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => !!x && typeof x === 'object';
const arr = (x: unknown): readonly unknown[] | undefined => (Array.isArray(x) ? x : undefined);

/** Maps the read-only `snapshot.scenario` onto model types; any part with an unexpected shape is recomputed. */
export function overridesOf(scen: unknown): ScenarioOverrides {
  if (!isRec(scen)) return {};
  const inv = isRec(scen['inventory']) && arr(scen['inventory']['vms']) ? (scen['inventory'] as unknown as FleetInventory) : undefined;
  const pl = scen['placement'];
  // Model PlacementResult, or the engine's ScenarioPlacementView ({ vms: [{ vmId, hostId, clusterId }], hosts, issues }).
  const placement: PlacementResult | undefined = !isRec(pl) || !arr(pl['hosts'])
    ? undefined
    : arr(pl['placements'])
      ? (pl as unknown as PlacementResult)
      : arr(pl['vms'])
        ? {
            placements: (pl['vms'] as readonly { vmId: string; hostId: string; clusterId: string }[]).map((x) => ({ vmId: x.vmId, hostId: x.hostId, clusterId: x.clusterId })),
            hosts: pl['hosts'] as PlacementResult['hosts'],
            issues: (arr(pl['issues']) ?? []) as readonly ValidationIssue[],
            scope: 'game-scope',
          }
        : undefined;
  // Model FleetTotals, or the engine's ScenarioTotalsView ({ model: FleetTotals, rows, … }).
  const t = scen['totals'];
  const totals = isRec(t) && arr(t['managementDomains']) ? (t as unknown as FleetTotals) : isRec(t) && isRec(t['model']) && arr(t['model']['managementDomains']) ? (t['model'] as unknown as FleetTotals) : undefined;
  const u = scen['utilisation'];
  const utilList = (arr(u) ?? (isRec(u) ? Object.values(u) : [])).filter((x): x is ClusterUtilisation => isRec(x) && typeof x['clusterId'] === 'string' && isRec(x['perVm']));
  const issues = arr(scen['issues']) as readonly ValidationIssue[] | undefined;
  return { ...(inv ? { inventory: inv } : {}), ...(placement ? { placement } : {}), ...(totals ? { totals } : {}), ...(utilList.length ? { utilisation: utilList } : {}), ...(issues ? { issues } : {}) };
}

interface PhysLike {
  readonly servers?: readonly { readonly id: string; readonly label?: string; readonly hostId?: string; readonly fqdn?: string; readonly mount?: { readonly rackId: string }; readonly mgmt?: { readonly hostname?: string; readonly fqdn?: string } }[];
}

/** host id -> server device id: explicit engine map, else same id, else hostname / fqdn / label starting with the host id. */
export function hostDeviceMap(snap: unknown, hostIds: readonly string[]): Map<string, string> {
  const out = new Map<string, string>();
  const s = isRec(snap) ? snap : {};
  const scen = isRec(s['scenario']) ? s['scenario'] : {};
  const explicit = scen['hostDevices'] ?? scen['hostServers'];
  if (isRec(explicit)) for (const [hId, dId] of Object.entries(explicit)) if (typeof dId === 'string') out.set(hId, dId);
  for (const x of arr(scen['hosts']) ?? []) {
    if (!isRec(x)) continue;
    const hId = x['hostId'] ?? x['id'];
    const dId = x['deviceId'] ?? x['serverId'];
    if (typeof hId === 'string' && typeof dId === 'string') out.set(hId, dId);
  }
  const servers = (isRec(s['physical']) ? (s['physical'] as PhysLike).servers : undefined) ?? [];
  for (const h of hostIds) {
    if (out.has(h)) continue;
    const m = servers.find((x) => x.id === h || x.hostId === h) ?? servers.find((x) => [x.mgmt?.hostname, x.mgmt?.fqdn, x.fqdn, x.label].some((n) => typeof n === 'string' && (n === h || n.startsWith(`${h}.`))));
    if (m) out.set(h, m.id);
  }
  return out;
}

function engineSource(preset: ScenarioPreset, session: EngineSessionLike, catalog: HardwareCatalog | null): ScenarioSource {
  // Engine snapshot = { sandbox: SandboxSnapshot, scenario: ScenarioView }; tolerate a flat Sandbox snapshot too.
  const parts = (): { sb: Rec; scen: Rec } => {
    const raw = session.snapshot();
    const r = isRec(raw) ? raw : {};
    const sb = isRec(r['sandbox']) ? r['sandbox'] : r;
    return { sb, scen: isRec(r['scenario']) ? r['scenario'] : {} };
  };
  const p0 = parts();
  if (!isRec(p0.sb['physical'])) throw new Error('scenario snapshot without physical layer');
  // Host capacity: engine placement view (hosts[].capacity), else the model over the catalog.
  const engineCaps = new Map<string, HostCapacity>();
  const pl = p0.scen['placement'];
  if (isRec(pl)) for (const x of arr(pl['hosts']) ?? []) if (isRec(x) && typeof x['hostId'] === 'string' && isRec(x['capacity'])) engineCaps.set(x['hostId'], x['capacity'] as unknown as HostCapacity);
  const modelCap = capacityFn(catalog);
  const base = scenarioModel(preset, (h, c) => engineCaps.get(h) ?? modelCap(h, c), overridesOf(p0.scen));
  const hostIds = base.hosts.map((h) => h.id);
  // Short host names = the engine's server ids in the room ("esx05"), unique across the fleet.
  const dev0 = hostDeviceMap({ ...p0.sb, scenario: p0.scen }, hostIds);
  const model: ScenarioModelView = {
    ...base,
    hosts: base.hosts.map((h) => {
      const d = dev0.get(h.id);
      return d && d.length <= 12 ? { ...h, label: d } : h;
    }),
  };
  const memo: { snap?: unknown; state?: RoomState; map?: Map<string, string> } = {};
  const sync = (): { state: RoomState; map: Map<string, string> } => {
    const snap = session.snapshot();
    if (memo.snap !== snap || !memo.state || !memo.map) {
      const { sb, scen } = parts();
      memo.snap = snap;
      // Room traffic: the scenario's deployed flows (model flows, illustrative volumes) when present.
      memo.state = roomStateFromSnapshot(isRec(scen['flows']) ? { ...sb, flows: scen['flows'] } : sb) ?? emptyRoom();
      memo.map = hostDeviceMap({ ...sb, scenario: scen }, hostIds);
    }
    return { state: memo.state, map: memo.map };
  };
  const site = isRec(p0.sb['site']) ? (p0.sb['site'] as unknown as Parameters<typeof layoutFromSiteView>[0]) : null;
  const layout = site ? layoutFromSiteView(site) : presetLayout(layoutForPreset(preset));
  const rackRooms = (): Record<string, string> => {
    const st = parts().sb as { site?: { layout?: { rackRooms?: Record<string, string> } } };
    return st.site?.layout?.rackRooms ?? {};
  };
  const meta = p0.scen['meta'];
  const notes = isRec(meta) && arr(meta['notes'])
    ? (meta['notes'] as readonly unknown[]).filter((n): n is { text: string; kind: 'game' | 'spec' } => isRec(n) && typeof n['text'] === 'string').map((n) => ({ text: n.text, kind: n.kind === 'game' ? ('game' as const) : ('spec' as const) }))
    : undefined;
  return {
    origin: 'engine',
    model,
    layout,
    ...(notes ? { notes } : {}),
    roomState: () => sync().state,
    roomOfRack: (id) => rackRooms()[id] ?? layout.rooms[0]!.id,
    hostOfDevice: (d) => [...sync().map].find(([, v]) => v === d)?.[0],
    deviceOfHost: (h) => sync().map.get(h),
    rackOfHost: (h) => {
      const { state, map } = sync();
      const d = map.get(h);
      return d ? state.devices.find((x) => x.id === d)?.mount?.rackId : undefined;
    },
    traffic: () => {
      const st = sync().state;
      const real = linkTrafficOf(st);
      if (real.size) return { source: st.linkVolumes ? trafficSourceOf(st) : new StaticTrafficSource(real), bmc: bmcTransfersOf(st), illustrative: false };
      return { source: illustrativeTraffic(st, new Set(sync().map.values())), bmc: bmcTransfersOf(st), illustrative: true };
    },
    attach: (engine) => (session.attachTo ? session.attachTo(engine) : () => undefined),
  };
}

function emptyRoom(): RoomState {
  return {
    revision: 0, source: 'session',
    catalog: { servers: [], switches: [], racks: [], drives: [], nics: [], datasetFetchedAt: '', datasetRelease: '' },
    racks: [], devices: [], cables: [], inventory: [], issues: [], traffic: [], objectives: [], objectivesHidden: true, spent: 0,
  };
}

/**
 * Illustrative dots over the host cables (first NIC port: management, second: vSAN). Loads are arbitrary animation
 * values (not VCF facts) and stay low (no overload drawn).
 */
function illustrativeTraffic(state: RoomState, hostDevices: ReadonlySet<string>): TrafficSource {
  const links: { id: string; type: TrafficType; mean: number; amp: number; periodS: number }[] = [];
  let i = 0;
  for (const c of state.cables) {
    if (c.bmc) continue;
    const srv = hostDevices.has(c.a.deviceId) ? c.a : hostDevices.has(c.b.deviceId) ? c.b : null;
    if (!srv || srv.port === 'bmc') continue;
    const type: TrafficType = srv.port === 0 ? 'management' : 'vsan';
    links.push({ id: c.id, type, mean: type === 'vsan' ? 2.5 : 0.8, amp: type === 'vsan' ? 1.2 : 0.3, periodS: 9 + (i++ % 7) });
  }
  return new RoomDemoTraffic(links);
}
