/**
 * ScenarioSession – the "Hotové scénáře" mode (CLAUDE.md "Herní režimy" 3): a fully deployed environment the player
 * only explores. Same model + engine + Sandbox reducer as the other modes; this layer adds:
 *  - the prepared room (build.ts, replayed Sandbox commands) and the deployed Fleet of the preset (model
 *    buildPresetFleet, 40 §6.5),
 *  - read-only views (view.ts): inventory, placement, totals, utilisation, issues, flows,
 *  - read-only enforcement (game rule): every Sandbox command is rejected with flow 'read-only-scenario'; only the
 *    view commands 'inspect' (selection) and 'camera' (focused room / rack) are accepted. `readOnly: false` opens
 *    the environment as a lab (commands go to the Sandbox reducer; the scenario views keep describing the preset).
 *
 * Pure TypeScript: no DOM, no PixiJS.
 */
import { type GameEngine, type Listener, type Unsubscribe, EventBus, deepFreeze } from '../../engine';
import {
  type Fleet,
  type FleetInventory,
  type FleetTotals,
  type PlacementResult,
  type PresetBuild,
  type ScenarioPreset,
  type ValidationIssue,
  DESIGN_BLUEPRINTS,
  SCENARIO_PRESETS,
  buildPresetFleet,
  inventoryForFleet,
  placeVms,
  presetById,
  totalsForFleet,
} from '../../model';
import type { CommandResult, SandboxCommand, SandboxEvent, SandboxRejection, SandboxSnapshot } from '../sandbox';
import type { SandboxSession } from '../sandbox';
import { type NicAdjustment, type ScenarioRack, buildScenarioRoom } from './build';

/** Game notes for NIC swaps (grouped by card). */
function nicNotes(adj: readonly NicAdjustment[]): string[] {
  const by = new Map<string, NicAdjustment[]>();
  for (const a of adj) by.set(`${a.removed.join('+')}>${a.added}`, [...(by.get(`${a.removed.join('+')}>${a.added}`) ?? []), a]);
  return [...by.values()].map((g) => {
    const a = g[0] as NicAdjustment;
    return `Hosty ${g.map((x) => x.hostId).join(', ')}: NIC ${a.removed.join(' + ') || '(žádná)'} vyměněna za certifikovanou ${a.added} (${a.speedGbE}G), aby šly zapojit do ToR stejného modelu jako ostatní racky (herní volba; CPU / RAM / disky beze změny).`;
  });
}
import {
  type ClusterUtilisationView,
  type ScenarioFlowsView,
  type ScenarioInventoryView,
  type ScenarioMeta,
  type ScenarioPlacementView,
  type ScenarioTotalsView,
  hostCapacities,
  inventoryView,
  placementView,
  presetSummary,
  scenarioFlows,
  scenarioMeta,
  totalsView,
  utilisationViews,
} from './view';

// ===========================================================================
// Menu list
// ===========================================================================

export interface ScenarioListItem {
  readonly id: string;
  /** 1-based menu order (CLAUDE.md: 1. nejmenší … 5. více instancí; variants follow their group). */
  readonly order: number;
  /** Scenario group (40 §6.5 scénář 1–5). */
  readonly scenario: number;
  readonly title: string;
  readonly summary: string;
  readonly blueprintTitle: string | null;
  readonly specRef: string;
}

export function listScenarios(): ScenarioListItem[] {
  return SCENARIO_PRESETS.map((p, i) => ({
    id: p.id,
    order: i + 1,
    scenario: p.scenario,
    title: p.title,
    summary: presetSummary(p),
    blueprintTitle: p.blueprintId ? DESIGN_BLUEPRINTS[p.blueprintId].title : null,
    specRef: p.specRef,
  }));
}


// ===========================================================================
// Commands, snapshot, events
// ===========================================================================

export type InspectTarget =
  | { readonly kind: 'vm'; readonly id: string }
  | { readonly kind: 'host'; readonly id: string }
  | { readonly kind: 'server'; readonly id: string }
  | { readonly kind: 'cluster'; readonly id: string }
  | { readonly kind: 'domain'; readonly id: string }
  | { readonly kind: 'instance'; readonly id: string }
  | { readonly kind: 'rack'; readonly id: string }
  | { readonly kind: 'room'; readonly id: string };

/** View-only commands of the mode (accepted in read-only mode). */
export type ScenarioViewCommand =
  /** Select an object (null clears). Unknown ids are rejected as flow 'invalid-input'. */
  | { readonly type: 'inspect'; readonly target: InspectTarget | null }
  /** Focus of the room view: which room (multi-room layouts) and optionally which rack. */
  | { readonly type: 'camera'; readonly roomId: string; readonly rackId?: string };

export type ScenarioCommand = SandboxCommand | ScenarioViewCommand;

export interface ScenarioFocus {
  readonly roomId: string;
  readonly rackId?: string;
}

export interface ScenarioView {
  readonly presetId: string;
  readonly readOnly: boolean;
  readonly meta: ScenarioMeta;
  /** Deployed fleet (model buildPresetFleet). */
  readonly fleet: Fleet;
  readonly inventory: ScenarioInventoryView;
  readonly placement: ScenarioPlacementView;
  readonly totals: ScenarioTotalsView;
  readonly utilisation: readonly ClusterUtilisationView[];
  /** Inventory + placement issues + capacity recommendations (validateManagementCapacity). */
  readonly issues: readonly ValidationIssue[];
  readonly flows: ScenarioFlowsView;
  /** Preset host id -> physical server id. */
  readonly hostServers: Readonly<Record<string, string>>;
  readonly racks: readonly ScenarioRack[];
  /** [GAME] NIC cards swapped so all hosts fit the scenario's ToR model. */
  readonly nicAdjustments: readonly NicAdjustment[];
  readonly selection: InspectTarget | null;
  readonly focus: ScenarioFocus;
}

export interface ScenarioSnapshot {
  /** The room exactly as the Sandbox renders it (physical, site, flows of the room before deployment …). */
  readonly sandbox: SandboxSnapshot;
  readonly scenario: ScenarioView;
}

export type ScenarioEvent =
  | SandboxEvent
  | { readonly type: 'scenario/commandRejected'; readonly atMs: number; readonly command: ScenarioCommand['type']; readonly rejection: SandboxRejection }
  | { readonly type: 'scenario/selectionChanged'; readonly atMs: number; readonly selection: InspectTarget | null }
  | { readonly type: 'scenario/focusChanged'; readonly atMs: number; readonly focus: ScenarioFocus };

export interface ScenarioSessionOptions {
  /** Default true. false = lab: Sandbox commands are applied (the scenario views keep describing the preset). */
  readonly readOnly?: boolean;
}

const READ_ONLY_MESSAGE = 'Hotový scénář je jen k prohlížení – prostředí je už nasazené. Změny si vyzkoušej v Sandboxu.';

type StaticView = Omit<ScenarioView, 'selection' | 'focus' | 'readOnly'>;

export class ScenarioSession {
  readonly preset: ScenarioPreset;
  readonly sandbox: SandboxSession;
  readonly build: PresetBuild;
  readonly inventory: FleetInventory;
  readonly totals: FleetTotals;
  readonly placement: PlacementResult;
  readonly readOnly: boolean;
  private readonly staticView: StaticView;
  private readonly bus = new EventBus<ScenarioEvent>();
  private selection: InspectTarget | null = null;
  private focus: ScenarioFocus;
  private rev = 0;
  private cache: { sandbox: SandboxSnapshot; rev: number; snap: ScenarioSnapshot } | undefined;

  constructor(presetId: string, options: ScenarioSessionOptions = {}) {
    const preset = presetById(presetId);
    if (!preset) throw new Error(`unknown scenario preset ${presetId}`);
    this.preset = preset;
    this.readOnly = options.readOnly !== false;
    this.build = buildPresetFleet(preset);
    const room = buildScenarioRoom(preset, this.build);
    this.sandbox = room.session;
    const fleet = this.build.fleet;
    this.inventory = inventoryForFleet(fleet, this.build.options);
    this.totals = totalsForFleet(fleet, this.inventory);
    this.placement = placeVms(fleet, this.inventory);
    const catalog = this.sandbox.context.catalog;
    const caps = hostCapacities(catalog, this.build);
    const utilisation = utilisationViews(fleet, this.inventory, this.totals, caps);
    const order = SCENARIO_PRESETS.findIndex((p) => p.id === preset.id) + 1;
    const s = this.sandbox.state;
    this.staticView = deepFreeze({
      presetId: preset.id,
      meta: scenarioMeta(preset, order, this.build, room.instanceRooms, s.room.physical.sites?.layoutId ?? '', s.choices, nicNotes(room.nicAdjustments)),
      fleet,
      inventory: inventoryView(this.inventory, this.placement, room.hostServers),
      placement: placementView(fleet, this.placement, room.hostServers, room.racks, caps),
      totals: totalsView(fleet, this.totals, preset),
      utilisation,
      issues: [...this.inventory.issues, ...this.placement.issues, ...utilisation.flatMap((u) => u.issues)],
      flows: scenarioFlows(s, catalog, fleet, this.inventory, this.placement, room.hostServers),
      hostServers: room.hostServers,
      racks: room.racks,
      nicAdjustments: room.nicAdjustments,
    });
    this.focus = { roomId: room.racks[0]?.roomId ?? '' };
    this.sandbox.subscribe((e) => this.bus.emit(e));
  }

  subscribe(listener: Listener<ScenarioEvent>): Unsubscribe {
    return this.bus.subscribe(listener);
  }

  /** Shared engine clock (nothing runs in a read-only scenario; kept for the same mode interface). */
  attachTo(engine: Pick<GameEngine, 'attach'>): Unsubscribe {
    return this.sandbox.attachTo(engine);
  }

  dispatch(cmd: ScenarioCommand): CommandResult {
    if (cmd.type === 'inspect') return this.inspect(cmd.target);
    if (cmd.type === 'camera') return this.camera(cmd.roomId, cmd.rackId);
    if (this.readOnly) return this.reject(cmd.type, { kind: 'flow', reason: 'read-only-scenario', message: READ_ONLY_MESSAGE });
    return this.sandbox.dispatch(cmd);
  }

  snapshot(): ScenarioSnapshot {
    const sandbox = this.sandbox.snapshot();
    if (this.cache && this.cache.sandbox === sandbox && this.cache.rev === this.rev) return this.cache.snap;
    const snap: ScenarioSnapshot = deepFreeze({ sandbox, scenario: { ...this.staticView, readOnly: this.readOnly, selection: this.selection, focus: this.focus } });
    this.cache = { sandbox, rev: this.rev, snap };
    return snap;
  }

  private reject(command: ScenarioCommand['type'], rejection: SandboxRejection): CommandResult {
    this.bus.emit({ type: 'scenario/commandRejected', atMs: this.sandbox.timeMs, command, rejection });
    return { ok: false, rejection };
  }

  private exists(t: InspectTarget): boolean {
    const v = this.staticView;
    const phys = this.sandbox.state.room.physical;
    switch (t.kind) {
      case 'vm':
        return v.inventory.vms.some((x) => x.id === t.id);
      case 'host':
        return t.id in v.hostServers;
      case 'server':
        return phys.servers.some((x) => x.id === t.id);
      case 'cluster':
        return v.utilisation.some((x) => x.clusterId === t.id);
      case 'domain':
        return v.fleet.instances.some((i) => i.managementDomain.id === t.id || i.workloadDomains.some((w) => w.id === t.id));
      case 'instance':
        return v.fleet.instances.some((i) => i.id === t.id);
      case 'rack':
        return phys.racks.some((x) => x.id === t.id);
      case 'room':
        return (phys.sites?.rooms ?? []).some((x) => x.id === t.id);
    }
  }

  private inspect(target: InspectTarget | null): CommandResult {
    if (target && !this.exists(target)) return this.reject('inspect', { kind: 'flow', reason: 'invalid-input', message: `Objekt ${target.kind} ${target.id} ve scénáři není.` });
    this.selection = target;
    this.rev++;
    this.bus.emit({ type: 'scenario/selectionChanged', atMs: this.sandbox.timeMs, selection: target });
    return { ok: true, warnings: [] };
  }

  private camera(roomId: string, rackId?: string): CommandResult {
    const phys = this.sandbox.state.room.physical;
    if (!(phys.sites?.rooms ?? []).some((r) => r.id === roomId)) return this.reject('camera', { kind: 'flow', reason: 'invalid-input', message: `Místnost ${roomId} ve scénáři není.` });
    if (rackId !== undefined && !this.staticView.racks.some((r) => r.rackId === rackId && r.roomId === roomId))
      return this.reject('camera', { kind: 'flow', reason: 'unknown-rack', message: `Rack ${rackId} v místnosti ${roomId} není.` });
    this.focus = { roomId, ...(rackId !== undefined ? { rackId } : {}) };
    this.rev++;
    this.bus.emit({ type: 'scenario/focusChanged', atMs: this.sandbox.timeMs, focus: this.focus });
    return { ok: true, warnings: [] };
  }
}
