/**
 * Sandbox mode – state, commands, results and events.
 *
 * The Sandbox is a thin layer over the shared model (game/src/model) and engine (game/src/engine):
 * every VCF rule comes from model validations / transitions; this layer only sequences them,
 * keeps the immutable session state and adds game-flow rules (phases, which actions are possible
 * while a task is running). Game-flow rejections are reported as `kind: 'flow'`, never as VCF
 * validation issues. No score; money is unlimited in the Sandbox, only the spent game currency is
 * recorded (economy = game layer, modes/economy).
 *
 * Physical layer (server room): the model's PhysicalState (model/physical.ts) plus game-only room data
 * (rack floor tiles, parts stock, cable cosmetics, company network uplink, undo history).
 */
import type { GameEvent, TimedTask } from '../../engine';
import type {
  BringupRules,
  BringupSpec,
  DeploymentEvent,
  Facing,
  DeploymentState,
  DeploymentStatus,
  DepotConnection,
  DepotState,
  DesignBringupParams,
  DesignChoices,
  DesignContext,
  DesignDecisionId,
  DnsRecords,
  EsxHost,
  EsxHostNetwork,
  Fleet,
  InstallerOvfInput,
  InstallerState,
  PhysicalState,
  PortRef,
  ServerConfig,
  SwitchPortConfig,
  ValidationIssue,
  VcfBinary,
  AzRole,
  BlueprintId,
  SiteLayoutId,
} from '../../model';
import type { UseCaseChoice, UseCaseId } from './useCases';
import type { ConsoleKey, ConsoleState, ConsoleValue, InstallTemplate } from './console';

export const SANDBOX_PHASES = ['design', 'planning', 'deploy'] as const;
export type SandboxPhase = (typeof SANDBOX_PHASES)[number];

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export type SandboxTaskKind =
  | 'binary-download'
  | 'binary-validation'
  | 'bringup-validation'
  | 'bringup-deployment'
  /** ESX installation on a physical server (20 §4.1.1 [S8]); duration illustrative. */
  | 'esx-install'
  /** DCUI "Test Management Network" (25 §6.3 [U34]); duration illustrative. */
  | 'mgmt-network-test';

/** How ESX gets onto the server: at the server (physical media) or remotely via BMC virtual media (25 §10.4.1). */
export type EsxInstallMethod = 'physical' | 'bmc';

export type SandboxTaskPayload =
  | { readonly kind: 'binary-download'; readonly binary: VcfBinary }
  | { readonly kind: 'binary-validation'; readonly binary: VcfBinary }
  | { readonly kind: 'bringup-validation' }
  | { readonly kind: 'bringup-deployment' }
  | { readonly kind: 'esx-install'; readonly serverId: string; readonly method: EsxInstallMethod; readonly version: string }
  | { readonly kind: 'mgmt-network-test'; readonly serverId: string };

export type SandboxTask = TimedTask<SandboxTaskKind, SandboxTaskPayload>;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Simulated environment the bring-up model validates against (planning phase). */
export interface SandboxEnvironment {
  readonly installer: InstallerState;
  readonly depot: DepotState;
  readonly hosts: readonly EsxHost[];
  /** DNS server content – environment, edited by the player as "environment actions". */
  readonly dns: DnsRecords;
  /** Targets (FQDN / IP) the installer cannot reach (20 §3.3) – sandbox "break it" switch. */
  readonly unreachableFromInstaller: readonly string[];
  /** [9.1] LAG readiness of the physical network (20 §4.2 [S32]); undefined = not checked. */
  readonly physicalNetworkLagReady?: boolean;
}

// ---------------------------------------------------------------------------
// Server room (game data around the model's PhysicalState)
// ---------------------------------------------------------------------------

/**
 * Floor tile of a rack in the room (same shape as render/room Tile). Placement rules: model roomLayout.ts via
 * rackLayout.ts. `rotation` (clockwise): 0 = front towards +gy (S, default), 90 = W, 180 = N, 270 = E
 * (model rotationToFacing).
 */
export interface RoomTile {
  readonly gx: number;
  readonly gy: number;
  readonly rotation?: 0 | 90 | 180 | 270;
}

/** Spare part (drive / NIC) bought and not yet installed in a server. */
export interface PartStock {
  readonly id: string;
  readonly itemId: string;
}

/** Player's own cable marking – cosmetic only (UX §9.4), never a traffic colour. */
export interface CableMeta {
  readonly color?: string;
  readonly label?: string;
}

/**
 * "Síť firmy" – the customer's network behind a switch uplink port (UX §10.2 / §12.2, GAME ABSTRACTION):
 * gateway, DNS, NTP, DHCP and the admin workstation are reachable through this port.
 */
export interface CompanyNetworkLink {
  readonly switchId: string;
  readonly port: number;
}

/** Result of the last DCUI "Test Management Network" of a host (25 §6.3 [U34]). */
export interface MgmtTestResult {
  readonly atMs: number;
  readonly gateway: boolean;
  readonly dns: Readonly<Record<string, boolean>>;
}

export interface LedgerEntry {
  readonly seq: number;
  readonly atMs: number;
  readonly kind: 'buy' | 'sell' | 'reconfigure';
  readonly itemId: string;
  readonly qty: number;
  /** Game currency; negative = refund. */
  readonly amount: number;
}

/** Sandbox money is unlimited (CLAUDE.md); only the spent game currency is recorded. */
export interface SandboxEconomy {
  readonly spent: number;
  readonly ledger: readonly LedgerEntry[];
}

export interface SandboxRoomState {
  /** Model state: racks, servers (incl. ESX host state), switches, cables. Endpoints are derived, see roomView. */
  readonly physical: PhysicalState;
  /** Racks with a tile are placed in the room; racks without one are in the inventory ("V batohu"). */
  readonly rackTiles: Readonly<Record<string, RoomTile>>;
  readonly parts: readonly PartStock[];
  readonly cableMeta: Readonly<Record<string, CableMeta>>;
  readonly companyNetwork?: CompanyNetworkLink;
  readonly mgmtTests: Readonly<Record<string, MgmtTestResult>>;
  readonly economy: SandboxEconomy;
  /** Room id -> pre-installed OOB switch id (oob.ts, GAME scope; only with `SandboxState.autoBmc`). */
  readonly oobSwitches?: Readonly<Record<string, string>>;
  /**
   * Rack id -> pre-installed top-of-rack switches (tor.ts, GAME; only with `SandboxState.autoTor`, UX 19.5).
   * `a` = ToR-A put in the top U when the rack was first placed; `b` = optional ToR-B added by the player (addTor).
   * A rack listed here is never provisioned again (the player may remove ToR-A in the lab).
   */
  readonly preinstalledTors?: Readonly<Record<string, PreinstalledTor>>;
}

/** Pre-installed ToR switches of one rack (GAME, UX 19.5). */
export interface PreinstalledTor {
  readonly a?: string;
  readonly b?: string;
  /** Switch model of ToR-A (catalog id). */
  readonly modelId: string;
}

/** Undo / redo of room edits (UX §2.4: history of 50 actions while building / cabling). */
export interface RoomHistory {
  readonly undo: readonly SandboxRoomState[];
  readonly redo: readonly SandboxRoomState[];
}

/** Player's tracker state (UX §8.6): skipped ids, ids ever seen done (for "regressed"), visibility. */
export interface ObjectivesPrefs {
  readonly skipped: readonly string[];
  readonly everDone: readonly string[];
  readonly hidden: boolean;
}

export interface SandboxLogEntry {
  readonly seq: number;
  readonly atMs: number;
  readonly kind: 'command' | 'task' | 'phase' | 'system';
  /** Command type for kind 'command'. */
  readonly command?: SandboxCommand['type'];
  readonly ok: boolean;
  /** Czech game text (VCF terms in English). */
  readonly message: string;
  /** Model issues related to the entry, passed through unchanged. */
  readonly issues?: readonly ValidationIssue[];
}

export interface SandboxState {
  readonly timeMs: number;
  readonly phase: SandboxPhase;
  /** Furthest phase reached so far (for the stepper). */
  readonly furthestPhase: SandboxPhase;
  readonly designContext: DesignContext;
  readonly rules: BringupRules;
  readonly choices: DesignChoices;
  /** Keys (see issueKey) of design warnings the player accepted. Pruned to current warnings on every change. */
  readonly acknowledgedDesignWarnings: readonly string[];
  /** Last successfully derived bring-up params (undefined while the design has errors). */
  readonly derived?: DesignBringupParams;
  /** Choices at the moment of a successful bring-up (input of validateRedesign). */
  readonly deployedChoices?: DesignChoices;
  readonly env: SandboxEnvironment;
  /** Wizard "Deploy a new VCF fleet" draft (= JSON spec content). */
  readonly spec: BringupSpec;
  readonly deployment: DeploymentState;
  readonly tasks: readonly SandboxTask[];
  readonly fleet?: Fleet;
  /** Server room (physical layer). */
  readonly room: SandboxRoomState;
  readonly roomHistory: RoomHistory;
  readonly objectives: ObjectivesPrefs;
  /** Chosen use case / path (25 §2.1, §4.9): id + spec reference only, no VCF rule depends on it yet. */
  readonly useCase?: UseCaseChoice;
  /**
   * Chosen VCF 9.1 fleet Design Blueprint (06 §1, §2.1–2.5) – start choice of the Sandbox. The site layout it is
   * played in lives in `room.physical.sites.layoutId` (06 §7a mapping, model LAYOUT_BLUEPRINTS).
   */
  readonly blueprintId?: BlueprintId;
  /**
   * Pre-wired OOB / BMC network (oob.ts, GAME scope): a pre-installed OOB switch per room and automatic BMC cabling +
   * IP on mount. Sandbox default true; Career switches it off (manual OOB cabling as a task).
   */
  readonly autoBmc: boolean;
  /**
   * Pre-installed ToR (tor.ts, GAME, UX 19.5): every rack gets a generic ToR-A in its top U (+ uplink to the company
   * network when none exists yet) when it is first placed in the room. Sandbox v3 / Career: on; default off.
   */
  readonly autoTor: boolean;
  /** ESX console (installer + DCUI) per server (console.ts, UX ch. 20). */
  readonly consoles?: Readonly<Record<string, ConsoleState>>;
  /** Choices of the last interactive ESX install – template of "apply same choices to remaining hosts" (UX 20.3). */
  readonly installTemplate?: InstallTemplate;
  readonly log: readonly SandboxLogEntry[];
  readonly seq: {
    readonly host: number;
    readonly task: number;
    readonly log: number;
    readonly switch: number;
    readonly rack: number;
    readonly cable: number;
    readonly part: number;
    readonly ledger: number;
  };
  /** Task durations in game ms – ILLUSTRATIVE (see durations.ts). */
  readonly taskDurationsMs: Readonly<Record<SandboxTaskKind, number>>;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface HostHardwareInput {
  readonly hwVendor: string;
  readonly hwProfileId: string;
  readonly pnicCount: number;
  readonly stateless?: boolean;
}

/** Which DNS records an environment action touches. */
export type DnsRecordKind = 'a+ptr' | 'a' | 'ptr';

/** Wizard sections = top-level keys of BringupSpec. */
export type WizardSection = keyof BringupSpec;

export type SetWizardSectionCommand = {
  [K in WizardSection]: { readonly type: 'setWizardSection'; readonly section: K; readonly value: BringupSpec[K] };
}[WizardSection];

/** A cable end: server NIC index (vmnicN, 0-based) or 'bmc'; switch port index (0-based). */
export interface CableEndInput {
  readonly deviceId: string;
  readonly port: number | 'bmc';
}

/** Switch port edit; omitted fields keep the current value. `vlan` = access VLAN, `vlans` = trunk allowed VLANs. */
export interface SwitchPortInput {
  readonly mode?: SwitchPortConfig['mode'];
  readonly vlan?: number;
  readonly vlans?: 'all' | readonly number[];
  readonly nativeVlan?: number;
  readonly mtu?: number;
  /** null = remove from LAG. */
  readonly lagGroup?: string | null;
}

export type SandboxCommand =
  // --- design phase ---
  | { readonly type: 'selectDesignOption'; readonly decision: DesignDecisionId; readonly option: string }
  | { readonly type: 'clearDesignOption'; readonly decision: DesignDecisionId }
  /** Acknowledge the given warning keys, or all current design warnings when `keys` is omitted. */
  | { readonly type: 'acknowledgeDesignWarnings'; readonly keys?: readonly string[] }
  // --- phase navigation ---
  | { readonly type: 'advancePhase' }
  | { readonly type: 'goBack' }
  // --- planning: hosts (unlimited resources: add freely) ---
  | { readonly type: 'addHost'; readonly hw: HostHardwareInput; readonly id?: string }
  | { readonly type: 'removeHost'; readonly hostId: string }
  /** Abstract planning host (legacy, instant). */
  | { readonly type: 'installEsx'; readonly hostId: string; readonly version: string }
  /** Physical server: timed task 'esx-install'. `version` default: rules.requiredEsxVersion or the game label. */
  | { readonly type: 'installEsx'; readonly serverId: string; readonly method: EsxInstallMethod; readonly version?: string }
  | { readonly type: 'configureHostNetwork'; readonly hostId: string; readonly network: EsxHostNetwork }
  | { readonly type: 'configureHostNtp'; readonly hostId: string; readonly servers: readonly string[] }
  | { readonly type: 'setHostSsh'; readonly hostId: string; readonly enabled: boolean }
  | { readonly type: 'regenerateHostCertificate'; readonly hostId: string }
  // --- planning: environment ---
  | { readonly type: 'addDnsRecord'; readonly fqdn: string; readonly ip: string; readonly records?: DnsRecordKind }
  | { readonly type: 'removeDnsRecord'; readonly fqdn: string; readonly records?: DnsRecordKind }
  | { readonly type: 'setInstallerReachability'; readonly target: string; readonly reachable: boolean }
  | { readonly type: 'setPhysicalNetworkLagReady'; readonly ready: boolean | null }
  // --- planning: installer, depot, binaries ---
  | { readonly type: 'deployInstaller'; readonly ovf: InstallerOvfInput }
  | { readonly type: 'configureDepot'; readonly connection: Exclude<DepotConnection, { kind: 'none' }> }
  /** Start downloads (all not-downloaded / failed binaries when omitted). */
  | { readonly type: 'downloadBinaries'; readonly binaries?: readonly VcfBinary[] }
  // --- deploy: wizard + deployment state machine ---
  | SetWizardSectionCommand
  | { readonly type: 'submitForReview' }
  | { readonly type: 'editWizard' }
  | { readonly type: 'startValidation' }
  | { readonly type: 'acknowledgeDeploymentWarnings' }
  | { readonly type: 'deploy' }
  // --- server room: shop, placement (any phase) ---
  /** Buy `qty` (default 1) of a catalog item (starter server, `bcg-*` model, drive, NIC, switch, rack). */
  | { readonly type: 'buyItem'; readonly itemId: string; readonly qty?: number }
  /**
   * Place or move a rack: an inventory rack / a placed rack (`inventoryId` / `rackId`) or buy one (`itemId`).
   * `roomId` = room of the site layout (omitted: the rack's current room). `facing` = where the rack front points
   * (omitted: `tile.rotation`, else the current facing of a placed rack, else 'S'). [GAME] room layout rules
   * (model validateRackPlacement) – rejected with their issues unchanged.
   */
  | { readonly type: 'placeRack'; readonly inventoryId?: string; readonly rackId?: string; readonly itemId?: string; readonly tile: RoomTile; readonly roomId?: string; readonly facing?: Facing; readonly torModelId?: string }
  /** [GAME] add the optional ToR-B into the reserved U under ToR-A (UX 19.3/19.5; default model = ToR-A's). */
  | { readonly type: 'addTor'; readonly rackId: string; readonly modelId?: string }
  /**
   * Add a NIC card into a free NIC slot (UX 19.4). `nicPartId` must be in the model's certified BOM (ServerModel.nics) and
   * in the game parts catalog. Slot count = NIC_SLOTS_GAME_DEFAULT (game value); cards fill slots in order (slot 1-based).
   */
  | { readonly type: 'addNic'; readonly serverId: string; readonly slot: number; readonly nicPartId: string }
  /** Remove the NIC card of a slot (its cables are disconnected; later cards move up – vmnic numbering follows). */
  | { readonly type: 'removeNic'; readonly serverId: string; readonly slot: number }
  /** Turn a placed rack in place (front towards `facing`); [GAME] room layout rules apply. */
  | { readonly type: 'rotateRack'; readonly rackId: string; readonly facing: Facing }
  /** Move a rack (with its devices) into another room of the site (model moveRackToRoom); a placed rack keeps its tile. */
  | { readonly type: 'moveRackToRoom'; readonly rackId: string; readonly roomId: string }
  /** Assign a room to an AZ / fault-domain role (model assignRoomRole); null = unassign. */
  | { readonly type: 'assignRoomRole'; readonly roomId: string; readonly role: AzRole | null }
  /** Mount an inventory server / switch (`inventoryId` = `deviceId`); `u` / `positionU` omitted = lowest free U. */
  | { readonly type: 'mountDevice'; readonly inventoryId?: string; readonly deviceId?: string; readonly rackId: string; readonly u?: number; readonly positionU?: number }
  /** Back to the inventory; its cables are disconnected (game rule). */
  | { readonly type: 'unmountDevice'; readonly deviceId: string }
  /** Mounted device / placed empty rack -> inventory; inventory item / spare part -> sold (100 % refund). */
  | { readonly type: 'removeItem'; readonly id: string }
  // --- server room: cabling, switch ports ---
  | { readonly type: 'connectCable'; readonly from: CableEndInput; readonly to: CableEndInput; readonly color?: string; readonly label?: string }
  | { readonly type: 'disconnectCable'; readonly cableId: string }
  /** Cosmetic colour / label of a cable; null clears. */
  | { readonly type: 'setCableMeta'; readonly cableId: string; readonly color?: string | null; readonly label?: string | null }
  | { readonly type: 'setSwitchPort'; readonly switchId: string; readonly port: number | readonly number[]; readonly config: SwitchPortInput }
  /** Connect the switch to the company network (GAME abstraction; default port = last port of the switch). */
  | { readonly type: 'connectCompanyNetwork'; readonly switchId: string; readonly port?: number }
  | { readonly type: 'disconnectCompanyNetwork' }
  | { readonly type: 'undoRoom' }
  | { readonly type: 'redoRoom' }
  // --- server room: hardware and ESX on physical servers ---
  /** Edit CPU / RAM / drives / NICs before ESX is installed (validated by the model). */
  | { readonly type: 'configureServer'; readonly serverId: string; readonly config: ServerConfig }
  /** DCUI "Configure Management Network" (20 §4.1.2; 25 §6.3). */
  | {
      readonly type: 'configureMgmtNetwork';
      readonly serverId: string;
      readonly ip: string;
      readonly mask: string;
      readonly gw: string;
      readonly vlan?: number | null;
      readonly dns: readonly string[];
      readonly hostname: string;
      readonly customDnsSuffixes?: readonly string[];
    }
  /** DCUI "Test Management Network" (25 §6.3 [U34]) – timed task, shows flow N2 while it runs. */
  | { readonly type: 'testManagementNetwork'; readonly serverId: string }
  /** DCUI "Network Adapters": vmnics of vSwitch0 (25 §6.3 [U32]). */
  | { readonly type: 'setHostUplinks'; readonly serverId: string; readonly vmnics: readonly number[] }
  | { readonly type: 'setHostSwitchMtu'; readonly serverId: string; readonly switchName: string; readonly mtu: number }
  | { readonly type: 'setVmkMtu'; readonly serverId: string; readonly vmk: string; readonly mtu: number }
  /** BMC (out of VCF scope – game, 25 §10): IP (≠ host IP [U74]), VLAN tag, OS↔BMC USB-NIC interface. */
  | { readonly type: 'configureBmc'; readonly serverId: string; readonly ip?: string | null; readonly vlan?: number | null; readonly hostInterfaceEnabled?: boolean }
  // --- server console: ESX installer + DCUI (console.ts, UX ch. 20 / 26.2) ---
  /** Open the console of a server: installer when ESX is not installed (`method` = boot media), else DCUI. */
  | { readonly type: 'openConsole'; readonly serverId: string; readonly method?: EsxInstallMethod }
  /** A key on the console; `value` = input of the screen (disk id, keyboard, password, form fields). */
  | { readonly type: 'consoleKey'; readonly serverId: string; readonly key: ConsoleKey; readonly value?: ConsoleValue }
  | { readonly type: 'closeConsole'; readonly serverId: string }
  /**
   * "Instalovat stejně na zbývající hosty" (UX 20.3): starts ESX install tasks with the choices of the last interactive
   * install (`installTemplate`) on `serverIds` (default: every mounted server without ESX with the same configuration).
   */
  | { readonly type: 'installEsxBatch'; readonly serverIds?: readonly string[] }
  // --- objectives tracker (UX §8) ---
  | { readonly type: 'skipObjective'; readonly id: string }
  | { readonly type: 'unskipObjective'; readonly id: string }
  | { readonly type: 'setObjectivesHidden'; readonly hidden: boolean }
  // --- use case / path (25 §2.1, §4.9) ---
  /** Record the chosen use case (UC-1 … UC-10); null clears the choice. */
  | { readonly type: 'chooseUseCase'; readonly useCaseId: UseCaseId | null }
  // --- site / Design Blueprint (06) ---
  /**
   * Choose a fleet Design Blueprint and the game site layout it is played in (the layout must map to the blueprint,
   * model LAYOUT_BLUEPRINTS, 06 §7a). A different layout only before any rack exists (model chooseSiteLayout).
   * In the design phase the blueprint's documented design choices are pre-selected.
   */
  | { readonly type: 'chooseBlueprint'; readonly blueprintId: BlueprintId; readonly layoutId: SiteLayoutId };

export type SandboxCommandType = SandboxCommand['type'];

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

/** Game-flow reasons (not VCF rules). */
export type FlowReason =
  | 'wrong-phase'
  | 'no-next-phase'
  | 'no-previous-phase'
  | 'unknown-host'
  | 'duplicate-host-id'
  | 'host-in-deployed-domain'
  | 'nothing-to-do'
  | 'task-in-progress'
  | 'deployment-completed'
  | 'design-locked-field'
  | 'invalid-input'
  // server room (game rules, not VCF)
  | 'unknown-item'
  | 'unknown-device'
  | 'unknown-rack'
  | 'unknown-cable'
  | 'not-mounted'
  | 'rack-not-placed'
  | 'rack-not-empty'
  | 'port-reserved'
  | 'esx-installed'
  | 'device-busy'
  | 'bmc-not-ready'
  | 'bmc-remote-install-not-documented'
  | 'unknown-objective'
  // sites (game rules, not VCF)
  | 'tile-occupied'
  | 'preinstalled-oob'
  | 'blueprint-layout-mismatch'
  // v3 (UX Part III, game rules)
  | 'u-reserved'
  | 'no-free-slot'
  | 'slot-empty'
  | 'nic-not-certified'
  | 'console-not-open'
  | 'console-key'
  | 'no-install-template'
  // career layer (modes/career, game rules)
  | 'over-budget'
  | 'locked-by-level'
  // Hotové scénáře (modes/scenarios, game rule): the prepared environment is read-only
  | 'read-only-scenario';

export type SandboxRejection =
  /** A model validation / transition rejected the action. Issues are the model's, unchanged. */
  | { readonly kind: 'validation'; readonly issues: readonly ValidationIssue[] }
  /** A phase gate failed. Both lists come from model validation (validateDesign / installer checks). */
  | {
      readonly kind: 'gate';
      readonly target: SandboxPhase;
      readonly errors: readonly ValidationIssue[];
      readonly unacknowledgedWarnings: readonly ValidationIssue[];
    }
  /** Game-flow rule of the Sandbox (not a VCF fact). */
  | { readonly kind: 'flow'; readonly reason: FlowReason; readonly message: string };

export type CommandResult =
  /** `created`: ids of new instances (bought devices / racks / parts, new cable). */
  | { readonly ok: true; readonly warnings: readonly ValidationIssue[]; readonly created?: readonly string[] }
  | { readonly ok: false; readonly rejection: SandboxRejection };

// ---------------------------------------------------------------------------
// Events (EventBus)
// ---------------------------------------------------------------------------

export type SandboxEvent =
  | GameEvent
  | { readonly type: 'sandbox/stateChanged'; readonly atMs: number; readonly cause: SandboxCommandType | 'tick' }
  | { readonly type: 'sandbox/phaseChanged'; readonly atMs: number; readonly from: SandboxPhase; readonly to: SandboxPhase }
  | { readonly type: 'sandbox/commandRejected'; readonly atMs: number; readonly command: SandboxCommandType; readonly rejection: SandboxRejection }
  | { readonly type: 'sandbox/taskStarted'; readonly atMs: number; readonly taskId: string; readonly kind: SandboxTaskKind; readonly label: string }
  /** Coalesced progress notification: emitted only when a running task crossed a whole percent. */
  | {
      readonly type: 'sandbox/tasksProgressed';
      readonly atMs: number;
      readonly tasks: readonly { readonly taskId: string; readonly kind: SandboxTaskKind; readonly progress: number }[];
    }
  | { readonly type: 'sandbox/taskCompleted'; readonly atMs: number; readonly taskId: string; readonly kind: SandboxTaskKind; readonly label: string }
  | {
      readonly type: 'sandbox/deploymentStatusChanged';
      readonly atMs: number;
      readonly from: DeploymentStatus;
      readonly to: DeploymentStatus;
      readonly event: DeploymentEvent['type'];
    }
  | { readonly type: 'sandbox/fleetCreated'; readonly atMs: number; readonly fleet: Fleet }
  /** Objective satisfied for the first time (celebration, UX §3.3 / §8.4). */
  | { readonly type: 'sandbox/objectiveCompleted'; readonly atMs: number; readonly id: string; readonly groupCompleted?: string }
  /** A doc-required objective that was done is no longer satisfied (UX §8.3 "problém"). */
  | { readonly type: 'sandbox/objectiveRegressed'; readonly atMs: number; readonly id: string }
  /**
   * E-T5 (UX 28.13): a cable's link came up (cable connected and both ends negotiated a common speed, model
   * linkStatus). Emitted after the command / tick that caused it. `a` / `b` = the cable ends (as in Cable).
   */
  | { readonly type: 'sandbox/linkUp'; readonly atMs: number; readonly cableId: string; readonly a: PortRef; readonly b: PortRef; readonly aDeviceId: string; readonly bDeviceId: string; readonly speedGbE?: number }
  /** A link that was up is down or the cable is gone (`a` / `b` absent when the cable was removed). */
  | { readonly type: 'sandbox/linkDown'; readonly atMs: number; readonly cableId: string; readonly a?: PortRef; readonly b?: PortRef };

export type SandboxEventType = SandboxEvent['type'];
