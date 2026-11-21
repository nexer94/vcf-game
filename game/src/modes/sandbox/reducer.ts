/**
 * Sandbox reducer: pure `(state, command) -> { state, result, events }` and
 * `(state, gameDelta) -> { state, events }` for timed tasks.
 *
 * VCF rules: only via model functions (design.ts, bringup.ts). Sandbox game-flow rules are
 * reported as `{ kind: 'flow' }` rejections and are listed here:
 *  - design choices can be changed only in the design phase and not while a bring-up validation or
 *    deployment task runs;
 *  - planning / environment actions are available in the planning and deploy phases;
 *  - wizard and deployment actions only in the deploy phase;
 *  - the wizard cannot change design-derived fields (DESIGN_LOCKED_FIELDS) – change the design;
 *  - prep actions on hosts of a deployed / deploying management domain are locked
 *    (Day 2 host operations are not modelled yet);
 *  - server room commands (room.ts) and host prep on PHYSICAL servers work in every phase (the room is always
 *    reachable, UX Sandbox v2 flow starts in the room); abstract planning hosts keep the planning/deploy gate;
 *  - objectives tracker commands only change the player's tracker preferences (never the game state).
 *
 * Physical servers (room) are part of the bring-up environment: `bringupEnvOf` adds them as EsxHost records
 * (hardwareDesign.toBringupHosts). The bring-up validation task adds the model's physical network and hardware
 * validations for the physical hosts of the wizard (validatePhysicalNetworkForBringup,
 * validateManagementClusterHardware).
 */
import { advanceTimedTasks, taskProgress } from '../../engine';
import {
  type BringupEnvironment,
  type BringupRules,
  type DeploymentEvent,
  type DeploymentStatus,
  type DesignChoices,
  type DesignContext,
  type EsxHost,
  type StorageType,
  type TransitionResult,
  type ValidationIssue,
  type VcfBinary,
  VCF_BINARIES,
  applyBringupHostNetworking,
  buildFleetFromBringup,
  configureDepot,
  configureHostNetwork,
  configureHostNtp,
  configureServerManagementNetwork,
  deployInstallerOva,
  errorsOf,
  initialDepotState,
  initialDeploymentState,
  initialInstallerState,
  installEsx,
  installEsxOnServer,
  installerAfterDeployment,
  newBareMetalHost,
  parseIpv4,
  regenerateHostCertificate,
  setBinaryStatus,
  setHostSsh,
  testManagementNetwork,
  toBringupHosts,
  updateServerEsx,
  validateBringupSpec,
  validateConfigureOfflineDepot,
  validateConfigureOnlineDepot,
  validateDeployInstallerOva,
  validateDesign,
  validateInstallerCanDeploy,
  validateManagementClusterHardware,
  validatePhysicalNetworkForBringup,
  validateRedesign,
  warningsOf,
} from '../../model';
import { designGate, derivedParamsOf } from './design';
import { ILLUSTRATIVE_TASK_DURATIONS_MS } from './durations';
import { addDnsRecord, removeDnsRecord } from './planning';
import { applyRoom, commitRoomChange, deployedHostFqdns, describeRoom, emptyRoom, isRoomCommand, serverInDeployedDomain, serverTask } from './room';
import { netContextOf, plannedHostNetworks, specServerIds } from './roomNet';
import { type SandboxContext, Tx, defaultSandboxContext, flow, invalid, no, ok } from './tx';
import {
  type CommandResult,
  type SandboxCommand,
  type SandboxEvent,
  type SandboxPhase,
  type SandboxState,
  type SandboxTask,
  type SandboxTaskKind,
  SANDBOX_PHASES,
} from './types';
import { applyDesignToSpec, changedLockedFields, initialSpecDraft, issueKey } from './wizard';

export { deployedHostFqdns } from './room';

export interface SandboxOptions {
  readonly designContext?: DesignContext;
  readonly rules?: BringupRules;
  /** Initial design choices (e.g. a blueprint preset). */
  readonly initialChoices?: DesignChoices;
  /** Version of the VCF Installer appliance OVA (default: modelled version). */
  readonly installerVersion?: string;
  /** Override the ILLUSTRATIVE task durations (tests, accessibility). */
  readonly taskDurationsMs?: Partial<Record<SandboxTaskKind, number>>;
}

export function initialSandboxState(opts: SandboxOptions = {}): SandboxState {
  const base: SandboxState = {
    timeMs: 0,
    phase: 'design',
    furthestPhase: 'design',
    designContext: opts.designContext ?? {},
    rules: opts.rules ?? {},
    choices: {},
    acknowledgedDesignWarnings: [],
    env: {
      installer: initialInstallerState(opts.installerVersion),
      depot: initialDepotState(),
      hosts: [],
      dns: { forward: {}, reverse: {} },
      unreachableFromInstaller: [],
    },
    spec: initialSpecDraft(),
    deployment: initialDeploymentState('wizard'),
    tasks: [],
    room: emptyRoom(),
    roomHistory: { undo: [], redo: [] },
    objectives: { skipped: [], everDone: [], hidden: false },
    log: [],
    seq: { host: 0, task: 0, log: 0, switch: 0, rack: 0, cable: 0, part: 0, ledger: 0 },
    taskDurationsMs: { ...ILLUSTRATIVE_TASK_DURATIONS_MS, ...opts.taskDurationsMs },
  };
  return opts.initialChoices ? withDesign(base, opts.initialChoices) : base;
}

/** Abstract planning hosts + physical servers of the room (as EsxHost records, hardwareDesign.toBringupHosts). */
export function allHostsOf(s: SandboxState): EsxHost[] {
  return s.room.physical.servers.length ? [...s.env.hosts, ...toBringupHosts(s.room.physical)] : [...s.env.hosts];
}

/** BringupEnvironment for model validations. */
export function bringupEnvOf(s: SandboxState): BringupEnvironment {
  return {
    installer: s.env.installer,
    depot: s.env.depot,
    hosts: allHostsOf(s),
    dns: s.env.dns,
    unreachableFromInstaller: s.env.unreachableFromInstaller,
    ...(s.env.physicalNetworkLagReady !== undefined ? { physicalNetworkLagReady: s.env.physicalNetworkLagReady } : {}),
    rules: s.rules,
  };
}

// ---------------------------------------------------------------------------
// Phase gates (model validation only)
// ---------------------------------------------------------------------------

export interface PhaseGate {
  readonly ok: boolean;
  readonly errors: readonly ValidationIssue[];
  readonly unacknowledgedWarnings: readonly ValidationIssue[];
}

export function phaseGate(s: SandboxState, target: SandboxPhase): PhaseGate {
  if (target === 'design') return { ok: true, errors: [], unacknowledgedWarnings: [] };
  const g = designGate(s.choices, s.acknowledgedDesignWarnings, s.designContext);
  if (target === 'planning') return { ok: g.ok, errors: g.errors, unacknowledgedWarnings: g.unacknowledgedWarnings };
  // deploy: the wizard runs in the VCF Installer UI -> the appliance must be able to deploy (20 §4.1, §4.2 step 1).
  // A finished deployment stays viewable even though the appliance may now be SDDC Manager.
  const installer = s.deployment.status === 'completed' ? [] : validateInstallerCanDeploy(s.env.installer);
  const errors = [...g.errors, ...installer];
  return { ok: g.ok && errors.length === 0, errors, unacknowledgedWarnings: g.unacknowledgedWarnings };
}

export interface ReduceOutcome {
  readonly state: SandboxState;
  readonly result: CommandResult;
  readonly events: readonly SandboxEvent[];
}

const RESETTABLE: readonly DeploymentStatus[] = ['review', 'validation-failed', 'awaiting-acknowledgement', 'ready-to-deploy'];
const BUSY: readonly DeploymentStatus[] = ['validating', 'deploying'];

/** Applies new design choices: prunes acks, re-derives params and prefills the wizard draft. */
function withDesign(s: SandboxState, choices: DesignChoices): SandboxState {
  const g = designGate(choices, s.acknowledgedDesignWarnings, s.designContext);
  const current = new Set(warningsOf(g.issues).map(issueKey));
  const acknowledgedDesignWarnings = s.acknowledgedDesignWarnings.filter((k) => current.has(k));
  const derived = derivedParamsOf(g);
  const base: SandboxState = { ...s, choices, acknowledgedDesignWarnings };
  const { derived: _old, ...rest } = base;
  void _old;
  if (!derived) return rest;
  // After a completed bring-up the deployed spec is history; do not rewrite it.
  const spec = s.deployment.status === 'completed' ? s.spec : applyDesignToSpec(s.spec, derived);
  return { ...rest, derived, spec };
}

const PHASE_LABEL: Readonly<Record<SandboxPhase, string>> = { design: 'Návrh', planning: 'Příprava', deploy: 'Deploy' };

export function reduceSandbox(state: SandboxState, cmd: SandboxCommand, ctx: SandboxContext = defaultSandboxContext()): ReduceOutcome {
  const tx = new Tx(state);
  const r = apply(tx, cmd, ctx);
  if (r.ok) {
    tx.log({ kind: 'command', command: cmd.type, ok: true, message: describe(cmd), ...(r.warnings.length ? { issues: r.warnings } : {}) });
    tx.emit({ type: 'sandbox/stateChanged', atMs: tx.s.timeMs, cause: cmd.type });
    return { state: tx.s, result: r, events: tx.events };
  }
  // Rejected: keep the state, only record the attempt.
  const rej = new Tx(state);
  const issues = r.rejection.kind === 'validation' ? r.rejection.issues : r.rejection.kind === 'gate' ? [...r.rejection.errors, ...r.rejection.unacknowledgedWarnings] : [];
  rej.log({
    kind: 'command',
    command: cmd.type,
    ok: false,
    message: r.rejection.kind === 'flow' ? `${describe(cmd)} – odmítnuto: ${r.rejection.message}` : `${describe(cmd)} – odmítnuto validací`,
    ...(issues.length ? { issues } : {}),
  });
  rej.emit({ type: 'sandbox/commandRejected', atMs: state.timeMs, command: cmd.type, rejection: r.rejection });
  return { state: rej.s, result: r, events: rej.events };
}

function apply(tx: Tx, cmd: SandboxCommand, ctx: SandboxContext): CommandResult {
  const s = tx.s;
  const inPhase = (...phases: SandboxPhase[]): CommandResult | undefined =>
    phases.includes(s.phase) ? undefined : no(flow('wrong-phase', `Akce není dostupná ve fázi ${PHASE_LABEL[s.phase]}.`));

  if (isRoomCommand(cmd)) return applyRoom(tx, cmd, ctx);

  switch (cmd.type) {
    // ------------------------------------------------------------- objectives
    case 'skipObjective':
    case 'unskipObjective': {
      if (!ctx.objectives.byId.has(cmd.id)) return no(flow('unknown-objective', `Úkol ${cmd.id} neexistuje.`));
      const skipped = s.objectives.skipped.filter((x) => x !== cmd.id);
      if (cmd.type === 'skipObjective') {
        if (s.objectives.skipped.includes(cmd.id)) return no(flow('nothing-to-do', 'Úkol už je přeskočený.'));
        skipped.push(cmd.id);
      } else if (skipped.length === s.objectives.skipped.length) return no(flow('nothing-to-do', 'Úkol není přeskočený.'));
      tx.s = { ...s, objectives: { ...s.objectives, skipped } };
      return ok();
    }
    case 'setObjectivesHidden': {
      if (s.objectives.hidden === cmd.hidden) return no(flow('nothing-to-do', cmd.hidden ? 'Tracker už je skrytý.' : 'Tracker už je zobrazený.'));
      tx.s = { ...s, objectives: { ...s.objectives, hidden: cmd.hidden } };
      return ok();
    }

    // ----------------------------------------------------------------- design
    case 'selectDesignOption':
    case 'clearDesignOption': {
      const bad = inPhase('design');
      if (bad) return bad;
      if (BUSY.includes(s.deployment.status)) return no(flow('task-in-progress', 'Během validace nebo nasazení nelze měnit návrh.'));
      const next: Partial<Record<keyof DesignChoices, string>> = { ...s.choices };
      if (cmd.type === 'selectDesignOption') next[cmd.decision] = cmd.option;
      else delete next[cmd.decision];
      if (s.deployedChoices) {
        const re = validateRedesign(s.deployedChoices, next, 'deployed');
        if (errorsOf(re).length) return no(invalid(re));
      }
      const before = s.spec;
      tx.s = withDesign(s, next);
      if (RESETTABLE.includes(tx.s.deployment.status) && (changedLockedFields(before, tx.s.spec).length > 0 || before.nsx.nodeFqdns.length !== tx.s.spec.nsx.nodeFqdns.length)) {
        tx.deployment({ type: 'edit' });
        tx.log({ kind: 'system', ok: true, message: 'Změna návrhu se propsala do průvodce – průvodce je zpět v režimu úprav.' });
      }
      return ok(warningsOf(validateDesign(next, s.designContext)).filter((i) => i.subject === cmd.decision));
    }
    case 'acknowledgeDesignWarnings': {
      const bad = inPhase('design');
      if (bad) return bad;
      const warnings = warningsOf(validateDesign(s.choices, s.designContext));
      const current = new Set(warnings.map(issueKey));
      const keys = cmd.keys ?? [...current];
      const unknown = keys.filter((k) => !current.has(k));
      if (unknown.length) return no(flow('invalid-input', `Neznámé varování: ${unknown.join(', ')}.`));
      if (keys.length === 0) return no(flow('nothing-to-do', 'Návrh nemá žádná varování k potvrzení.'));
      tx.s = { ...s, acknowledgedDesignWarnings: [...new Set([...s.acknowledgedDesignWarnings, ...keys])] };
      return ok();
    }

    // ------------------------------------------------------------- navigation
    case 'advancePhase': {
      const i = SANDBOX_PHASES.indexOf(s.phase);
      const target = SANDBOX_PHASES[i + 1];
      if (!target) return no(flow('no-next-phase', 'Deploy je poslední fáze.'));
      const g = phaseGate(s, target);
      if (!g.ok) return no({ kind: 'gate', target, errors: g.errors, unacknowledgedWarnings: g.unacknowledgedWarnings });
      setPhase(tx, target);
      return ok();
    }
    case 'goBack': {
      const target = SANDBOX_PHASES[SANDBOX_PHASES.indexOf(s.phase) - 1];
      if (!target) return no(flow('no-previous-phase', 'Návrh je první fáze.'));
      setPhase(tx, target);
      return ok();
    }

    // ------------------------------------------------------------------ hosts
    case 'addHost': {
      const bad = inPhase('planning', 'deploy');
      if (bad) return bad;
      if (!Number.isInteger(cmd.hw.pnicCount) || cmd.hw.pnicCount < 1) return no(flow('invalid-input', 'Počet fyzických NIC musí být kladné celé číslo.'));
      let n = s.seq.host + 1;
      const taken = (x: string): boolean => s.env.hosts.some((h) => h.id === x) || s.room.physical.servers.some((h) => h.id === x) || s.room.physical.switches.some((h) => h.id === x);
      if (cmd.id === undefined) while (taken(`esx${String(n).padStart(2, '0')}`)) n += 1;
      const id = cmd.id ?? `esx${String(n).padStart(2, '0')}`;
      if (taken(id)) return no(flow('duplicate-host-id', `Host ${id} už existuje.`));
      tx.s = { ...s, env: { ...s.env, hosts: [...s.env.hosts, newBareMetalHost(id, cmd.hw)] }, seq: { ...s.seq, host: n } };
      tx.invalidateValidation();
      return ok();
    }
    case 'removeHost':
    case 'installEsx':
    case 'configureHostNetwork':
    case 'configureHostNtp':
    case 'setHostSsh':
    case 'regenerateHostCertificate': {
      if ('hostId' in cmd && s.room.physical.servers.some((x) => x.id === cmd.hostId)) return physicalHostCommand(tx, cmd, ctx);
      const bad = inPhase('planning', 'deploy');
      if (bad) return bad;
      const host = s.env.hosts.find((h) => h.id === cmd.hostId);
      if (!host) return no(flow('unknown-host', `Host ${cmd.hostId} neexistuje.`));
      if (host.network && deployedHostFqdns(s).has(host.network.hostnameFqdn))
        return no(flow('host-in-deployed-domain', `Host ${host.id} je součástí nasazované / nasazené management domain; operace Day 2 zatím nejsou v modelu.`));
      if (cmd.type === 'removeHost') {
        tx.s = { ...s, env: { ...s.env, hosts: s.env.hosts.filter((h) => h.id !== host.id) } };
        tx.invalidateValidation();
        return ok();
      }
      const r = hostTransition(host, cmd);
      if (!r.ok) return no(invalid([r.error]));
      tx.s = { ...s, env: { ...s.env, hosts: s.env.hosts.map((h) => (h.id === host.id ? r.state : h)) } };
      tx.invalidateValidation();
      return ok();
    }

    // ------------------------------------------------------------ environment
    case 'addDnsRecord': {
      const bad = inPhase('planning', 'deploy');
      if (bad) return bad;
      if (parseIpv4(cmd.ip) === undefined || cmd.fqdn.trim() === '') return no(flow('invalid-input', 'Záznam DNS potřebuje jméno a platnou IPv4 adresu.'));
      tx.s = { ...s, env: { ...s.env, dns: addDnsRecord(s.env.dns, cmd.fqdn.trim(), cmd.ip, cmd.records) } };
      tx.invalidateValidation();
      return ok();
    }
    case 'removeDnsRecord': {
      const bad = inPhase('planning', 'deploy');
      if (bad) return bad;
      const dns = removeDnsRecord(s.env.dns, cmd.fqdn.trim(), cmd.records);
      if (JSON.stringify(dns) === JSON.stringify(s.env.dns)) return no(flow('nothing-to-do', `Pro ${cmd.fqdn} není co odebrat.`));
      tx.s = { ...s, env: { ...s.env, dns } };
      tx.invalidateValidation();
      return ok();
    }
    case 'setInstallerReachability': {
      const bad = inPhase('planning', 'deploy');
      if (bad) return bad;
      const rest = s.env.unreachableFromInstaller.filter((t) => t !== cmd.target);
      tx.s = { ...s, env: { ...s.env, unreachableFromInstaller: cmd.reachable ? rest : [...rest, cmd.target] } };
      tx.invalidateValidation();
      return ok();
    }
    case 'setPhysicalNetworkLagReady': {
      const bad = inPhase('planning', 'deploy');
      if (bad) return bad;
      const { physicalNetworkLagReady: _p, ...env } = s.env;
      void _p;
      tx.s = { ...s, env: cmd.ready === null ? env : { ...env, physicalNetworkLagReady: cmd.ready } };
      tx.invalidateValidation();
      return ok();
    }

    // ----------------------------------------------------- installer / depot
    case 'deployInstaller': {
      const bad = inPhase('planning', 'deploy');
      if (bad) return bad;
      const issues = validateDeployInstallerOva(s.env.installer, cmd.ovf, s.env.dns, s.rules.dictionaryWords ?? []);
      if (errorsOf(issues).length) return no(invalid(errorsOf(issues)));
      const r = deployInstallerOva(s.env.installer, cmd.ovf, s.env.dns, s.rules.dictionaryWords ?? []);
      if (!r.ok) return no(invalid([r.error]));
      // Documented prefills: DNS domain name from the installer (20 §4.2 step 9); SDDC Manager FQDN when the
      // installer runs on a management host (20 §4.1.5 step 8, §4.2 step 17).
      const spec = {
        ...s.spec,
        general: s.spec.general.dnsDomainName === '' ? { ...s.spec.general, dnsDomainName: cmd.ovf.dnsDomainName } : s.spec.general,
        sddcManager: cmd.ovf.placement === 'management-host' && s.spec.sddcManager.fqdn === '' ? { fqdn: cmd.ovf.hostnameFqdn } : s.spec.sddcManager,
      };
      tx.s = { ...s, env: { ...s.env, installer: r.state }, spec };
      tx.notify('info', 'VCF Installer appliance je nasazený.');
      return ok(warningsOf(issues));
    }
    case 'configureDepot': {
      const bad = inPhase('planning', 'deploy');
      if (bad) return bad;
      const issues = cmd.connection.kind === 'online' ? validateConfigureOnlineDepot(cmd.connection.input) : validateConfigureOfflineDepot(cmd.connection.input);
      if (errorsOf(issues).length) return no(invalid(errorsOf(issues)));
      const r = configureDepot(s.env.depot, cmd.connection);
      if (!r.ok) return no(invalid([r.error]));
      tx.s = { ...s, env: { ...s.env, depot: r.state } };
      return ok(warningsOf(issues));
    }
    case 'downloadBinaries': {
      const bad = inPhase('planning', 'deploy');
      if (bad) return bad;
      const wanted = (cmd.binaries ?? VCF_BINARIES).filter((b) => {
        const st = s.env.depot.binaries[b] ?? 'not-downloaded';
        return st === 'not-downloaded' || st === 'failed';
      });
      if (wanted.length === 0) return no(flow('nothing-to-do', 'Žádná binárka nečeká na stažení.'));
      let depot = s.env.depot;
      for (const b of wanted) {
        const r = setBinaryStatus(depot, b, 'downloading');
        if (!r.ok) return no(invalid([r.error]));
        depot = r.state;
      }
      tx.s = { ...s, env: { ...s.env, depot } };
      for (const b of wanted) tx.startTask('binary-download', `Stahování: ${b}`, { kind: 'binary-download', binary: b });
      return ok();
    }

    // ------------------------------------------------------------------ wizard
    case 'setWizardSection': {
      const bad = inPhase('deploy');
      if (bad) return bad;
      if (s.deployment.status === 'completed') return no(flow('deployment-completed', 'Nasazení je dokončené; zadání už nelze měnit.'));
      if (BUSY.includes(s.deployment.status)) return no(flow('task-in-progress', 'Během validace nebo nasazení nelze měnit zadání.'));
      const spec = { ...s.spec, [cmd.section]: cmd.value };
      if (s.derived) {
        const locked = changedLockedFields(spec, applyDesignToSpec(spec, s.derived));
        if (locked.length) return no(flow('design-locked-field', `Pole ${locked.join(', ')} určuje návrh – změň je ve fázi Návrh.`));
      }
      if (s.deployment.status !== 'draft') {
        const r = tx.deployment({ type: 'edit' });
        if (!r.ok) return no(invalid([r.error]));
      }
      tx.s = { ...tx.s, spec };
      return ok();
    }
    case 'submitForReview':
    case 'editWizard':
    case 'acknowledgeDeploymentWarnings': {
      const bad = inPhase('deploy');
      if (bad) return bad;
      const ev: DeploymentEvent['type'] = cmd.type === 'submitForReview' ? 'submit-for-review' : cmd.type === 'editWizard' ? 'edit' : 'acknowledge-warnings';
      const r = tx.deployment({ type: ev } as DeploymentEvent);
      if (!r.ok) return no(invalid([r.error]));
      return ok();
    }
    case 'startValidation': {
      const bad = inPhase('deploy');
      if (bad) return bad;
      const r = tx.deployment({ type: 'start-validation' });
      if (!r.ok) return no(invalid([r.error]));
      tx.startTask('bringup-validation', 'Validace nasazení (Review validation)', { kind: 'bringup-validation' });
      return ok();
    }
    case 'deploy': {
      const bad = inPhase('deploy');
      if (bad) return bad;
      const r = tx.deployment({ type: 'deploy' });
      if (!r.ok) return no(invalid([r.error]));
      tx.startTask('bringup-deployment', 'Nasazení VCF fleet (bring-up)', { kind: 'bringup-deployment' });
      tx.notify('info', 'Nasazení VCF fleet bylo spuštěno.');
      return ok();
    }
  }
}

function setPhase(tx: Tx, to: SandboxPhase): void {
  const from = tx.s.phase;
  const furthest = SANDBOX_PHASES.indexOf(to) > SANDBOX_PHASES.indexOf(tx.s.furthestPhase) ? to : tx.s.furthestPhase;
  tx.s = { ...tx.s, phase: to, furthestPhase: furthest };
  tx.log({ kind: 'phase', ok: true, message: `Fáze: ${PHASE_LABEL[to]}` });
  tx.emit({ type: 'sandbox/phaseChanged', atMs: tx.s.timeMs, from, to });
}

type HostCommand =
  | Extract<SandboxCommand, { type: 'installEsx'; hostId: string }>
  | Extract<SandboxCommand, { type: 'configureHostNetwork' | 'configureHostNtp' | 'setHostSsh' | 'regenerateHostCertificate' }>;

/**
 * Legacy host commands (hostId) on a PHYSICAL server: mapped onto the model's physical transitions (any phase).
 * `removeHost` behaves like `removeItem`; the instant legacy `installEsx` is rejected (physical servers install via
 * the timed `installEsx {serverId, method}`).
 */
function physicalHostCommand(tx: Tx, cmd: HostCommand | Extract<SandboxCommand, { type: 'removeHost' }>, ctx: SandboxContext): CommandResult {
  const s = tx.s;
  if (cmd.type === 'removeHost') return applyRoom(tx, { type: 'removeItem', id: cmd.hostId }, ctx);
  if (cmd.type === 'installEsx') return no(flow('invalid-input', `${cmd.hostId} je fyzický server – ESX se instaluje příkazem installEsx {serverId, method}.`));
  const srv = s.room.physical.servers.find((x) => x.id === cmd.hostId)!;
  if (serverTask(s, srv.id)) return no(flow('device-busy', `Na serveru ${srv.id} právě běží úloha.`));
  if (serverInDeployedDomain(s, srv)) return no(flow('host-in-deployed-domain', `Host ${srv.id} je součástí nasazované / nasazené management domain; operace Day 2 zatím nejsou v modelu.`));
  const r =
    cmd.type === 'configureHostNetwork'
      ? configureServerManagementNetwork(s.room.physical, srv.id, cmd.network)
      : updateServerEsx(s.room.physical, srv.id, (h) => hostTransition(h, cmd));
  if (!r.ok) return no(invalid([r.error]));
  commitRoomChange(tx, { ...s.room, physical: r.state });
  tx.invalidateValidation();
  return ok();
}

function hostTransition(h: EsxHost, cmd: HostCommand): TransitionResult<EsxHost> {
  switch (cmd.type) {
    case 'installEsx':
      return installEsx(h, cmd.version);
    case 'configureHostNetwork':
      return configureHostNetwork(h, cmd.network);
    case 'configureHostNtp':
      return configureHostNtp(h, cmd.servers);
    case 'setHostSsh':
      return setHostSsh(h, cmd.enabled);
    case 'regenerateHostCertificate':
      return regenerateHostCertificate(h);
  }
}

function describe(cmd: SandboxCommand): string {
  if (isRoomCommand(cmd)) return describeRoom(cmd);
  switch (cmd.type) {
    case 'skipObjective':
      return `Úkol přeskočen: ${cmd.id}`;
    case 'unskipObjective':
      return `Úkol obnoven: ${cmd.id}`;
    case 'setObjectivesHidden':
      return cmd.hidden ? 'Tracker úkolů skryt' : 'Tracker úkolů zobrazen';
    case 'selectDesignOption':
      return `Návrh: ${cmd.decision} = ${cmd.option}`;
    case 'clearDesignOption':
      return `Návrh: ${cmd.decision} zrušeno`;
    case 'acknowledgeDesignWarnings':
      return 'Návrh: varování potvrzena';
    case 'advancePhase':
      return 'Další fáze';
    case 'goBack':
      return 'Předchozí fáze';
    case 'addHost':
      return `Přidán server${cmd.id ? ` ${cmd.id}` : ''} (${cmd.hw.hwVendor}, ${cmd.hw.pnicCount} NIC)`;
    case 'removeHost':
      return `Odebrán host ${cmd.hostId}`;
    case 'installEsx':
      return `${cmd.hostId}: instalace ESX ${cmd.version}`;
    case 'configureHostNetwork':
      return `${cmd.hostId}: management síť (${cmd.network.hostnameFqdn}, ${cmd.network.ipv4Address})`;
    case 'configureHostNtp':
      return `${cmd.hostId}: NTP ${cmd.servers.join(', ')}`;
    case 'setHostSsh':
      return `${cmd.hostId}: SSH ${cmd.enabled ? 'zapnuto' : 'vypnuto'}`;
    case 'regenerateHostCertificate':
      return `${cmd.hostId}: přegenerován self-signed certifikát`;
    case 'addDnsRecord':
      return `DNS: ${cmd.records ?? 'a+ptr'} ${cmd.fqdn} → ${cmd.ip}`;
    case 'removeDnsRecord':
      return `DNS: odebráno ${cmd.records ?? 'a+ptr'} ${cmd.fqdn}`;
    case 'setInstallerReachability':
      return `Prostředí: ${cmd.target} ${cmd.reachable ? 'dosažitelný' : 'nedosažitelný'} z VCF Installeru`;
    case 'setPhysicalNetworkLagReady':
      return `Prostředí: fyzická síť připravená na LAG = ${String(cmd.ready)}`;
    case 'deployInstaller':
      return `Nasazení VCF Installer OVA (${cmd.ovf.hostnameFqdn})`;
    case 'configureDepot':
      return `Depot: ${cmd.connection.kind}`;
    case 'downloadBinaries':
      return 'Stahování binárek';
    case 'setWizardSection':
      return `Průvodce: ${cmd.section}`;
    case 'submitForReview':
      return 'Průvodce: Review deployment information';
    case 'editWizard':
      return 'Průvodce: úpravy';
    case 'startValidation':
      return 'Průvodce: spuštěna validace';
    case 'acknowledgeDeploymentWarnings':
      return 'Průvodce: varování validace potvrzena (Acknowledge)';
    case 'deploy':
      return 'Průvodce: Deploy';
  }
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

export interface AdvanceOutcome {
  readonly state: SandboxState;
  readonly events: readonly SandboxEvent[];
  /**
   * True when only task progress (elapsedMs) and `timeMs` changed – no task completed, nothing else in
   * the state moved. The session uses it to keep the heavy snapshot parts cached.
   */
  readonly progressOnly: boolean;
}

/** Progress granularity for `sandbox/tasksProgressed` notifications (whole percent). */
const PROGRESS_STEPS = 100;
const progressStep = (t: SandboxTask): number => Math.floor(taskProgress(t) * PROGRESS_STEPS);

/**
 * Advances timed tasks by a game-time delta. `nowMs` (engine game time) overrides the accumulated
 * session time when provided.
 *
 * `state.timeMs` is the game time of the last state change, not a running clock: with no running task
 * (or a zero delta while paused) the SAME state object is returned, so idle ticks never create new
 * state. The clock owner (SandboxSession) syncs `timeMs` before applying the next command.
 *
 * Notifications are coalesced: `sandbox/tasksProgressed` only when some task crossed a whole percent,
 * `sandbox/stateChanged` (cause 'tick') only when a task completed.
 */
export function advanceSandbox(state: SandboxState, gameDeltaMs: number, nowMs?: number, ctx: SandboxContext = defaultSandboxContext()): AdvanceOutcome {
  if (gameDeltaMs <= 0 || state.tasks.length === 0) return { state, events: [], progressOnly: true };
  const tx = new Tx({ ...state, timeMs: nowMs ?? state.timeMs + gameDeltaMs });
  const { running, completed } = advanceTimedTasks(tx.s.tasks, gameDeltaMs);
  tx.s = { ...tx.s, tasks: running };
  const before = new Map(state.tasks.map((t) => [t.id, progressStep(t)]));
  const moved = running.filter((t) => progressStep(t) !== before.get(t.id));
  if (moved.length > 0)
    tx.emit({ type: 'sandbox/tasksProgressed', atMs: tx.s.timeMs, tasks: moved.map((t) => ({ taskId: t.id, kind: t.kind, progress: taskProgress(t) })) });
  for (const t of completed) {
    tx.emit({ type: 'sandbox/taskCompleted', atMs: tx.s.timeMs, taskId: t.id, kind: t.kind, label: t.label });
    completeTask(tx, t, ctx);
  }
  if (completed.length > 0) tx.emit({ type: 'sandbox/stateChanged', atMs: tx.s.timeMs, cause: 'tick' });
  return { state: tx.s, events: tx.events, progressOnly: completed.length === 0 };
}

function setBinary(tx: Tx, b: VcfBinary, next: 'validating' | 'downloaded'): boolean {
  const r = setBinaryStatus(tx.s.env.depot, b, next);
  if (!r.ok) {
    tx.log({ kind: 'task', ok: false, message: `${b}: přechod na ${next} odmítnut`, issues: [r.error] });
    return false;
  }
  tx.s = { ...tx.s, env: { ...tx.s.env, depot: r.state } };
  return true;
}

/** Model physical network + hardware validation for the physical hosts of the wizard (added to Review validation). */
export function physicalBringupIssues(s: SandboxState, ctx: SandboxContext): ValidationIssue[] {
  const ids = specServerIds(s);
  if (ids.length === 0) return [];
  const storage: StorageType = s.derived?.storage ?? 'vsan-esa';
  const plan = plannedHostNetworks(s);
  return [
    ...(plan ? validatePhysicalNetworkForBringup(netContextOf(s, ctx.catalog), { serverIds: ids, plan, storage }) : []),
    ...validateManagementClusterHardware(s.room.physical, ctx.catalog, ids, storage),
  ];
}

function completeTask(tx: Tx, t: SandboxTask, ctx: SandboxContext): void {
  const p = t.payload;
  switch (p.kind) {
    case 'esx-install': {
      const r = installEsxOnServer(tx.s.room.physical, p.serverId, p.version);
      if (!r.ok) {
        tx.log({ kind: 'task', ok: false, message: `${p.serverId}: instalaci ESX nelze dokončit.`, issues: [r.error] });
        return;
      }
      const mgmtTests = { ...tx.s.room.mgmtTests };
      delete mgmtTests[p.serverId];
      commitRoomChange(tx, { ...tx.s.room, physical: r.state, mgmtTests });
      tx.invalidateValidation();
      tx.log({ kind: 'task', ok: true, message: `${p.serverId}: ESX nainstalován (${p.version}); vmk0 na vSwitch0 s vmnic0, adresa z DHCP.` });
      tx.notify('info', `${p.serverId}: ESX nainstalován.`);
      return;
    }
    case 'mgmt-network-test': {
      if (!tx.s.room.physical.servers.some((x) => x.id === p.serverId)) return;
      const res = testManagementNetwork(netContextOf(tx.s, ctx.catalog), p.serverId);
      const okAll = res.gateway && Object.values(res.dns).every(Boolean) && Object.keys(res.dns).length > 0;
      commitRoomChange(tx, { ...tx.s.room, mgmtTests: { ...tx.s.room.mgmtTests, [p.serverId]: { atMs: tx.s.timeMs, gateway: res.gateway, dns: res.dns } } });
      tx.log({ kind: 'task', ok: okAll, message: `${p.serverId}: Test Management Network – gateway ${res.gateway ? 'OK' : 'nedostupná'}, DNS ${Object.keys(res.dns).length ? Object.entries(res.dns).map(([k, v]) => `${k} ${v ? 'OK' : 'nedostupný'}`).join(', ') : 'žádný'}.` });
      tx.notify(okAll ? 'info' : 'warning', `${p.serverId}: test management sítě ${okAll ? 'prošel' : 'neprošel'}.`);
      return;
    }
    case 'binary-download':
      if (setBinary(tx, p.binary, 'validating')) tx.startTask('binary-validation', `Validace: ${p.binary}`, { kind: 'binary-validation', binary: p.binary });
      return;
    case 'binary-validation':
      if (setBinary(tx, p.binary, 'downloaded')) {
        tx.log({ kind: 'task', ok: true, message: `Binárka ${p.binary} stažena a zvalidována.` });
        if (VCF_BINARIES.every((b) => tx.s.env.depot.binaries[b] === 'downloaded')) tx.notify('info', 'Všechny binárky pro nasazení VCF jsou stažené.');
      }
      return;
    case 'bringup-validation': {
      const issues = [...validateBringupSpec(tx.s.spec, bringupEnvOf(tx.s)), ...physicalBringupIssues(tx.s, ctx)];
      const r = tx.deployment({ type: 'validation-finished', issues });
      if (!r.ok) {
        tx.log({ kind: 'task', ok: false, message: 'Výsledek validace nelze zapsat.', issues: [r.error] });
        return;
      }
      const st = r.state.status;
      tx.log({ kind: 'task', ok: st !== 'validation-failed', message: `Validace dokončena: ${st}`, ...(issues.length ? { issues } : {}) });
      if (st === 'validation-failed') tx.notify('error', `Validace selhala: ${errorsOf(issues).length} chyb.`);
      else if (st === 'awaiting-acknowledgement') tx.notify('warning', `Validace prošla s ${warningsOf(issues).length} varováními – oprav je nebo potvrď (Acknowledge).`);
      else tx.notify('info', 'Validace prošla bez chyb a varování.');
      return;
    }
    case 'bringup-deployment': {
      const r = tx.deployment({ type: 'deployment-succeeded' });
      if (!r.ok) {
        tx.log({ kind: 'task', ok: false, message: 'Dokončení nasazení nelze zapsat.', issues: [r.error] });
        return;
      }
      const s = tx.s;
      // Game identifiers (not VCF facts). Cluster model comes from the design (wizard does not expose it).
      const fleet = buildFleetFromBringup(
        s.spec,
        { fleetId: 'fleet-01', fleetName: `${s.spec.general.instanceName} fleet`, instanceId: 'instance-01', domainId: 'mgmt-domain-01', clusterId: 'mgmt-cluster-01' },
        s.derived?.clusterModel ?? 'single-rack',
      );
      tx.s = { ...s, fleet, deployedChoices: s.choices, env: { ...s.env, installer: installerAfterDeployment(s.env.installer) } };
      // Physical hosts: "the installer migrates the hosts to a VDS and adds uplinks" (25 §7 [U18]; model applyBringupHostNetworking).
      const ids = specServerIds(tx.s);
      const plan = plannedHostNetworks(tx.s);
      if (ids.length && plan) commitRoomChange(tx, { ...tx.s.room, physical: applyBringupHostNetworking(tx.s.room.physical, ids, plan, tx.s.derived?.storage ?? 'vsan-esa') });
      tx.log({ kind: 'task', ok: true, message: `VCF fleet nasazena: instance ${s.spec.general.instanceName}, management domain ${s.spec.general.managementDomainName}.` });
      tx.emit({ type: 'sandbox/fleetCreated', atMs: tx.s.timeMs, fleet });
      tx.notify('info', 'Bring-up dokončen – VCF fleet je nasazená.');
      return;
    }
  }
}
