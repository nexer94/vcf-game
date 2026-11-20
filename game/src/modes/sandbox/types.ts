/**
 * Sandbox mode – state, commands, results and events.
 *
 * The Sandbox is a thin layer over the shared model (game/src/model) and engine (game/src/engine):
 * every VCF rule comes from model validations / transitions; this layer only sequences them,
 * keeps the immutable session state and adds game-flow rules (phases, which actions are possible
 * while a task is running). Game-flow rejections are reported as `kind: 'flow'`, never as VCF
 * validation issues. No money, no score (CLAUDE.md "Herní režimy" – Sandbox).
 */
import type { GameEvent, TimedTask } from '../../engine';
import type {
  BringupRules,
  BringupSpec,
  DeploymentEvent,
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
  ValidationIssue,
  VcfBinary,
} from '../../model';

export const SANDBOX_PHASES = ['design', 'planning', 'deploy'] as const;
export type SandboxPhase = (typeof SANDBOX_PHASES)[number];

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export type SandboxTaskKind = 'binary-download' | 'binary-validation' | 'bringup-validation' | 'bringup-deployment';

export type SandboxTaskPayload =
  | { readonly kind: 'binary-download'; readonly binary: VcfBinary }
  | { readonly kind: 'binary-validation'; readonly binary: VcfBinary }
  | { readonly kind: 'bringup-validation' }
  | { readonly kind: 'bringup-deployment' };

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
  readonly log: readonly SandboxLogEntry[];
  readonly seq: { readonly host: number; readonly task: number; readonly log: number };
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
  | { readonly type: 'installEsx'; readonly hostId: string; readonly version: string }
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
  | { readonly type: 'deploy' };

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
  | 'invalid-input';

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
  | { readonly ok: true; readonly warnings: readonly ValidationIssue[] }
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
  | { readonly type: 'sandbox/taskCompleted'; readonly atMs: number; readonly taskId: string; readonly kind: SandboxTaskKind; readonly label: string }
  | {
      readonly type: 'sandbox/deploymentStatusChanged';
      readonly atMs: number;
      readonly from: DeploymentStatus;
      readonly to: DeploymentStatus;
      readonly event: DeploymentEvent['type'];
    }
  | { readonly type: 'sandbox/fleetCreated'; readonly atMs: number; readonly fleet: Fleet };

export type SandboxEventType = SandboxEvent['type'];
