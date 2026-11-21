/**
 * Auto High-Level Design on the whiteboard (UX.md §10.2) – pure layout, no PixiJS.
 *
 * Input is a plain description of the current game state (`BoardInput`, mapped from the Sandbox snapshot by
 * ui/whiteboard/boardInput.ts). The layout only places boxes and lines; every text it shows comes from the input.
 * Undecided things are dashed boxes with "?" (not errors). Layout is deterministic and stable: objects are placed
 * in input order (new objects are appended), so player notes keep their place.
 *
 * Virtual board 1600 × 1000: the auto diagram stays left of NOTES_X (the right strip belongs to the player).
 */
import { NOTES_X, type BoardPage } from './notes';
import type { Pt } from './sketch';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** Traffic colour key of a network (same palette as the packets, GRAPHICS.md). */
export type BoardTraffic = 'management' | 'vmotion' | 'vsan' | 'nfs' | 'overlay' | 'vm';

export interface BoardRack {
  readonly id: string;
  readonly label: string;
}

export interface BoardSwitch {
  readonly id: string;
  readonly label: string;
  readonly ports: number;
  readonly rackId?: string;
  /** Distinct MTUs of cabled ports (only known values). */
  readonly mtus: readonly number[];
  /** VLAN summary of cabled ports, e.g. "trunk 10,20" / "access 1". */
  readonly vlanSummary: readonly string[];
}

export interface BoardHostLink {
  readonly switchId: string;
  readonly nic: string;
  readonly up: boolean;
}

export interface BoardHost {
  readonly id: string;
  readonly label: string;
  readonly vendor?: string;
  readonly rackId?: string;
  readonly nicTotal: number;
  readonly links: readonly BoardHostLink[];
  /** BMC cable to a switch (out of VCF scope – game). Only on the Fyzicky page. */
  readonly bmcSwitchId?: string;
  readonly esx: boolean;
  /** First model validation problem of the host (message + spec ref). */
  readonly problem?: { readonly message: string; readonly specRef: string };
}

export interface BoardNetwork {
  readonly id: string;
  readonly name: string;
  readonly traffic: BoardTraffic | null;
  readonly vlan?: number | null;
  readonly subnet?: string;
  readonly gateway?: string;
  readonly mtu?: number;
  readonly hosts: readonly string[];
  /** Where the value comes from: DCUI of the hosts, the planned networks, … */
  readonly source: string;
  /** Some value was chosen by the game (label "herní výchozí"). */
  readonly gameDefault?: boolean;
}

export interface BoardComponent {
  readonly name: string;
  readonly count?: number;
}

export interface BoardDomain {
  readonly kind: 'management' | 'workload';
  readonly label: string;
  /** "min. 4 hosty (návrh)" etc. – text from the design summary; undefined = not decided. */
  readonly clusterNote?: string;
  readonly components: readonly BoardComponent[];
}

export interface BoardLogical {
  /** At least one design decision made. */
  readonly decided: boolean;
  readonly fleetLabel: string;
  readonly instances?: number;
  readonly domains: readonly BoardDomain[];
  readonly hostsInRoom: number;
  readonly deployed: boolean;
}

export interface BoardInput {
  readonly racks: readonly BoardRack[];
  readonly switches: readonly BoardSwitch[];
  readonly hosts: readonly BoardHost[];
  readonly company: { readonly switchId: string; readonly port: number } | null;
  readonly networks: readonly BoardNetwork[];
  readonly logical: BoardLogical | null;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export type NodeKind = 'cloud' | 'switch' | 'rack' | 'host' | 'group' | 'network' | 'box' | 'unknown';

export interface HldNode {
  readonly id: string;
  readonly kind: NodeKind;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly title: string;
  readonly lines: readonly string[];
  /** Traffic colour key (small coloured square). */
  readonly traffic?: BoardTraffic | null;
  readonly dashed?: boolean;
  /** Validation problem ("!" circled with marker). */
  readonly problem?: string;
  /** Small label like "herní výchozí". */
  readonly badge?: string;
  /** Tooltip lines (pointer tool). */
  readonly tip: readonly string[];
  /** Click target (opens the rack view). */
  readonly rackId?: string;
  /** Container boxes are drawn first and their title sits top-left. */
  readonly container?: boolean;
}

export interface HldEdge {
  readonly id: string;
  readonly a: Pt;
  readonly b: Pt;
  readonly label?: string;
  readonly dashed?: boolean;
  /** 'bmc' = grey (out of VCF scope – game). */
  readonly tone?: 'ink' | 'bmc';
}

export interface HldLayout {
  readonly page: BoardPage;
  readonly nodes: readonly HldNode[];
  readonly edges: readonly HldEdge[];
  /** Nothing in the room yet. */
  readonly empty: boolean;
}

const LEFT = 40;
const RIGHT = NOTES_X - 40;
const WIDTH = RIGHT - LEFT;

const plural = (n: number, one: string, few: string, many: string): string => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);

/** Max hosts drawn one by one inside a rack; more = one group box (UX §10.2 škálování). */
export const MAX_HOSTS_PER_RACK = 8;

export function layoutBoard(input: BoardInput, page: BoardPage): HldLayout {
  if (page === 'sit') return layoutNetwork(input);
  if (page === 'logicky') return layoutLogical(input);
  return layoutPhysical(input);
}

// ---------------------------------------------------------------------------
// Fyzicky: company network -> switches -> racks with hosts
// ---------------------------------------------------------------------------

function layoutPhysical(input: BoardInput): HldLayout {
  const nodes: HldNode[] = [];
  const edges: HldEdge[] = [];
  const empty = input.racks.length === 0 && input.switches.length === 0 && input.hosts.length === 0;
  if (empty) {
    nodes.push({
      id: 'empty', kind: 'unknown', x: 340, y: 380, w: 440, h: 120, dashed: true, title: '? Zatím tu nic není',
      lines: ['Postav rack, kup servery a switch –', 'diagram se nakreslí sám.'], tip: ['Diagram kreslí hra podle tvé serverovny.'],
    });
    return { page: 'fyzicky', nodes, edges, empty };
  }

  // Company network (game abstraction) at the top.
  const cloud: HldNode = {
    id: 'company', kind: 'cloud', x: LEFT + WIDTH / 2 - 150, y: 30, w: 300, h: 110,
    title: 'Síť firmy / uplink',
    lines: input.company ? ['gateway · DNS · NTP (herní abstrakce)'] : ['nepřipojeno – zapoj uplink switche'],
    dashed: !input.company,
    tip: ['Síť firmy – herní abstrakce (gateway, DNS, NTP, admin PC)', input.company ? `Připojeno přes ${input.company.switchId} port ${input.company.port + 1}` : 'Žádný switch není připojený do sítě firmy.'],
  };
  nodes.push(cloud);

  // Switches row.
  const swW = 210;
  const swH = 86;
  const swY = 210;
  const swN = input.switches.length;
  const swGap = swN > 1 ? Math.min(60, (WIDTH - swN * swW) / (swN - 1)) : 0;
  const swFits = swN * swW + Math.max(0, swN - 1) * swGap <= WIDTH;
  const swWidth = swFits ? swW : Math.max(90, (WIDTH - (swN - 1) * 10) / Math.max(1, swN));
  const swRow = swN * swWidth + Math.max(0, swN - 1) * (swFits ? swGap : 10);
  let sx = LEFT + (WIDTH - swRow) / 2;
  const swPos = new Map<string, HldNode>();
  for (const s of input.switches) {
    const n: HldNode = {
      id: `sw:${s.id}`, kind: 'switch', x: sx, y: swY, w: swWidth, h: swH,
      title: s.label, lines: [`${s.ports} ${plural(s.ports, 'port', 'porty', 'portů')}`],
      tip: [`Switch ${s.label}`, `${s.ports} portů (generický)`, ...(s.rackId ? [`v racku ${s.rackId}`] : [])],
      ...(s.rackId ? { rackId: s.rackId } : {}),
    };
    nodes.push(n);
    swPos.set(s.id, n);
    sx += swWidth + (swFits ? swGap : 10);
  }
  if (input.company) {
    const sw = swPos.get(input.company.switchId);
    if (sw) edges.push({ id: 'uplink', a: { x: cloud.x + cloud.w / 2, y: cloud.y + cloud.h - 6 }, b: { x: sw.x + sw.w / 2, y: sw.y }, label: `uplink p${input.company.port + 1}` });
  }

  // Racks with hosts.
  const hostsByRack = new Map<string, BoardHost[]>();
  for (const h of input.hosts) {
    const k = h.rackId ?? '';
    const list = hostsByRack.get(k) ?? [];
    list.push(h);
    hostsByRack.set(k, list);
  }
  const rackList: BoardRack[] = [...input.racks];
  if (hostsByRack.has('')) rackList.push({ id: '', label: 'mimo rack' });
  const hostW = 150;
  const hostH = 122;
  const gap = 10;
  const pad = 14;
  let row = 0;
  let rx = LEFT;
  const rowY = (r: number): number => 380 + r * 196;
  const hostPos = new Map<string, HldNode>();
  const placeRack = (r: BoardRack, hosts: readonly BoardHost[], collapse: boolean): void => {
    const units = collapse ? 1 : Math.max(1, hosts.length);
    const unitW = collapse ? Math.min(WIDTH - 2 * pad, 240) : hostW;
    const w = units * unitW + (units - 1) * gap + pad * 2;
    if (rx + w > RIGHT + 0.5 && rx > LEFT) {
      row += 1;
      rx = LEFT;
    }
    const y = rowY(row);
    nodes.push({
      id: `rack:${r.id || 'none'}`, kind: 'rack', container: true, x: rx, y, w, h: hostH + 56,
      title: r.id ? `Rack ${r.label}` : r.label, lines: [],
      tip: r.id ? [`Rack ${r.label}`, `${hosts.length} ${plural(hosts.length, 'host', 'hosty', 'hostů')}`, 'klik = otevřít rack'] : ['Servery, které nejsou v racku'],
      ...(r.id ? { rackId: r.id } : {}),
    });
    if (collapse) {
      const first = hosts[0]?.label ?? '';
      const last = hosts[hosts.length - 1]?.label ?? '';
      const n: HldNode = {
        id: `group:${r.id}`, kind: 'group', x: rx + pad, y: y + 40, w: unitW, h: hostH,
        title: `${first} … ${last} (${hosts.length})`,
        lines: [`${hosts.filter((h) => h.links.length > 0).length} zapojeno do switche`, `${hosts.filter((h) => h.esx).length} s ESX`],
        tip: hosts.slice(0, 12).map((h) => `${h.label}: ${h.links.length}/${h.nicTotal} uplinků`),
        ...(r.id ? { rackId: r.id } : {}),
      };
      nodes.push(n);
      for (const h of hosts) hostPos.set(h.id, n);
    } else {
      let hx = rx + pad;
      for (const h of hosts) {
        const n: HldNode = {
          id: `host:${h.id}`, kind: 'host', x: hx, y: y + 40, w: hostW, h: hostH,
          title: h.label,
          lines: [h.vendor ?? 'server', `uplinky ${new Set(h.links.map((l) => l.nic)).size}/${h.nicTotal}`, h.esx ? 'ESX' : 'bez OS'],
          ...(h.problem ? { problem: `${h.problem.message} (${h.problem.specRef})` } : {}),
          tip: [`Host ${h.label}`, ...(h.vendor ? [`vendor ${h.vendor}`] : []), ...h.links.map((l) => `${l.nic} → ${l.switchId}${l.up ? '' : ' (link dole)'}`), ...(h.bmcSwitchId ? [`BMC → ${h.bmcSwitchId} (mimo VCF scope – herní)`] : [])],
          ...(h.rackId ? { rackId: h.rackId } : {}),
        };
        nodes.push(n);
        hostPos.set(h.id, n);
        hx += hostW + gap;
      }
    }
    rx += w + 24;
  };
  const tooWide = rackList.length > 4 || input.hosts.length > 24;
  for (const r of rackList) {
    const hosts = hostsByRack.get(r.id) ?? [];
    placeRack(r, hosts, hosts.length > MAX_HOSTS_PER_RACK || (tooWide && hosts.length > 3));
  }

  // Host -> switch edges (aggregated per pair), BMC edges dashed grey.
  const seen = new Set<string>();
  for (const h of input.hosts) {
    const hn = hostPos.get(h.id);
    if (!hn) continue;
    const bySwitch = new Map<string, BoardHostLink[]>();
    for (const l of h.links) bySwitch.set(l.switchId, [...(bySwitch.get(l.switchId) ?? []), l]);
    let i = 0;
    for (const [swId, links] of bySwitch) {
      const sw = swPos.get(swId);
      if (!sw) continue;
      const key = `${hn.id}|${swId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const off = (i++ - (bySwitch.size - 1) / 2) * 18;
      edges.push({
        id: `e:${key}`,
        a: { x: sw.x + sw.w / 2 + off * 0.5, y: sw.y + sw.h },
        b: { x: hn.x + hn.w / 2 + off, y: hn.y },
        ...(hn.kind === 'host' ? { label: links.map((l) => l.nic).join(', ') } : {}),
        dashed: links.every((l) => !l.up),
      });
    }
    if (h.bmcSwitchId) {
      const sw = swPos.get(h.bmcSwitchId);
      const key = `${hn.id}|bmc|${h.bmcSwitchId}`;
      if (sw && !seen.has(key)) {
        seen.add(key);
        edges.push({ id: `b:${key}`, a: { x: sw.x + sw.w - 16, y: sw.y + sw.h }, b: { x: hn.x + hn.w - 14, y: hn.y }, ...(hn.kind === 'host' ? { label: 'BMC' } : {}), dashed: true, tone: 'bmc' });
      }
    }
  }
  return { page: 'fyzicky', nodes, edges, empty };
}

// ---------------------------------------------------------------------------
// Síť: networks with VLAN / subnet / MTU, switch port summary
// ---------------------------------------------------------------------------

function layoutNetwork(input: BoardInput): HldLayout {
  const nodes: HldNode[] = [];
  const colW = 520;
  let y = 30;
  for (const n of input.networks) {
    const facts = [
      n.vlan === undefined ? null : n.vlan === null ? 'bez VLAN tagu' : `VLAN ${n.vlan}`,
      n.subnet ?? null,
      n.gateway ? `GW ${n.gateway}` : null,
      n.mtu ? `MTU ${n.mtu}` : null,
    ].filter((x): x is string => !!x);
    const hostLine = n.hosts.length ? `hosty: ${n.hosts.slice(0, 6).join(', ')}${n.hosts.length > 6 ? ` +${n.hosts.length - 6}` : ''}` : '';
    const lines = [facts.join(' · ') || 'hodnoty zatím nezadané', ...(hostLine ? [hostLine] : []), n.source];
    nodes.push({
      id: `net:${n.id}`, kind: 'network', x: LEFT, y, w: colW, h: 40 + lines.length * 26, title: n.name, lines,
      traffic: n.traffic, ...(n.gameDefault ? { badge: 'herní výchozí' } : {}),
      tip: [n.name, ...facts, n.source],
    });
    y += 40 + lines.length * 26 + 22;
  }
  nodes.push({
    id: 'net:more', kind: 'unknown', x: LEFT, y, w: colW, h: 64, dashed: true,
    title: '? další sítě', lines: ['zatím nerozhodnuto (návrh / installer)'], tip: ['Další sítě se doplní z návrhu a průvodce installeru.'],
  });
  let sy = 30;
  const sx = LEFT + colW + 40;
  const sw = RIGHT - sx;
  for (const s of input.switches) {
    const lines = [s.vlanSummary.length ? `porty: ${s.vlanSummary.join(' · ')}` : 'žádný zapojený port', s.mtus.length ? `MTU ${s.mtus.join(' / ')}` : 'MTU –'];
    nodes.push({ id: `swnet:${s.id}`, kind: 'switch', x: sx, y: sy, w: sw, h: 40 + lines.length * 26, title: s.label, lines, tip: [`Switch ${s.label}`, ...lines], ...(s.rackId ? { rackId: s.rackId } : {}) });
    sy += 40 + lines.length * 26 + 20;
  }
  if (!input.switches.length) nodes.push({ id: 'swnet:none', kind: 'unknown', x: sx, y: sy, w: sw, h: 64, dashed: true, title: '? switche', lines: ['zatím žádný switch'], tip: [] });
  return { page: 'sit', nodes, edges: [], empty: input.networks.length === 0 && input.switches.length === 0 };
}

// ---------------------------------------------------------------------------
// Logicky: fleet -> instance(s) -> domains -> components / cluster
// ---------------------------------------------------------------------------

function layoutLogical(input: BoardInput): HldLayout {
  const nodes: HldNode[] = [];
  const edges: HldEdge[] = [];
  const lg = input.logical;
  if (!lg || !lg.decided) {
    nodes.push({
      id: 'logic:none', kind: 'unknown', x: 260, y: 360, w: 600, h: 140, dashed: true, title: '? Logická architektura',
      lines: ['zatím nerozhodnuto – zvol use case a návrh', 'na počítači (aplikace Návrh VCF).'], tip: ['Kreslí se z návrhu (Návrh VCF) a po bring-upu z nasazení.'],
    });
    return { page: 'logicky', nodes, edges, empty: true };
  }
  nodes.push({
    id: 'fleet', kind: 'box', container: true, x: LEFT, y: 24, w: WIDTH, h: 930, title: lg.fleetLabel,
    lines: [], tip: [lg.fleetLabel, lg.deployed ? 'nasazeno' : 'podle návrhu (ještě nenasazeno)'],
  });
  const inst = lg.instances ?? 1;
  const instW = inst > 1 ? (WIDTH - 60) / 2 : WIDTH - 40;
  for (let i = 0; i < inst; i++) {
    const ix = LEFT + 20 + i * (instW + 20);
    nodes.push({
      id: `inst:${i}`, kind: 'box', container: true, x: ix, y: 70, w: instW, h: 860, title: `VCF Instance ${i + 1}`,
      lines: [], dashed: lg.instances === undefined, tip: [`VCF Instance ${i + 1}`],
    });
    const doms = i === 0 ? lg.domains : lg.domains.filter((d) => d.kind === 'management');
    const dw = (instW - 30 - (doms.length - 1) * 20) / Math.max(1, doms.length);
    doms.forEach((d, k) => {
      const dx = ix + 15 + k * (dw + 20);
      const lines = d.components.map((c) => (c.count !== undefined ? `${c.name} ×${c.count}` : c.name));
      nodes.push({
        id: `dom:${i}:${d.kind}:${k}`, kind: 'box', container: true, x: dx, y: 116, w: dw, h: 790, title: i === 0 ? d.label : 'Management domain',
        lines: [], tip: [d.label, ...(d.clusterNote ? [d.clusterNote] : [])],
      });
      const compH = 40 + Math.max(1, lines.length) * 26;
      nodes.push({ id: `comp:${i}:${k}`, kind: 'box', x: dx + 16, y: 162, w: dw - 32, h: compH, title: 'Komponenty', lines: i === 0 ? lines : ['zatím nerozhodnuto'], dashed: i !== 0 || !lines.length, tip: lines });
      const cy = 162 + compH + 30;
      const note = i === 0 ? d.clusterNote : undefined;
      nodes.push({
        id: `cl:${i}:${k}`, kind: 'box', x: dx + 16, y: cy, w: dw - 32, h: 110, title: 'vSphere cluster',
        lines: note ? [note, ...(d.kind === 'management' ? [`v místnosti: ${lg.hostsInRoom} ${plural(lg.hostsInRoom, 'server', 'servery', 'serverů')}`] : [])] : ['? zatím nerozhodnuto'],
        dashed: !note, tip: note ? [note] : [],
      });
      edges.push({ id: `ec:${i}:${k}`, a: { x: dx + dw / 2, y: 162 + compH }, b: { x: dx + dw / 2, y: cy } });
    });
  }
  return { page: 'logicky', nodes, edges, empty: false };
}

// ---------------------------------------------------------------------------
// Text alternative (UX §10.6)
// ---------------------------------------------------------------------------

export function describeBoard(input: BoardInput, page: BoardPage): string[] {
  const out: string[] = [];
  if (page === 'fyzicky') {
    if (!input.racks.length && !input.switches.length && !input.hosts.length) return ['Serverovna je prázdná.'];
    out.push(input.company ? `Síť firmy (herní abstrakce) → ${input.company.switchId} port ${input.company.port + 1}.` : 'Síť firmy: žádný switch není připojený.');
    out.push(input.switches.length ? `Switche: ${input.switches.map((s) => `${s.label} (${s.ports} portů)`).join(', ')}.` : 'Žádný switch.');
    for (const r of input.racks) {
      const hosts = input.hosts.filter((h) => h.rackId === r.id);
      out.push(`Rack ${r.label}: ${hosts.length ? hosts.map((h) => h.label).join(', ') : 'bez serverů'}.`);
    }
    for (const h of input.hosts) {
      const links = h.links.map((l) => `${l.nic} → ${l.switchId}${l.up ? '' : ' (link dole)'}`);
      out.push(`${h.label}: ${links.length ? links.join(', ') : 'nezapojený'}${h.bmcSwitchId ? `; BMC → ${h.bmcSwitchId} (mimo VCF scope – herní)` : ''}${h.esx ? '; ESX nainstalované' : ''}.`);
      if (h.problem) out.push(`Problém u ${h.label}: ${h.problem.message} (${h.problem.specRef}).`);
    }
    return out;
  }
  if (page === 'sit') {
    if (!input.networks.length) out.push('Zatím žádná síť nemá zadané hodnoty.');
    for (const n of input.networks) {
      const v = n.vlan === undefined ? '' : n.vlan === null ? ', bez VLAN tagu' : `, VLAN ${n.vlan}`;
      out.push(`${n.name}${v}${n.subnet ? `, ${n.subnet}` : ''}${n.gateway ? `, gateway ${n.gateway}` : ''}${n.mtu ? `, MTU ${n.mtu}` : ''}${n.hosts.length ? `; hosty ${n.hosts.join(', ')}` : ''} (${n.source}${n.gameDefault ? ', herní výchozí' : ''}).`);
    }
    for (const s of input.switches) out.push(`${s.label}: ${s.vlanSummary.join(', ') || 'žádný zapojený port'}${s.mtus.length ? `; MTU ${s.mtus.join('/')}` : ''}.`);
    out.push('Další sítě: zatím nerozhodnuto.');
    return out;
  }
  const lg = input.logical;
  if (!lg || !lg.decided) return ['Logická architektura zatím nerozhodnutá – zvol use case a návrh.'];
  out.push(`${lg.fleetLabel}${lg.deployed ? ' (nasazeno)' : ' (podle návrhu)'}; VCF Instance: ${lg.instances ?? 'zatím nerozhodnuto'}.`);
  for (const d of lg.domains) {
    out.push(`${d.label}: ${d.components.map((c) => (c.count !== undefined ? `${c.name} ×${c.count}` : c.name)).join(', ') || 'komponenty zatím nerozhodnuté'}; cluster: ${d.clusterNote ?? 'zatím nerozhodnuto'}.`);
  }
  out.push(`Serverů v místnosti: ${lg.hostsInRoom}.`);
  return out;
}

/** Stable fingerprint of the drawn content ("!" sticker on the room whiteboard when it changes). */
export function layoutKey(l: HldLayout): string {
  return l.nodes.map((n) => `${n.id}:${n.title}:${n.lines.join('|')}:${n.problem ?? ''}`).join(';') + '#' + l.edges.map((e) => `${e.id}:${e.label ?? ''}:${e.dashed ? 1 : 0}`).join(';');
}
