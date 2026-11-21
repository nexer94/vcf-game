/**
 * Sandbox state -> whiteboard input (render/whiteboard/hldLayout.ts BoardInput). Pure mapping, no rules:
 *  - physical topology from RoomState (both backends),
 *  - VLAN / IP / MTU, company network, validation problems and the design summary from the session snapshot
 *    (only the session backend has it; the demo room shows the physical page only).
 * Every value shown on the board comes from these inputs; nothing is invented here.
 */
import { APPLIANCES, expectedManagementDomainKinds, type ApplianceKind } from '../../model';
import type { SandboxSnapshot } from '../../modes/sandbox/snapshot';
import type { BoardComponent, BoardDomain, BoardHost, BoardInput, BoardLogical, BoardNetwork, BoardSwitch } from '../../render/whiteboard/hldLayout';
import type { RoomState } from '../sandbox/sessionPort';

/** IPv4 + dotted mask -> "a.b.c.d/nn" (math only). undefined when malformed. */
export function subnetOf(ip: string | undefined, mask: string | undefined): string | undefined {
  if (!ip || !mask) return undefined;
  const p = (s: string): number[] | null => {
    const a = s.split('.').map((x) => Number(x));
    return a.length === 4 && a.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) ? a : null;
  };
  const a = p(ip);
  const m = p(mask);
  if (!a || !m) return undefined;
  const bits = m.reduce((n, o) => n + o.toString(2).replace(/0/g, '').length, 0);
  return `${a.map((o, i) => o & m[i]!).join('.')}/${bits}`;
}

const nicLabel = (state: RoomState, deviceId: string, port: number | 'bmc'): string => {
  if (port === 'bmc') return 'BMC';
  const d = state.devices.find((x) => x.id === deviceId);
  return d?.nicPorts.find((n) => n.index === port)?.label ?? `NIC ${port + 1}`;
};

export function boardInputOf(state: RoomState, snap?: SandboxSnapshot): BoardInput {
  const placedRacks = state.racks.filter((r) => r.tile);
  const mounted = state.devices.filter((d) => d.mount && placedRacks.some((r) => r.id === d.mount!.rackId));
  const servers = mounted.filter((d) => d.kind === 'server');
  const switchDevs = mounted.filter((d) => d.kind === 'switch');
  const swIds = new Set(switchDevs.map((s) => s.id));
  const physServers = new Map((snap?.physical.servers ?? []).map((s) => [s.id, s]));
  const physSwitches = new Map((snap?.physical.switches ?? []).map((s) => [s.id, s]));

  const hosts: BoardHost[] = servers.map((d) => {
    const links: BoardHost['links'][number][] = [];
    let bmcSwitchId: string | undefined;
    for (const c of state.cables) {
      const mine = c.a.deviceId === d.id ? c.a : c.b.deviceId === d.id ? c.b : null;
      const other = mine === c.a ? c.b : c.a;
      if (!mine || !swIds.has(other.deviceId)) continue;
      if (mine.port === 'bmc') bmcSwitchId = other.deviceId;
      else links.push({ switchId: other.deviceId, nic: nicLabel(state, d.id, mine.port), up: c.linkUp });
    }
    const pv = physServers.get(d.id);
    const err = pv?.topology.errors[0];
    return {
      id: d.id,
      label: d.label,
      ...(d.vendor ? { vendor: d.vendor } : {}),
      ...(d.mount ? { rackId: d.mount.rackId } : {}),
      nicTotal: d.nicPorts.length,
      links,
      ...(bmcSwitchId ? { bmcSwitchId } : {}),
      esx: d.esxInstalled,
      ...(err ? { problem: { message: err.message, specRef: err.specRef } } : {}),
    };
  });

  const switches: BoardSwitch[] = switchDevs.map((d) => {
    const pv = physSwitches.get(d.id);
    const cabled = (pv?.ports ?? []).filter((p) => p.cableId || p.companyUplink);
    const access = [...new Set(cabled.filter((p) => p.config.mode === 'access').map((p) => p.config.accessVlan))].sort((a, b) => a - b);
    const trunkSets = new Set(cabled.filter((p) => p.config.mode === 'trunk').map((p) => (p.config.allowedVlans === 'all' ? 'všechny' : [...p.config.allowedVlans].sort((a, b) => a - b).join(','))));
    const vlanSummary = [...(access.length ? [`access VLAN ${access.join(',')}`] : []), ...[...trunkSets].map((t) => `trunk VLAN ${t}`)];
    return {
      id: d.id,
      label: d.label,
      ports: d.switchPorts,
      ...(d.mount ? { rackId: d.mount.rackId } : {}),
      mtus: [...new Set(cabled.map((p) => p.config.mtu))].sort((a, b) => a - b),
      vlanSummary,
    };
  });

  const company = snap?.physical.companyNetwork ?? state.companyNetwork ?? null;
  return {
    racks: placedRacks.map((r) => ({ id: r.id, label: r.label })),
    switches,
    hosts,
    company: company ? { switchId: company.switchId, port: company.port } : null,
    networks: snap ? networksOf(snap, state) : [],
    logical: snap ? logicalOf(snap, servers.length) : null,
  };
}

function networksOf(snap: SandboxSnapshot, state: RoomState): BoardNetwork[] {
  const out: BoardNetwork[] = [];
  const label = (id: string): string => state.devices.find((d) => d.id === id)?.label ?? id;
  // ESX management (vmk0) from the DCUI of the hosts, grouped by VLAN / subnet / gateway.
  const groups = new Map<string, { vlan: number | null; subnet?: string; gw?: string; mtu?: number; hosts: string[]; dhcp: boolean }>();
  for (const s of snap.physical.servers) {
    if (s.status !== 'esx-dhcp' && s.status !== 'esx-static') continue;
    const net = s.esx.network;
    const vmk0 = s.hostNet?.vmks.find((v) => v.name === 'vmk0');
    const vlan = net?.vlanId ?? vmk0?.tag ?? null;
    const subnet = net ? subnetOf(net.ipv4Address, net.subnetMask) : undefined;
    const gw = net?.defaultGateway;
    const dhcp = !net;
    const key = `${vlan}|${subnet ?? ''}|${gw ?? ''}|${dhcp}`;
    const g = groups.get(key) ?? { vlan, ...(subnet ? { subnet } : {}), ...(gw ? { gw } : {}), ...(vmk0 ? { mtu: vmk0.mtu } : {}), hosts: [], dhcp };
    g.hosts.push(label(s.id));
    groups.set(key, g);
  }
  let i = 0;
  for (const g of groups.values()) {
    out.push({
      id: `mgmt${i++}`,
      name: 'ESX management (vmk0)',
      traffic: 'management',
      vlan: g.vlan,
      ...(g.subnet ? { subnet: g.subnet } : {}),
      ...(g.gw ? { gateway: g.gw } : {}),
      ...(g.mtu ? { mtu: g.mtu } : {}),
      hosts: g.hosts,
      source: g.dhcp ? 'z hostů po instalaci (DHCP, bez statické IP)' : 'z DCUI hostů',
    });
  }
  // Planned networks (wizard / design plan), only those with values.
  const plan = snap.physical.plan;
  if (plan) {
    const storageChoice = snap.design.choices['principal-storage'];
    const storageName = storageChoice?.startsWith('vsan') ? 'vSAN' : storageChoice === 'nfs-v3' ? 'NFS' : 'Storage';
    const src = 'plán sítí (průvodce / návrh)';
    out.push({ id: 'vmotion', name: 'vMotion', traffic: 'vmotion', vlan: plan.vmotion.vlanId, mtu: plan.vmotion.mtu, hosts: [], source: src });
    if (plan.storage) out.push({ id: 'storage', name: storageName, traffic: storageName === 'vSAN' ? 'vsan' : 'nfs', vlan: plan.storage.vlanId, mtu: plan.storage.mtu, hosts: [], source: src });
    if (plan.nsxHostOverlay) out.push({ id: 'tep', name: 'NSX Host TEP', traffic: 'overlay', vlan: plan.nsxHostOverlay.vlanId, mtu: plan.nsxHostOverlay.mtu, hosts: [], source: src });
  }
  return out;
}

function logicalOf(snap: SandboxSnapshot, hostsInRoom: number): BoardLogical {
  const s = snap.design.summary;
  const nodes = s.componentNodes;
  const counts: Partial<Record<ApplianceKind, number | undefined>> = { 'vcf-operations': nodes.vcfOperations, 'vcf-automation': nodes.vcfAutomation };
  const nsx = (d: 'management' | 'workload'): BoardComponent[] => {
    const n = s.nsxManagers.find((x) => x.domain === d);
    return n ? [{ name: 'NSX Manager', count: n.nodes }] : [];
  };
  // Appliances of the first instance's management domain (00 §2.1 / §2.3) + vCenter of the domain (00 §6).
  const appliances: BoardComponent[] = expectedManagementDomainKinds(true)
    .filter((k): k is ApplianceKind => k in APPLIANCES)
    .map((k) => {
      const c = counts[k];
      return c !== undefined ? { name: APPLIANCES[k].displayName, count: c } : { name: APPLIANCES[k].displayName };
    });
  const w = s.workloadDomainMinHosts;
  const wldNote = w ? [w.vsan !== undefined ? `vSAN min. ${w.vsan}` : null, w.nfsOrFc !== undefined ? `NFS/FC min. ${w.nfsOrFc}` : null].filter(Boolean).join(' · ') + ' hostů (návrh)' : undefined;
  const domains: BoardDomain[] = s.domains.map((d) =>
    d === 'management'
      ? {
          kind: d,
          label: 'Management domain',
          ...(s.managementDomainMinHosts !== undefined ? { clusterNote: `default cluster · min. ${s.managementDomainMinHosts} hostů (návrh)` } : {}),
          components: [{ name: 'vCenter' }, ...nsx('management'), ...appliances],
        }
      : { kind: d, label: 'Workload domain', ...(wldNote ? { clusterNote: wldNote } : {}), components: [{ name: 'vCenter' }, ...nsx('workload')] },
  );
  return {
    decided: Object.keys(snap.design.choices).length > 0,
    fleetLabel: snap.fleet ? `VCF Fleet ${snap.fleet.name}` : 'VCF Fleet',
    ...(s.instances !== undefined ? { instances: s.instances } : {}),
    domains,
    hostsInRoom,
    deployed: !!snap.fleet,
  };
}
