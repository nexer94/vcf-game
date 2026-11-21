/**
 * Pure data helpers of the object panels (server / DCUI / switch / DNS / host detail / "Ukaž mi").
 * No DOM, no VCF rules: everything comes from the SandboxSnapshot (model views) – this file only arranges it for
 * display, parses form input and picks prefill values whose provenance is labelled (documented vs game default).
 */
import { ESX_INSTALL_DEFAULTS, type FlowTrafficClass, type HwFinding, type VmkService } from '../../model';
import type { SandboxSnapshot, TaskView } from '../../modes/sandbox/snapshot';
import type { ServerView, SwitchPortView, SwitchView } from '../../modes/sandbox/roomView';
import type { RoomView } from './roomViews';

// ---------------------------------------------------------------------------
// Provenance of a prefilled value (UX §2.6 / §3.2 badges)
// ---------------------------------------------------------------------------

export type Provenance =
  /** Value of the current configuration (no badge). */
  | { readonly kind: 'current' }
  /** Documented default (badge "dokumentace" + spec ref). */
  | { readonly kind: 'documented'; readonly specRef: string }
  /** Chosen by the game (badge "herní výchozí"). */
  | { readonly kind: 'game-default'; readonly note?: string };

export interface Prefilled<T> {
  readonly value: T;
  readonly source: Provenance;
}

// ---------------------------------------------------------------------------
// DCUI form
// ---------------------------------------------------------------------------

export interface DcuiDraft {
  hostname: string;
  ip: string;
  mask: string;
  gw: string;
  /** '' = no VLAN ID set. */
  vlan: string;
  dns1: string;
  dns2: string;
  /** Comma / space separated. */
  suffixes: string;
}

export type DcuiSources = Readonly<Record<keyof DcuiDraft, Provenance>>;

/** GAME DEFAULT prefill of the DCUI form (hostname / IP plan are the game's, never documentation). */
export const DCUI_GAME_PLAN = { domain: 'lab.example', firstHostOctet: 11, mask: '255.255.255.0' } as const;

const ipv4Re = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** Same /24 prefix as `ref` with the last octet replaced (game IP plan helper; no subnet rule). */
export function hostIpInPlan(ref: string | undefined, octet: number): string {
  const m = ref ? ipv4Re.exec(ref) : null;
  const prefix = m ? `${m[1]}.${m[2]}.${m[3]}` : '10.0.0';
  return `${prefix}.${Math.min(254, Math.max(1, octet))}`;
}

/**
 * Prefill of the DCUI "Configure Management Network" form:
 *  - current values when the network is already configured (no badge),
 *  - otherwise game defaults (IP plan next to the company network gateway, its DNS) and the documented
 *    "no VLAN ID set" default (ESX_INSTALL_DEFAULTS.managementVlan).
 */
export function dcuiPrefill(snap: SandboxSnapshot, serverId: string): { draft: DcuiDraft; sources: DcuiSources } {
  const servers = snap.physical.servers;
  const v = servers.find((x) => x.id === serverId);
  const n = v?.esx.network;
  const cur: Provenance = { kind: 'current' };
  if (n) {
    return {
      draft: {
        hostname: n.hostnameFqdn,
        ip: n.ipv4Address,
        mask: n.subnetMask,
        gw: n.defaultGateway,
        vlan: n.vlanId !== undefined ? String(n.vlanId) : '',
        dns1: n.dnsServers[0] ?? '',
        dns2: n.dnsServers[1] ?? '',
        suffixes: n.customDnsSuffixes.join(', '),
      },
      sources: { hostname: cur, ip: cur, mask: cur, gw: cur, vlan: cur, dns1: cur, dns2: cur, suffixes: cur },
    };
  }
  const gw = snap.physical.endpoints.find((e) => e.kind === 'gateway')?.ipv4;
  const dns = snap.physical.endpoints.find((e) => e.kind === 'dns')?.ipv4;
  const idx = Math.max(0, servers.findIndex((x) => x.id === serverId));
  const game = (note?: string): Provenance => ({ kind: 'game-default', ...(note ? { note } : {}) });
  const noNet = 'síť firmy zatím není připojená – hodnota je jen herní návrh';
  return {
    draft: {
      hostname: `${serverId.toLowerCase()}.${DCUI_GAME_PLAN.domain}`,
      ip: hostIpInPlan(gw, DCUI_GAME_PLAN.firstHostOctet + idx),
      mask: DCUI_GAME_PLAN.mask,
      gw: gw ?? hostIpInPlan(undefined, 1),
      vlan: '',
      dns1: dns ?? '',
      dns2: '',
      suffixes: '',
    },
    sources: {
      hostname: game(),
      ip: game('herní IP plán'),
      mask: game(),
      gw: game(gw ? 'gateway sítě firmy (herní)' : noNet),
      vlan: { kind: 'documented', specRef: ESX_INSTALL_DEFAULTS.managementVlan.specRef },
      dns1: game(dns ? 'DNS server sítě firmy (herní)' : noNet),
      dns2: game(),
      suffixes: game(),
    },
  };
}

/** Splits a comma / space separated list (form input parsing only). */
export const splitList = (s: string): string[] => s.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);

/** Integer parse of a form field; undefined = empty / not an integer. */
export function intOf(s: string): number | undefined {
  const t = s.trim();
  if (!/^-?\d+$/.test(t)) return undefined;
  return Number(t);
}

/** Trunk allowed VLAN list input: "all" / "" -> 'all', "10, 20-22" -> [10, 20, 21, 22]; null = unparsable. */
export function parseVlanList(s: string): 'all' | number[] | null {
  const t = s.trim().toLowerCase();
  if (t === '' || t === 'all' || t === 'vše' || t === 'vse') return 'all';
  const out: number[] = [];
  for (const part of t.split(/[\s,;]+/).filter(Boolean)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) return null;
    const a = Number(m[1]);
    const b = m[2] !== undefined ? Number(m[2]) : a;
    if (b < a || b - a > 4094) return null;
    for (let v = a; v <= b; v++) out.push(v);
  }
  return [...new Set(out)].sort((x, y) => x - y);
}

/** Compact VLAN list for display: [10, 11, 12, 20] -> "10-12, 20". */
export function formatVlanList(v: 'all' | readonly number[]): string {
  if (v === 'all') return 'all';
  if (!v.length) return '–';
  const out: string[] = [];
  let start = v[0]!;
  let prev = start;
  for (let i = 1; i <= v.length; i++) {
    const x = v[i];
    if (x !== undefined && x === prev + 1) {
      prev = x;
      continue;
    }
    out.push(start === prev ? String(start) : `${start}-${prev}`);
    if (x !== undefined) start = prev = x;
  }
  return out.join(', ');
}

// ---------------------------------------------------------------------------
// Hardware findings (15 §5): REQ / DEV / RCMD -> message types (UX §3.2)
// ---------------------------------------------------------------------------

export type FindingMessage = 'vcf-error' | 'vcf-warning' | 'game-limit';

export function findingMessageType(f: HwFinding): FindingMessage {
  if (f.scope === 'game-scope') return 'game-limit';
  return f.hwClass === 'REQ' ? 'vcf-error' : 'vcf-warning';
}

export const HW_CLASS_TITLE: Readonly<Record<HwFinding['hwClass'], string>> = {
  REQ: 'Požadavek (REQ) – podle dokumentace nelze',
  DEV: 'Podporovaná odchylka (DEV)',
  RCMD: 'Odchylka od doporučení (RCMD)',
};

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export function serverTaskOf(snap: SandboxSnapshot, serverId: string): TaskView | undefined {
  return snap.tasks.find((t) => t.serverId === serverId);
}

// ---------------------------------------------------------------------------
// Host detail (UX §12.4): VMkernel band -> virtual switches -> vmnic cards -> switch ports
// ---------------------------------------------------------------------------

export const VMK_SERVICES: readonly { readonly service: VmkService; readonly label: string; readonly cls: FlowTrafficClass }[] = [
  { service: 'management', label: 'Management', cls: 'management' },
  { service: 'vmotion', label: 'vMotion', cls: 'vmotion' },
  { service: 'vsan', label: 'vSAN', cls: 'vsan' },
  { service: 'nfs', label: 'NFS', cls: 'nfs' },
  { service: 'host-tep', label: 'Host TEP', cls: 'overlay' },
];

export interface MtuLink {
  readonly label: string;
  readonly mtu: number | undefined;
  /** This link is smaller than the VMkernel MTU at the start of the chain (display only). */
  readonly short: boolean;
}

export interface VmnicCard {
  readonly vmnic: number;
  readonly label: string;
  readonly cabled: boolean;
  readonly linkUp: boolean;
  readonly speedGbE?: number;
  readonly speedsGbE: readonly number[];
  /** Virtual switch that uses the vmnic as uplink (name). */
  readonly vswitch?: string;
  readonly peerLabel?: string;
  readonly port?: { readonly switchId: string; readonly index: number; readonly view: SwitchPortView; readonly switchLabel: string };
  /** Illustrative load (Gbit/s) per class from snapshot.flows.uplinks. */
  readonly loadByClass: Readonly<Partial<Record<FlowTrafficClass, number>>>;
  readonly utilization: number;
  /** vmk -> vSwitch -> switch port (only for vmnics carrying a VMkernel adapter's switch). */
  readonly mtuChain: readonly MtuLink[];
}

export interface HostNetBands {
  readonly vmks: readonly {
    readonly service: VmkService;
    readonly label: string;
    readonly cls: FlowTrafficClass;
    readonly vmk?: NonNullable<ServerView['hostNet']>['vmks'][number];
  }[];
  readonly switches: NonNullable<ServerView['hostNet']>['switches'];
  readonly cards: readonly VmnicCard[];
  readonly bmc: { readonly label: string; readonly peerLabel?: string; readonly ip?: string };
}

export function hostNetBands(snap: PanelSnap, serverId: string): HostNetBands | undefined {
  const srv = snap.physical.servers.find((x) => x.id === serverId);
  if (!srv) return undefined;
  const hn = srv.hostNet;
  const vmks = hn?.vmks ?? [];
  const switches = hn?.switches ?? [];
  const bandVmks = VMK_SERVICES.filter((s) => s.service !== 'nfs' || vmks.some((v) => v.service === 'nfs')).map((s) => {
    const vmk = vmks.find((v) => v.service === s.service);
    return { ...s, ...(vmk ? { vmk } : {}) };
  });
  const uplinks = snap.flows.uplinks.filter((u) => u.serverId === serverId);
  const cards = srv.nicPorts.map((n): VmnicCard => {
    const vs = switches.find((w) => w.uplinks.includes(n.vmnic));
    const up = uplinks.find((u) => u.port.kind === 'server-nic' && u.port.vmnic === n.vmnic);
    let port: VmnicCard['port'];
    if (n.peer?.kind === 'switch') {
      const peer = n.peer;
      const sw = snap.physical.switches.find((x) => x.id === peer.switchId);
      const pv = sw?.ports[peer.port];
      if (sw && pv) port = { switchId: sw.id, index: peer.port, view: pv, switchLabel: sw.id };
    }
    const vmkOnSwitch = vs ? vmks.filter((v) => v.switchName === vs.name) : [];
    const startMtu = vmkOnSwitch.length ? Math.max(...vmkOnSwitch.map((v) => v.mtu)) : undefined;
    const chain: MtuLink[] = [];
    if (vs && startMtu !== undefined) {
      chain.push({ label: vmkOnSwitch.map((v) => v.name).join(' / '), mtu: startMtu, short: false });
      chain.push({ label: vs.name, mtu: vs.mtu, short: vs.mtu < startMtu });
      chain.push({ label: port ? `${port.switchLabel} p${port.index + 1}` : 'port switche', mtu: port?.view.config.mtu, short: port !== undefined && port.view.config.mtu < startMtu });
    }
    return {
      vmnic: n.vmnic,
      label: n.label,
      cabled: n.cableId !== undefined,
      linkUp: n.link?.up === true,
      ...(n.link?.speedGbE !== undefined ? { speedGbE: n.link.speedGbE } : {}),
      speedsGbE: n.speedsGbE,
      ...(vs ? { vswitch: vs.name } : {}),
      ...(n.peerLabel !== undefined ? { peerLabel: n.peerLabel } : {}),
      ...(port ? { port } : {}),
      loadByClass: up?.loadGbpsByClass ?? {},
      utilization: up?.utilization ?? 0,
      mtuChain: chain,
    };
  });
  return {
    vmks: bandVmks,
    switches,
    cards,
    bmc: { label: srv.bmc.label, ...(srv.bmcPort.peerLabel !== undefined ? { peerLabel: srv.bmcPort.peerLabel } : {}), ...(srv.bmc.ipv4 !== undefined ? { ip: srv.bmc.ipv4 } : {}) },
  };
}

// ---------------------------------------------------------------------------
// Tracker "Ukaž mi" (objective showMe hints)
// ---------------------------------------------------------------------------

export type ShowMeAction =
  | { readonly kind: 'view'; readonly view: RoomView }
  | { readonly kind: 'server'; readonly serverId: string; readonly rackId?: string; readonly tab: ServerTab }
  | { readonly kind: 'switch'; readonly switchId: string; readonly rackId?: string }
  | { readonly kind: 'dns' }
  | { readonly kind: 'inventory'; readonly tab: ShopTab }
  | { readonly kind: 'none'; readonly reason: string };

/** Shop / backpack tabs (ui/sandbox/shop.ts). Lives here so DOM-free code and tests can use it. */
export type ShopTab = 'backpack' | 'racks' | 'servers' | 'switches' | 'cables' | 'drives' | 'nics';

export type ServerTab = 'overview' | 'hardware' | 'esx' | 'dcui' | 'bmc';

const SHOP_TABS: readonly ShopTab[] = ['backpack', 'racks', 'servers', 'switches', 'cables', 'drives', 'nics'];
/** PC app ids of the room view `pocitac/<app>` (rendered by the PC module). */
const PC_APPS: Readonly<Record<string, string>> = { pc: 'plocha', 'pc/navrh': 'navrh', 'pc/use-case': 'use-case' };

/** Snapshot subset used by showMe (keeps tests small). */
export type PanelSnap = Pick<SandboxSnapshot, 'physical' | 'flows'>;

/** Server the tracker most likely means: first mounted server that is not finished with the given step. */
function pickServer(snap: PanelSnap, tab: ServerTab): ServerView | undefined {
  const mounted = snap.physical.servers.filter((s) => s.mount);
  const pending = mounted.find((s) => {
    if (tab === 'esx') return s.status === 'no-os';
    if (tab === 'bmc') return s.bmc.ipv4 === undefined;
    return s.status === 'esx-dhcp' || s.status === 'esx-static';
  });
  return pending ?? mounted[0];
}

/** Server panel tab for an objective id (UI mapping of scenario ids; unknown = DCUI). */
export function tabForObjective(id: string | undefined): ServerTab {
  if (!id) return 'dcui';
  if (/\besx$|hosts\.esx\b|install/.test(id)) return 'esx';
  if (/bmc/.test(id)) return 'bmc';
  if (/hw|hardware/.test(id)) return 'hardware';
  return 'dcui';
}

export function resolveShowMe(showMe: Readonly<Record<string, string>> | undefined, snap: PanelSnap, objectiveId?: string): ShowMeAction {
  if (!showMe) return { kind: 'none', reason: 'Úkol nemá nápovědu „Ukaž mi“.' };
  const placedRacks = snap.physical.racks.filter((r) => r.placed);
  const rackWith = (deviceId: string): string | undefined => {
    const m = snap.physical.servers.find((s) => s.id === deviceId)?.mount ?? snap.physical.switches.find((s) => s.id === deviceId)?.mount;
    return m && placedRacks.some((r) => r.id === m.rackId) ? m.rackId : undefined;
  };
  if (showMe['panel'] !== undefined) {
    const p = showMe['panel'];
    if (p === 'dns') return { kind: 'dns' };
    if (p === 'host') {
      const tab = tabForObjective(objectiveId);
      const s = pickServer(snap, tab);
      if (!s) return { kind: 'none', reason: 'Nejdřív zarackuj server.' };
      const rackId = rackWith(s.id);
      return { kind: 'server', serverId: s.id, tab, ...(rackId ? { rackId } : {}) };
    }
    if (p === 'switch') {
      const sw: SwitchView | undefined = snap.physical.switches.find((x) => x.mount) ?? snap.physical.switches[0];
      if (!sw) return { kind: 'none', reason: 'Nejdřív kup a zarackuj switch.' };
      const rackId = rackWith(sw.id);
      return { kind: 'switch', switchId: sw.id, ...(rackId ? { rackId } : {}) };
    }
  }
  if (showMe['view'] !== undefined) {
    const v = showMe['view'];
    if (v === 'room') return { kind: 'view', view: { kind: 'room' } };
    if (v in PC_APPS) return { kind: 'view', view: { kind: 'pc', app: PC_APPS[v]! } };
    if (v === 'rack') {
      const withServer = placedRacks.find((r) => r.devices.some((d) => d.kind === 'server'));
      const r = withServer ?? placedRacks[0];
      if (!r) return { kind: 'inventory', tab: 'racks' };
      return { kind: 'view', view: { kind: 'rack', rackId: r.id } };
    }
  }
  if (showMe['inventory'] !== undefined) {
    const t = showMe['inventory'] as ShopTab;
    if (SHOP_TABS.includes(t)) return { kind: 'inventory', tab: t };
  }
  return { kind: 'none', reason: 'Tuhle nápovědu zatím neumím ukázat.' };
}
