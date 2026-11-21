/**
 * Server console – interactive ESX installer and DCUI as a data-driven state machine (UX ch. 20, contract 26.2).
 *
 * - Screens are DATA (scenarios/console/esx-console.json, from docs/spec/26-esx-install.md §4.1 / §4.3); this file only
 *   implements the generic key handling and the named actions of the data (select-disk, install, login, apply-mgmt…).
 * - No VCF rule lives here: the final steps call the existing room commands (installEsx, configureMgmtNetwork,
 *   setHostUplinks, testManagementNetwork) through `applyRoom`, so the model validations decide.
 * - ESX root password rules of the installer: 26 §3.4 [E12] (vSphere Security 9.1). The installer's error text is not
 *   documented (26 §8 OQ3) – the console shows a Czech game message with the spec reference.
 * - "Apply the same choices to the remaining hosts" (UX 20.3): `installEsxBatch` starts install tasks with the choices of
 *   the last interactive install on hosts with the same configuration (GAME acceleration).
 *
 * Pure TypeScript: no DOM, no PixiJS.
 */
import { type HardwareCatalog, type PhysicalServer, configFingerprint, parseIpv4 } from '../../model';
import consoleJson from '../../scenarios/console/esx-console.json';
import { applyRoom, serverTask } from './room';
import { type SandboxContext, type Tx, flow, no, ok } from './tx';
import type { CommandResult, EsxInstallMethod, SandboxCommand, SandboxState } from './types';

// ===========================================================================
// Screen data contract (UX 26.2)
// ===========================================================================

export type ConsoleKey = 'Enter' | 'F1' | 'F2' | 'F11' | 'Esc' | 'Y' | 'N' | 'Up' | 'Down' | 'Space';
export const CONSOLE_KEYS: readonly ConsoleKey[] = ['Enter', 'F1', 'F2', 'F11', 'Esc', 'Y', 'N', 'Up', 'Down', 'Space'];

export type ConsoleAction =
  | 'disk-details'
  | 'select-disk'
  | 'select-osdata'
  | 'set-keyboard'
  | 'set-password'
  | 'install'
  | 'reboot'
  | 'login'
  | 'logout'
  | 'menu-enter'
  | 'mgmt-begin'
  | 'mgmt-exit'
  | 'save-form'
  | 'apply-mgmt'
  | 'discard-mgmt'
  | 'change-password'
  | 'restart-network'
  | 'test-network';

export interface ConsoleKeyDef {
  readonly key: ConsoleKey;
  readonly label: string;
  readonly next?: string;
  readonly action?: ConsoleAction;
}

export interface ConsoleField {
  readonly id: string;
  readonly label: string;
  readonly optional?: boolean;
}

export interface EsxConsoleScreen {
  readonly id: string;
  /** English, as in the spec. */
  readonly title: string;
  /** Only texts quoted in the spec. */
  readonly body?: readonly string[];
  readonly keys: readonly ConsoleKeyDef[];
  readonly input?: 'disk' | 'keyboard' | 'password' | 'text' | 'form';
  readonly fields?: readonly ConsoleField[];
  readonly menu?: readonly { readonly label: string; readonly next: string; readonly action?: ConsoleAction }[];
  readonly specRef: string;
  /** Screen without spec texts -> UI label 'zjednodušená obrazovka (herní)'. */
  readonly simplified?: true;
}

export interface ConsoleScreens {
  readonly installer: readonly EsxConsoleScreen[];
  readonly dcui: readonly EsxConsoleScreen[];
  readonly keyboardLayouts: readonly string[];
  readonly byId: ReadonlyMap<string, EsxConsoleScreen>;
}

const ACTIONS: readonly ConsoleAction[] = [
  'disk-details', 'select-disk', 'select-osdata', 'set-keyboard', 'set-password', 'install', 'reboot', 'login', 'logout', 'menu-enter',
  'mgmt-begin', 'mgmt-exit', 'save-form', 'apply-mgmt', 'discard-mgmt', 'change-password', 'restart-network', 'test-network',
];

/** Validates the console data (shape, keys, actions, `next` targets). Returns the problems (empty = OK). */
export function checkConsoleScreens(raw: unknown): string[] {
  const errs: string[] = [];
  const d = raw as { installer?: unknown; dcui?: unknown; keyboardLayouts?: unknown };
  const all: EsxConsoleScreen[] = [];
  for (const k of ['installer', 'dcui'] as const) {
    const list = d?.[k];
    if (!Array.isArray(list) || list.length === 0) errs.push(`${k} must be a non-empty list`);
    else all.push(...(list as EsxConsoleScreen[]));
  }
  if (!Array.isArray(d?.keyboardLayouts) || (d.keyboardLayouts as unknown[]).length === 0) errs.push('keyboardLayouts must be a non-empty list');
  const ids = new Set<string>();
  for (const s of all) {
    if (typeof s.id !== 'string' || typeof s.title !== 'string' || typeof s.specRef !== 'string' || !Array.isArray(s.keys)) {
      errs.push(`screen ${String(s.id)}: id, title, specRef, keys required`);
      continue;
    }
    if (ids.has(s.id)) errs.push(`duplicate screen ${s.id}`);
    ids.add(s.id);
  }
  for (const s of all) {
    for (const k of s.keys ?? []) {
      if (!CONSOLE_KEYS.includes(k.key)) errs.push(`${s.id}: unknown key ${String(k.key)}`);
      if (k.action !== undefined && !ACTIONS.includes(k.action)) errs.push(`${s.id}: unknown action ${String(k.action)}`);
      if (k.next !== undefined && !ids.has(k.next)) errs.push(`${s.id}: next ${k.next} does not exist`);
    }
    for (const m of s.menu ?? []) if (!ids.has(m.next)) errs.push(`${s.id}: menu next ${m.next} does not exist`);
    if (s.input === 'form' && !(s.fields && s.fields.length)) errs.push(`${s.id}: form needs fields`);
  }
  return errs;
}

function loadScreens(raw: unknown): ConsoleScreens {
  const problems = checkConsoleScreens(raw);
  if (problems.length) throw new Error(`esx-console.json: ${problems.join('; ')}`);
  const d = raw as { installer: EsxConsoleScreen[]; dcui: EsxConsoleScreen[]; keyboardLayouts: string[] };
  return { installer: d.installer, dcui: d.dcui, keyboardLayouts: d.keyboardLayouts, byId: new Map([...d.installer, ...d.dcui].map((s) => [s.id, s])) };
}

/** The bundled console data. */
export const CONSOLE_SCREENS: ConsoleScreens = loadScreens(consoleJson);

// ===========================================================================
// State
// ===========================================================================

/** DCUI "Configure Management Network" draft (strings as typed; validated on apply by the model). */
export interface MgmtDraft {
  readonly vmnics?: string;
  readonly vlan?: string;
  readonly ip?: string;
  readonly mask?: string;
  readonly gw?: string;
  readonly dns1?: string;
  readonly dns2?: string;
  readonly hostname?: string;
  readonly suffixes?: string;
}

export interface ConsoleMessage {
  readonly level: 'error' | 'info' | 'hint';
  /** Czech game text (VCF terms in English). */
  readonly text: string;
  readonly specRef?: string;
}

export interface ConsoleState {
  readonly serverId: string;
  readonly open: boolean;
  readonly flow: 'installer' | 'dcui';
  readonly screenId: string;
  /** Boot media of the installer: at the server or BMC virtual media (25 §10.4.1). */
  readonly method: EsxInstallMethod;
  /** Cursor in a list / menu (0-based). */
  readonly selection: number;
  readonly disk?: string;
  readonly osDataDisk?: string;
  readonly keyboard?: string;
  /** Root password set in the installer / DCUI (game state, needed for the DCUI login). */
  readonly rootPassword?: string;
  readonly loggedIn: boolean;
  readonly draft?: MgmtDraft;
  readonly message?: ConsoleMessage;
}

/** Choices of the last interactive install (UX 20.3 "stejné volby"). */
export interface InstallTemplate {
  readonly fromServerId: string;
  readonly method: EsxInstallMethod;
  readonly keyboard: string;
  readonly rootPassword: string;
  /** Install disk kind: the boot device or a data (vSAN) drive. */
  readonly diskKind: 'boot' | 'data';
  /** Hardware configuration fingerprint (model configFingerprint) – hosts with another configuration are skipped. */
  readonly fingerprint: string;
}

export type ConsoleValue = string | Readonly<Record<string, string>>;

// ===========================================================================
// Disks of a server (from the model configuration)
// ===========================================================================

export interface ConsoleDisk {
  readonly id: string;
  readonly label: string;
  readonly capacityGB: number;
  /** 'boot' = boot device of the configuration (15 §3.1); 'data' = a vSAN / data drive. */
  readonly kind: 'boot' | 'data';
  /** Boot device is USB / SD (no persistent OSDATA, 26 §5.1). */
  readonly usbSd?: boolean;
}

export function serverDisks(catalog: HardwareCatalog, srv: PhysicalServer): ConsoleDisk[] {
  const out: ConsoleDisk[] = [
    { id: 'boot', label: srv.config.boot.description || 'Boot device', capacityGB: srv.config.boot.capacityGB, kind: 'boot', ...(srv.config.boot.kind === 'usb-sd' ? { usbSd: true } : {}) },
  ];
  let n = 0;
  for (const d of srv.config.drives) {
    const part = catalog.drives.get(d.partId);
    for (let i = 0; i < d.count; i++) {
      n += 1;
      out.push({ id: `drive-${n}`, label: part ? `${part.family} ${part.capacityTB} TB` : d.partId, capacityGB: Math.round((part?.capacityTB ?? 0) * 1000), kind: 'data' });
    }
  }
  return out;
}

// ===========================================================================
// ESX root password (26 §3.4 [E12], vSphere Security 9.1)
// ===========================================================================

export const ESX_ROOT_PASSWORD_REF = '26-esx-install §3.4 [E12]';

/**
 * Default ESX 9.1 password rules (26 §3.4 [E12]): length 7–128; all four character classes (lowercase, uppercase,
 * digits, special); an uppercase first character and a digit last character do not count; must not contain the user
 * name. Returns Czech game messages (the installer's own text is not documented, 26 §8 OQ3).
 */
export function checkEsxRootPassword(password: string, username = 'root'): string[] {
  const out: string[] = [];
  if (password.length < 7 || password.length > 128) out.push('Heslo musí mít 7 až 128 znaků.');
  const counted = password.replace(/^[A-Z]/, '').replace(/[0-9]$/, '');
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(counted)).length;
  if (classes < 4) out.push('Heslo musí obsahovat malé i velké písmeno, číslici a speciální znak (velké písmeno na začátku a číslice na konci se nepočítají).');
  if (password.toLowerCase().includes(username.toLowerCase())) out.push(`Heslo nesmí obsahovat uživatelské jméno (${username}).`);
  return out;
}

// ===========================================================================
// Commands
// ===========================================================================

export type ConsoleCommand = Extract<SandboxCommand, { type: 'openConsole' | 'consoleKey' | 'closeConsole' | 'installEsxBatch' }>;

export const isConsoleCommand = (cmd: SandboxCommand): cmd is ConsoleCommand =>
  cmd.type === 'openConsole' || cmd.type === 'consoleKey' || cmd.type === 'closeConsole' || cmd.type === 'installEsxBatch';

const screen = (id: string): EsxConsoleScreen => CONSOLE_SCREENS.byId.get(id)!;
const firstOf = (flowId: 'installer' | 'dcui'): string => (flowId === 'installer' ? CONSOLE_SCREENS.installer[0]!.id : CONSOLE_SCREENS.dcui[0]!.id);

function put(tx: Tx, c: ConsoleState): void {
  tx.s = { ...tx.s, consoles: { ...tx.s.consoles, [c.serverId]: c } };
}

function go(c: ConsoleState, screenId: string, extra: Partial<ConsoleState> = {}): ConsoleState {
  const { message: _m, ...rest } = c;
  void _m;
  return { ...rest, screenId, selection: 0, ...extra };
}

const err = (text: string, specRef?: string): ConsoleMessage => ({ level: 'error', text, ...(specRef ? { specRef } : {}) });

function draftOf(srv: PhysicalServer): MgmtDraft {
  const n = srv.esx.network;
  const vss = srv.hostNet?.switches.find((x) => x.name === 'vSwitch0');
  return {
    vmnics: (vss?.uplinks ?? [0]).join(','),
    vlan: n?.vlanId !== undefined ? String(n.vlanId) : '',
    ip: n?.ipv4Address ?? '',
    mask: n?.subnetMask ?? '',
    gw: n?.defaultGateway ?? '',
    dns1: n?.dnsServers[0] ?? '',
    dns2: n?.dnsServers[1] ?? '',
    hostname: n?.hostnameFqdn ?? '',
    suffixes: (n?.customDnsSuffixes ?? []).join(','),
  };
}

const strValue = (v: ConsoleValue | undefined): string | undefined => (typeof v === 'string' ? v : undefined);
const list = (x: string | undefined): string[] => (x ?? '').split(/[,\s]+/).map((t) => t.trim()).filter(Boolean);

export function applyConsole(tx: Tx, cmd: ConsoleCommand, ctx: SandboxContext): CommandResult {
  const s = tx.s;
  if (cmd.type === 'installEsxBatch') return installBatch(tx, cmd.serverIds, ctx);
  const srv = s.room.physical.servers.find((x) => x.id === cmd.serverId);
  if (!srv) return no(flow('unknown-device', `Server ${cmd.serverId} neexistuje.`));
  const cur = s.consoles?.[srv.id];

  if (cmd.type === 'openConsole') {
    if (!srv.mount) return no(flow('not-mounted', `Server ${srv.id} není v racku (bez napájení).`));
    if (cmd.method !== undefined && cmd.method !== 'physical' && cmd.method !== 'bmc') return no(flow('invalid-input', 'Neznámá cesta instalace.'));
    const installed = srv.esx.esxVersion !== undefined;
    const installing = serverTask(s, srv.id)?.payload.kind === 'esx-install';
    const method = cmd.method ?? cur?.method ?? 'physical';
    // Keep the current screen while it still fits the server (installer before / during install, "Installation
    // Complete" after it, DCUI with ESX); otherwise start over in the right flow.
    const fits = cur !== undefined && (cur.flow === 'dcui' ? installed : !installed || cur.screenId === 'complete' || installing);
    if (cur && fits) {
      put(tx, { ...cur, open: true, method: installing || cur.flow === 'dcui' ? cur.method : method });
      return ok();
    }
    const base = { serverId: srv.id, open: true, method, selection: 0, loggedIn: false, ...(cur?.rootPassword !== undefined ? { rootPassword: cur.rootPassword } : {}), ...(cur?.keyboard !== undefined ? { keyboard: cur.keyboard } : {}) };
    put(tx, installed ? { ...base, flow: 'dcui', screenId: firstOf('dcui') } : { ...base, flow: 'installer', screenId: firstOf('installer') });
    return ok();
  }
  if (!cur) return no(flow('console-not-open', `Konzole serveru ${srv.id} není otevřená.`));
  if (cmd.type === 'closeConsole') {
    if (!cur.open) return no(flow('nothing-to-do', 'Konzole už je zavřená.'));
    put(tx, { ...cur, open: false });
    return ok();
  }
  // consoleKey
  if (!cur.open) return no(flow('console-not-open', `Konzole serveru ${srv.id} není otevřená.`));
  const sc = screen(cur.screenId);
  const def = sc.keys.find((k) => k.key === cmd.key);
  if (!def) return no(flow('console-key', `Klávesa ${cmd.key} na obrazovce „${sc.title}“ nic nedělá.`));
  const count = sc.menu?.length ?? (sc.input === 'disk' ? serverDisks(ctx.catalog, srv).length : sc.input === 'keyboard' ? CONSOLE_SCREENS.keyboardLayouts.length : 0);
  if ((cmd.key === 'Up' || cmd.key === 'Down') && def.action === undefined) {
    const sel = count > 0 ? (cur.selection + (cmd.key === 'Up' ? count - 1 : 1)) % count : 0;
    put(tx, { ...cur, selection: sel });
    return ok();
  }
  if (def.action === undefined) {
    if (cmd.key === 'Space') return ok();
    put(tx, go(cur, def.next ?? cur.screenId));
    return ok();
  }
  return runAction(tx, cur, srv, def, cmd.value, ctx);
}

function runAction(tx: Tx, cur: ConsoleState, srv: PhysicalServer, def: ConsoleKeyDef, value: ConsoleValue | undefined, ctx: SandboxContext): CommandResult {
  const next = def.next ?? cur.screenId;
  const stay = (message: ConsoleMessage): CommandResult => {
    put(tx, { ...cur, message });
    return ok();
  };
  switch (def.action!) {
    case 'disk-details': {
      const d = serverDisks(ctx.catalog, srv)[cur.selection];
      return stay({ level: 'info', text: d ? `${d.label} · ${d.capacityGB} GB · ${d.kind === 'boot' ? 'boot zařízení' : 'datový disk'}` : 'Žádný disk.' });
    }
    case 'select-disk':
    case 'select-osdata': {
      const disks = serverDisks(ctx.catalog, srv);
      const id = strValue(value) ?? disks[cur.selection]?.id;
      const d = disks.find((x) => x.id === id);
      if (!d) return stay(err('Vyber disk ze seznamu.'));
      if (def.action === 'select-osdata') {
        if (d.usbSd || d.capacityGB < 32) return stay(err('Pro ESX OSData vyber trvalé úložiště s aspoň 32 GB.', '26-esx-install §4.1 I-6c [E4]'));
        put(tx, go(cur, next, { osDataDisk: d.id }));
        return ok();
      }
      // SD / USB install disk needs an OSData device (26 §4.1 I-6c)
      const target = d.usbSd ? 'select-osdata' : next;
      const hint: ConsoleMessage | undefined =
        d.kind === 'data' ? { level: 'hint', text: 'Herní nápověda: datové (vSAN) disky nech volné – ESX patří na boot zařízení.' } : undefined;
      put(tx, { ...go(cur, target, { disk: d.id }), ...(hint ? { message: hint } : {}) });
      return ok();
    }
    case 'set-keyboard': {
      const layouts = CONSOLE_SCREENS.keyboardLayouts;
      const k = strValue(value) ?? layouts[cur.selection] ?? layouts[0]!;
      if (!layouts.includes(k)) return stay(err(`Rozložení ${k} není v nabídce.`));
      put(tx, go(cur, next, { keyboard: k }));
      return ok();
    }
    case 'set-password':
    case 'change-password': {
      const pw = strValue(value) ?? '';
      const problems = checkEsxRootPassword(pw);
      if (problems.length) return stay(err(problems.join(' '), ESX_ROOT_PASSWORD_REF));
      put(tx, go(cur, next, { rootPassword: pw }));
      return ok();
    }
    case 'install': {
      const r = applyRoom(tx, { type: 'installEsx', serverId: srv.id, method: cur.method }, ctx);
      if (!r.ok) {
        const text = r.rejection.kind === 'flow' ? r.rejection.message : r.rejection.kind === 'validation' ? r.rejection.issues.map((i) => i.message).join(' ') : 'Instalaci nelze spustit.';
        put(tx, { ...go(cur, 'operation-failed'), message: err(text) });
        return ok();
      }
      const disks = serverDisks(ctx.catalog, srv);
      tx.s = {
        ...tx.s,
        installTemplate: {
          fromServerId: srv.id,
          method: cur.method,
          keyboard: cur.keyboard ?? CONSOLE_SCREENS.keyboardLayouts[0]!,
          rootPassword: cur.rootPassword ?? '',
          diskKind: disks.find((d) => d.id === cur.disk)?.kind ?? 'boot',
          fingerprint: configFingerprint(srv.config),
        },
      };
      put(tx, go(cur, next));
      return ok();
    }
    case 'reboot':
      put(tx, go(cur, next, { flow: 'dcui', loggedIn: false }));
      return ok();
    case 'login': {
      const pw = strValue(value) ?? '';
      // Unknown password (ESX installed without the console): any non-empty password (game).
      if (pw === '' || (cur.rootPassword !== undefined && pw !== cur.rootPassword)) return stay(err('Přihlášení se nepovedlo – zadej root heslo z instalace.', '26-esx-install §4.3 D-2 [E31]'));
      put(tx, go(cur, next, { loggedIn: true }));
      return ok();
    }
    case 'logout':
      put(tx, go(cur, next, { loggedIn: false }));
      return ok();
    case 'menu-enter': {
      const sc = screen(cur.screenId);
      const item = sc.menu?.[cur.selection];
      if (!item) return stay(err('Vyber položku menu.'));
      const draft = item.action === 'mgmt-begin' ? { draft: cur.draft ?? draftOf(srv) } : {};
      put(tx, go(cur, item.next, draft));
      return ok();
    }
    case 'mgmt-begin':
      put(tx, go(cur, next, { draft: draftOf(srv) }));
      return ok();
    case 'mgmt-exit': {
      const changed = JSON.stringify(cur.draft ?? {}) !== JSON.stringify(draftOf(srv));
      put(tx, go(cur, changed ? next : 'dcui-menu'));
      return ok();
    }
    case 'save-form': {
      const sc = screen(cur.screenId);
      const v = typeof value === 'object' ? value : {};
      const patch: Record<string, string> = {};
      for (const f of sc.fields ?? []) {
        const x = v[f.id];
        if (x !== undefined) patch[f.id] = x.trim();
        else if (!f.optional && (cur.draft as Record<string, string | undefined> | undefined)?.[f.id] === undefined) return stay(err(`Vyplň pole ${f.label}.`));
      }
      if (patch['vlan'] !== undefined && patch['vlan'] !== '') {
        const n = Number(patch['vlan']);
        if (!Number.isInteger(n) || n < 1 || n > 4094) return stay(err('VLAN ID musí být 1 až 4094.', '26-esx-install §4.3 D-5b [E22]'));
      }
      for (const k of ['ip', 'mask', 'gw', 'dns1', 'dns2'] as const)
        if (patch[k] !== undefined && patch[k] !== '' && parseIpv4(patch[k]!) === undefined) return stay(err(`${k.toUpperCase()}: neplatná IPv4 adresa.`));
      put(tx, go(cur, next, { draft: { ...(cur.draft ?? draftOf(srv)), ...patch } }));
      return ok();
    }
    case 'discard-mgmt': {
      const { draft: _d, ...rest } = go(cur, next);
      void _d;
      put(tx, rest);
      return ok();
    }
    case 'apply-mgmt': {
      const d = cur.draft ?? draftOf(srv);
      const vmnics = list(d.vmnics).map(Number);
      const curUplinks = srv.hostNet?.switches.find((x) => x.name === 'vSwitch0')?.uplinks ?? [];
      if (vmnics.length && JSON.stringify(vmnics) !== JSON.stringify(curUplinks)) {
        const r = applyRoom(tx, { type: 'setHostUplinks', serverId: srv.id, vmnics }, ctx);
        if (!r.ok) return stay(err(rejectionText(r)));
      }
      const r = applyRoom(
        tx,
        {
          type: 'configureMgmtNetwork',
          serverId: srv.id,
          ip: d.ip ?? '',
          mask: d.mask ?? '',
          gw: d.gw ?? '',
          vlan: d.vlan ? Number(d.vlan) : null,
          dns: [d.dns1 ?? '', d.dns2 ?? ''].filter((x) => x !== ''),
          hostname: d.hostname ?? '',
          customDnsSuffixes: list(d.suffixes),
        },
        ctx,
      );
      if (!r.ok) {
        put(tx, { ...(tx.s.consoles?.[srv.id] ?? cur), message: err(rejectionText(r)) });
        return ok();
      }
      const { draft: _d, ...rest } = go(tx.s.consoles?.[srv.id] ?? cur, next);
      void _d;
      put(tx, { ...rest, message: { level: 'info', text: 'Management síť uložena.' } });
      return ok();
    }
    case 'restart-network':
      put(tx, { ...go(cur, next), message: { level: 'info', text: 'Management síť restartována (krátký výpadek sítě).', specRef: '26-esx-install §5.4 [E26]' } });
      return ok();
    case 'test-network': {
      const r = applyRoom(tx, { type: 'testManagementNetwork', serverId: srv.id }, ctx);
      if (!r.ok) return stay(err(rejectionText(r)));
      put(tx, { ...go(tx.s.consoles?.[srv.id] ?? cur, next), message: { level: 'info', text: 'Test management sítě běží.' } });
      return ok();
    }
  }
}

const rejectionText = (r: Extract<CommandResult, { ok: false }>): string =>
  r.rejection.kind === 'flow' ? r.rejection.message : r.rejection.kind === 'validation' ? r.rejection.issues.map((i) => i.message).join(' ') : 'Akce odmítnuta.';

// ===========================================================================
// Batch install (UX 20.3)
// ===========================================================================

export interface BatchCandidate {
  readonly serverId: string;
  readonly eligible: boolean;
  /** Czech reason when not eligible (e.g. "esx05 má jiné disky, instaluj ručně"). */
  readonly reason?: string;
}

/** Hosts the template can be applied to: mounted, no ESX, not busy; same configuration as the template host. */
export function batchCandidates(s: SandboxState): BatchCandidate[] {
  const t = s.installTemplate;
  if (!t) return [];
  return s.room.physical.servers
    .filter((x) => x.id !== t.fromServerId && x.mount !== undefined && x.esx.esxVersion === undefined)
    .map((x): BatchCandidate => {
      if (serverTask(s, x.id)) return { serverId: x.id, eligible: false, reason: `Na ${x.id} právě běží úloha.` };
      if (configFingerprint(x.config) !== t.fingerprint) return { serverId: x.id, eligible: false, reason: `${x.id} má jinou konfiguraci (disky / sestavu), instaluj ručně.` };
      return { serverId: x.id, eligible: true };
    });
}

function installBatch(tx: Tx, ids: readonly string[] | undefined, ctx: SandboxContext): CommandResult {
  const t = tx.s.installTemplate;
  if (!t) return no(flow('no-install-template', 'Nejdřív nainstaluj ESX na jeden host ručně v konzoli.'));
  const cands = batchCandidates(tx.s);
  const wanted = ids ?? cands.filter((c) => c.eligible).map((c) => c.serverId);
  if (wanted.length === 0) return no(flow('nothing-to-do', 'Žádný další host pro hromadnou instalaci.'));
  for (const id of wanted) {
    const c = cands.find((x) => x.serverId === id);
    if (!c) return no(flow('invalid-input', `${id} nejde instalovat hromadně (není v racku, už má ESX nebo je to vzorový host).`));
    if (!c.eligible) return no(flow('invalid-input', c.reason ?? `${id} nejde instalovat hromadně.`));
  }
  const created: string[] = [];
  for (const id of wanted) {
    const r = applyRoom(tx, { type: 'installEsx', serverId: id, method: t.method }, ctx);
    if (!r.ok) return r;
    const prev = tx.s.consoles?.[id];
    put(tx, { serverId: id, open: prev?.open ?? false, flow: 'installer', screenId: 'installing', method: t.method, selection: 0, loggedIn: false, keyboard: t.keyboard, rootPassword: t.rootPassword, disk: 'boot' });
    created.push(id);
  }
  tx.log({ kind: 'system', ok: true, message: `Hromadná instalace ESX se stejnými volbami jako ${t.fromServerId} (herní zrychlení): ${created.join(', ')}.` });
  return { ok: true, warnings: [], created };
}

/** Task hook: ESX install of `serverId` finished (ok) or could not be completed. */
export function onEsxInstallFinished(s: SandboxState, serverId: string, okDone: boolean): SandboxState {
  const c = s.consoles?.[serverId];
  if (!c || c.flow !== 'installer' || c.screenId !== 'installing') return s;
  const nextC: ConsoleState = okDone ? go(c, 'complete') : { ...go(c, 'operation-failed'), message: err('Instalaci ESX nelze dokončit.') };
  return { ...s, consoles: { ...s.consoles, [serverId]: nextC } };
}

export function describeConsole(cmd: ConsoleCommand): string {
  switch (cmd.type) {
    case 'openConsole':
      return `${cmd.serverId}: konzole otevřena`;
    case 'closeConsole':
      return `${cmd.serverId}: konzole zavřena`;
    case 'consoleKey':
      return `${cmd.serverId}: konzole – ${cmd.key}`;
    case 'installEsxBatch':
      return 'Hromadná instalace ESX se stejnými volbami';
  }
}

// ===========================================================================
// View
// ===========================================================================

export interface ConsoleView {
  readonly serverId: string;
  readonly open: boolean;
  readonly flow: 'installer' | 'dcui';
  readonly method: EsxInstallMethod;
  readonly screen: EsxConsoleScreen;
  readonly selection: number;
  /** Installer progress "krok n / N" (installer flow only; 1-based index in the installer sequence). */
  readonly step?: { readonly index: number; readonly total: number };
  readonly disks?: readonly ConsoleDisk[];
  readonly keyboardLayouts?: readonly string[];
  /** Prefilled form values (DCUI forms: management network draft). */
  readonly values?: Readonly<Record<string, string>>;
  /** Live lines of the DCUI home screen (host name, IP – model state). */
  readonly info: readonly string[];
  readonly loggedIn: boolean;
  readonly message?: ConsoleMessage;
  /** Task id while ESX installs (progress: snapshot.tasks). */
  readonly taskId?: string;
}

export interface ConsolesView {
  readonly byServer: Readonly<Record<string, ConsoleView>>;
  /** "Instalovat stejně na…" (UX 20.3). */
  readonly batch: { readonly template?: Omit<InstallTemplate, 'rootPassword'>; readonly candidates: readonly BatchCandidate[] };
}

export function consolesView(s: SandboxState, catalog: HardwareCatalog): ConsolesView {
  const byServer: Record<string, ConsoleView> = {};
  for (const c of Object.values(s.consoles ?? {})) {
    const srv = s.room.physical.servers.find((x) => x.id === c.serverId);
    if (!srv) continue;
    const sc = screen(c.screenId);
    const idx = CONSOLE_SCREENS.installer.findIndex((x) => x.id === sc.id);
    const vmk0 = srv.hostNet?.vmks.find((v) => v.name === 'vmk0');
    const task = serverTask(s, srv.id);
    const info = c.flow === 'dcui' && sc.id === 'dcui-home' ? [srv.esx.network?.hostnameFqdn ?? 'localhost', vmk0?.ipv4 ? `http://${vmk0.ipv4}/ (${vmk0.addressing === 'static' ? 'STATIC' : 'DHCP'})` : 'IP: –'] : [];
    byServer[c.serverId] = {
      serverId: c.serverId,
      open: c.open,
      flow: c.flow,
      method: c.method,
      screen: sc,
      selection: c.selection,
      ...(idx >= 0 ? { step: { index: idx + 1, total: CONSOLE_SCREENS.installer.length } } : {}),
      ...(sc.input === 'disk' ? { disks: serverDisks(catalog, srv) } : {}),
      ...(sc.input === 'keyboard' ? { keyboardLayouts: CONSOLE_SCREENS.keyboardLayouts } : {}),
      ...(sc.input === 'form' ? { values: Object.fromEntries((sc.fields ?? []).map((f) => [f.id, (c.draft as Record<string, string | undefined> | undefined)?.[f.id] ?? ''])) } : {}),
      info,
      loggedIn: c.loggedIn,
      ...(c.message ? { message: c.message } : {}),
      ...(task ? { taskId: task.id } : {}),
    };
  }
  const t = s.installTemplate;
  const template = t ? (({ rootPassword: _p, ...rest }) => rest)(t) : undefined;
  return { byServer, batch: { ...(template ? { template } : {}), candidates: batchCandidates(s) } };
}
