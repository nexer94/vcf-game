/**
 * Network context of the server room for the model's reachability / flow functions (model/physical.ts).
 *
 * The model's PhysicalState keeps `endpoints: []` in the Sandbox state; the endpoints are DERIVED here from the
 * game state so they can never get out of sync:
 *  - "Síť firmy" (company network, UX §10.2 / §12.2) – GAME ABSTRACTION: when a switch port is connected to it,
 *    a gateway, DNS, NTP, DHCP server and the admin workstation sit behind that port. The gateway has an interface
 *    in every VLAN used in the room (game simplification: the customer router "knows" all your VLANs); the
 *    switch port's 802.1Q config still decides which VLANs actually pass. Addresses are game defaults.
 *  - VCF Installer appliance (after "deployInstaller"): a VM on the chosen management host (20 §4.1.5) or behind
 *    the company network.
 *  - vCenter (after a completed bring-up): VM on the first management host, ESX management VLAN.
 */
import {
  type FlowContext,
  type HardwareCatalog,
  type NetContext,
  type NetworkActivity,
  type PlannedHostNetworks,
  type ServiceEndpoint,
} from '../../model';
import type { SandboxState } from './types';

/** Ids of the derived endpoints. */
export const ENDPOINT_IDS = {
  gateway: 'corp-gateway',
  dns: 'corp-dns',
  ntp: 'corp-ntp',
  dhcp: 'corp-dhcp',
  admin: 'admin-ws',
  installer: 'vcf-installer',
  vcenter: 'vcenter',
} as const;

/** GAME DEFAULT addresses of the company network services (not documentation; UX label "herní výchozí"). */
export const COMPANY_NETWORK_GAME_DEFAULTS = {
  gateway: '10.0.0.1',
  dns: '10.0.0.53',
  ntp: '10.0.0.123',
  dhcp: '10.0.0.67',
  admin: '10.0.0.100',
  gameDefault: true,
} as const;

const vlanOk = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 4094;

/** VLAN IDs used anywhere in the room (switch ports, VMkernel adapters, BMC tags, wizard networks). */
export function vlansInUse(s: SandboxState): number[] {
  const out = new Set<number>();
  for (const sw of s.room.physical.switches)
    for (const p of sw.ports) {
      out.add(p.accessVlan);
      out.add(p.nativeVlan);
      if (p.allowedVlans !== 'all') for (const v of p.allowedVlans) out.add(v);
    }
  for (const srv of s.room.physical.servers) {
    for (const v of srv.hostNet?.vmks ?? []) if (v.tag !== null) out.add(v.tag);
    if (srv.bmc.tag !== null) out.add(srv.bmc.tag);
    if (srv.esx.network?.vlanId !== undefined) out.add(srv.esx.network.vlanId);
  }
  const n = s.spec.networks;
  for (const v of [n.esxManagement.vlanId, n.vmotion.vlanId, n.storage?.vlanId, n.nsxHostOverlay?.vlanId]) if (vlanOk(v)) out.add(v);
  return [...out].filter(vlanOk).sort((a, b) => a - b);
}

/** Physical servers whose management FQDN is a host of the bring-up spec. */
export function specServerIds(s: SandboxState): string[] {
  const fqdns = new Set(s.spec.esxHosts.map((h) => h.fqdn));
  return s.room.physical.servers.filter((x) => x.esx.network && fqdns.has(x.esx.network.hostnameFqdn)).map((x) => x.id);
}

export function derivedEndpoints(s: SandboxState): ServiceEndpoint[] {
  const out: ServiceEndpoint[] = [];
  const link = s.room.companyNetwork;
  const d = COMPANY_NETWORK_GAME_DEFAULTS;
  if (link) {
    const at = (tags: readonly (number | null)[]) => ({ kind: 'switch-port' as const, switchId: link.switchId, port: link.port, tags });
    out.push(
      { id: ENDPOINT_IDS.gateway, kind: 'gateway', label: 'Síť firmy – gateway (herní)', ipv4: d.gateway, attachment: at([null, ...vlansInUse(s)]), mtu: 1500 },
      { id: ENDPOINT_IDS.dns, kind: 'dns', label: 'Síť firmy – DNS (herní)', ipv4: d.dns, attachment: at([null]), mtu: 1500 },
      { id: ENDPOINT_IDS.ntp, kind: 'ntp', label: 'Síť firmy – NTP (herní)', ipv4: d.ntp, attachment: at([null]), mtu: 1500 },
      { id: ENDPOINT_IDS.dhcp, kind: 'dhcp', label: 'Síť firmy – DHCP (herní)', ipv4: d.dhcp, attachment: at([null]), mtu: 1500 },
      { id: ENDPOINT_IDS.admin, kind: 'admin-workstation', label: 'Počítač admina (herní)', ipv4: d.admin, attachment: at([null]), mtu: 1500 },
    );
  }
  // Pre-wired OOB network (oob.ts, GAME): each pre-installed OOB switch's last port is its uplink to the company
  // network; the admin workstation reaches the BMCs over it.
  for (const [roomId, switchId] of Object.entries(s.room.oobSwitches ?? {})) {
    const sw = s.room.physical.switches.find((x) => x.id === switchId);
    if (!sw) continue;
    out.push({ id: `${ENDPOINT_IDS.admin}-oob-${roomId}`, kind: 'admin-workstation', label: 'Počítač admina – OOB síť (herní)', ipv4: d.admin, attachment: { kind: 'switch-port', switchId, port: sw.ports.length - 1, tags: [null] }, mtu: 1500 });
  }
  const ovf = s.env.installer.ovf;
  if (ovf && s.env.installer.mode !== 'not-deployed') {
    const host = ovf.placement === 'management-host' && ovf.esxHostId !== undefined ? s.room.physical.servers.find((x) => x.id === ovf.esxHostId) : undefined;
    if (host) {
      const tag = host.hostNet?.vmks.find((v) => v.name === 'vmk0')?.tag ?? null;
      out.push({ id: ENDPOINT_IDS.installer, kind: 'vcf-installer', label: 'VCF Installer', ipv4: ovf.ipv4Address ?? '', fqdn: ovf.hostnameFqdn, attachment: { kind: 'host-vm', serverId: host.id, tag }, mtu: 1500 });
    } else if (link) {
      out.push({ id: ENDPOINT_IDS.installer, kind: 'vcf-installer', label: 'VCF Installer', ipv4: ovf.ipv4Address ?? '', fqdn: ovf.hostnameFqdn, attachment: { kind: 'switch-port', switchId: link.switchId, port: link.port, tags: [null] }, mtu: 1500 });
    }
  }
  if (s.fleet) {
    const first = specServerIds(s)[0];
    const vlan = s.spec.networks.esxManagement.vlanId;
    if (first !== undefined)
      out.push({ id: ENDPOINT_IDS.vcenter, kind: 'vcenter', label: 'vCenter', fqdn: s.spec.vcenter.fqdn, attachment: { kind: 'host-vm', serverId: first, tag: vlanOk(vlan) ? vlan : null }, mtu: 1500 });
  }
  return out;
}

export function netContextOf(s: SandboxState, catalog: HardwareCatalog): NetContext {
  return { state: { ...s.room.physical, endpoints: derivedEndpoints(s) }, catalog };
}

/** Planned host networks from the wizard (20 §4.2 step 11); undefined until the VLANs are filled in. */
export function plannedHostNetworks(s: SandboxState): PlannedHostNetworks | undefined {
  const n = s.spec.networks;
  if (!vlanOk(n.esxManagement.vlanId) || !vlanOk(n.vmotion.vlanId)) return undefined;
  return {
    esxManagement: { vlanId: n.esxManagement.vlanId },
    vmotion: { vlanId: n.vmotion.vlanId, mtu: n.vmotion.mtu },
    ...(n.storage && vlanOk(n.storage.vlanId) ? { storage: { vlanId: n.storage.vlanId, mtu: n.storage.mtu } } : {}),
    ...(n.nsxHostOverlay && vlanOk(n.nsxHostOverlay.vlanId) ? { nsxHostOverlay: { vlanId: n.nsxHostOverlay.vlanId, mtu: n.nsxHostOverlay.mtu } } : {}),
  };
}

/** Activities that make activity flows visible (running tasks). */
export function networkActivities(s: SandboxState): NetworkActivity[] {
  const out: NetworkActivity[] = [];
  for (const t of s.tasks) {
    const p = t.payload;
    if (p.kind === 'mgmt-network-test') out.push({ kind: 'dcui-test-management-network', serverId: p.serverId });
    else if (p.kind === 'bringup-validation') {
      const plan = plannedHostNetworks(s);
      out.push(plan ? { kind: 'installer-validation', plan } : { kind: 'installer-validation' });
    } else if (p.kind === 'bringup-deployment') out.push({ kind: 'bringup' });
  }
  return out;
}

export function flowContextOf(s: SandboxState): FlowContext {
  return { activities: networkActivities(s), ...(s.fleet ? { vcenterManagedServerIds: specServerIds(s) } : {}) };
}
