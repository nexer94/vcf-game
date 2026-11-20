/**
 * Test helpers: an illustrative "workbook" (names / IPs are test data, not documentation facts) and
 * scripted player actions driving a SandboxSession through planning and the wizard.
 */
import { expect } from 'vitest';
import type { DesignChoices, InstallerOvfInput } from '../../../model';
import type { CommandResult, SandboxCommand } from '../types';
import type { SandboxSession } from '../session';

export const DOMAIN = 'lab.vcfhra.cz';
export const DNS_SERVER = '10.20.0.4';
export const NTP = `ntp.${DOMAIN}`;
export const ESX_VERSION = 'esx-per-release-notes';

/** Blueprint "VCF Fleet in a Single Site with Minimal Footprint" (05 §2.7) – same as model design tests. */
export const MINIMAL_FOOTPRINT: DesignChoices = {
  'fleet-deployment-model': 'basic',
  'workload-placement': 'management-domain',
  'deployment-model': 'simple',
  'deployment-size': 'small',
  'mgmt-cluster-model': 'single-rack',
  'principal-storage': 'vsan-esa',
  'distributed-switch-model': 'single',
  'management-network-model': 'shared-vlan',
  'network-consumption-model': 'nsx-segment',
  'vpc-network-type': 'full-stack',
  'vpc-gateway-connectivity': 'centralized',
  'vcf-operations-model': 'simple',
  'vcf-automation-model': 'simple',
  'vcf-automation-placement': 'management-domain',
  'identity-broker-model': 'instance',
  'sso-model': 'fleet-wide',
};

/** Blueprint "VCF Fleet in a Single Site" (05 §2.7) – HA production, workloads in a separate WLD. */
export const HA_PRODUCTION: DesignChoices = {
  'fleet-deployment-model': 'basic',
  'workload-placement': 'workload-domain',
  'wld-nsx-consumption': 'dedicated',
  'deployment-model': 'high-availability',
  'deployment-size': 'medium',
  'mgmt-cluster-model': 'single-rack',
  'wld-cluster-model': 'single-rack',
  'principal-storage': 'vsan-esa',
  'distributed-switch-model': 'storage-separation',
  'management-network-model': 'shared-vlan',
  'wld-network-type': 'ipv4',
  'network-consumption-model': 'vpc',
  'vpc-network-type': 'full-stack',
  'vpc-gateway-connectivity': 'distributed',
  'vcf-operations-model': 'high-availability',
  'vcf-automation-model': 'high-availability',
  'vcf-automation-placement': 'management-domain',
  'identity-broker-model': 'instance',
  'sso-model': 'fleet-wide',
};

export const FQDN = {
  installer: [`installer.${DOMAIN}`, '10.20.0.10'],
  ntp: [NTP, '10.20.0.5'],
  vcenter: [`vc01.${DOMAIN}`, '10.20.0.20'],
  sddc: [`sddc01.${DOMAIN}`, '10.20.0.21'],
  nsxVip: [`nsx01.${DOMAIN}`, '10.20.0.22'],
  nsx1: [`nsx01a.${DOMAIN}`, '10.20.0.23'],
  nsx2: [`nsx01b.${DOMAIN}`, '10.20.0.24'],
  nsx3: [`nsx01c.${DOMAIN}`, '10.20.0.25'],
  opsPrimary: [`ops01a.${DOMAIN}`, '10.20.0.30'],
  opsReplica: [`ops01b.${DOMAIN}`, '10.20.0.31'],
  opsData: [`ops01c.${DOMAIN}`, '10.20.0.32'],
  cloudProxy: [`opscp01.${DOMAIN}`, '10.20.0.33'],
  license: [`lic01.${DOMAIN}`, '10.20.0.34'],
  fleet: [`fleet01.${DOMAIN}`, '10.20.0.35'],
  instance: [`inst01.${DOMAIN}`, '10.20.0.36'],
  idb: [`idb01.${DOMAIN}`, '10.20.0.37'],
  runtime: [`vsp01.${DOMAIN}`, '10.20.0.38'],
  automation: [`auto01.${DOMAIN}`, '10.20.0.39'],
  automationRuntime: [`vsp02.${DOMAIN}`, '10.20.0.40'],
} as const;

export const hostFqdn = (i: number): readonly [string, string] => [`esx0${i + 1}.${DOMAIN}`, `10.20.0.${101 + i}`];

export const VALID_OVF: InstallerOvfInput = {
  vmName: 'vcf-installer',
  placement: 'outside-management',
  datastore: 'other',
  rootPassword: 'Kv8#Tmz!Q4rPx2wa',
  localUserPassword: 'Bz9^Kt4@Lm2!Qw8x',
  hostnameFqdn: FQDN.installer[0],
  ntpServers: [NTP],
  ipVersion: 'ipv4',
  ipv4Address: FQDN.installer[1],
  subnetMask: '255.255.255.0',
  defaultGateway: '10.20.0.1',
  dnsDomainName: DOMAIN,
  domainSearchPath: DOMAIN,
  dnsServers: [DNS_SERVER],
};

/** Dispatch and assert success. */
export function must(session: SandboxSession, cmd: SandboxCommand): CommandResult {
  const r = session.dispatch(cmd);
  if (!r.ok) throw new Error(`${cmd.type} rejected: ${JSON.stringify(r.rejection)}`);
  return r;
}

/** Design phase: pick all choices, acknowledge warnings, go to planning. */
export function completeDesign(session: SandboxSession, choices: DesignChoices): void {
  for (const [decision, option] of Object.entries(choices)) must(session, { type: 'selectDesignOption', decision: decision as keyof DesignChoices, option: option! });
  if (session.snapshot().design.gate.unacknowledgedWarnings.length) must(session, { type: 'acknowledgeDesignWarnings' });
  must(session, { type: 'advancePhase' });
  expect(session.snapshot().phase).toBe('planning');
}

/** Planning: DNS, hosts, installer, depot + binaries (advances game time for downloads). */
export function preparePlanning(session: SandboxSession, opts: { hosts: number; pnics: number }): void {
  for (const [f, ip] of Object.values(FQDN)) must(session, { type: 'addDnsRecord', fqdn: f, ip });
  for (let i = 0; i < opts.hosts; i++) {
    const [fqdn, ip] = hostFqdn(i);
    must(session, { type: 'addDnsRecord', fqdn, ip });
    must(session, { type: 'addHost', hw: { hwVendor: 'Vendor A (herní)', hwProfileId: 'hw-a', pnicCount: opts.pnics } });
    const id = session.state.env.hosts[i]!.id;
    must(session, { type: 'installEsx', hostId: id, version: ESX_VERSION });
    must(session, {
      type: 'configureHostNetwork',
      hostId: id,
      network: { vlanId: 1610, ipv4Address: ip, subnetMask: '255.255.255.0', defaultGateway: '10.20.0.1', dnsServers: [DNS_SERVER], hostnameFqdn: fqdn, customDnsSuffixes: [] },
    });
    must(session, { type: 'configureHostNtp', hostId: id, servers: [NTP] });
    must(session, { type: 'setHostSsh', hostId: id, enabled: true });
    must(session, { type: 'regenerateHostCertificate', hostId: id });
    must(session, { type: 'setHostSsh', hostId: id, enabled: false });
  }
  must(session, { type: 'deployInstaller', ovf: VALID_OVF });
  must(session, { type: 'configureDepot', connection: { kind: 'online', input: { activationCode: 'GAME-ACT-0001' } } });
  must(session, { type: 'downloadBinaries' });
  runUntilIdle(session);
}

/** Advance game time until no task runs (bounded). */
export function runUntilIdle(session: SandboxSession): void {
  for (let i = 0; i < 20 && session.state.tasks.length > 0; i++) session.advance(24 * 60 * 60_000);
  expect(session.state.tasks).toEqual([]);
}

const net = (vlan: number, third: number, last: number) => ({
  vlanId: vlan,
  cidr: `10.20.${third}.0/24`,
  gateway: `10.20.${third}.1`,
  mtu: 9000,
  inclusionRanges: [{ kind: 'range' as const, start: `10.20.${third}.10`, end: `10.20.${third}.${last}` }],
});

/** Fill the wizard pages (deploy phase). `servicesIps` < 30 yields the "recommended 30" warning. */
export function fillWizard(session: SandboxSession, opts: { hosts: number; servicesIps: number }): void {
  const s = session.state.spec;
  const ha = s.model === 'high-availability';
  must(session, {
    type: 'setWizardSection',
    section: 'general',
    value: { ...s.general, instanceName: 'lab-m01', managementDomainName: 'lab-m01', dnsServers: [DNS_SERVER], ntpServers: [NTP], ceip: false, autogeneratePasswords: true },
  });
  must(session, { type: 'setWizardSection', section: 'esxHosts', value: Array.from({ length: opts.hosts }, (_, i) => ({ fqdn: hostFqdn(i)[0] })) });
  must(session, {
    type: 'setWizardSection',
    section: 'networks',
    value: {
      esxManagement: { vlanId: 1610, cidr: '10.20.0.0/24', gateway: '10.20.0.1' },
      managementServicesIpPool: { kind: 'range', start: '10.20.1.10', end: `10.20.1.${10 + opts.servicesIps - 1}` },
      vcfAutomationIpPool: { kind: 'range', start: '10.20.1.100', end: '10.20.1.104' },
      vmotion: net(1611, 2, 30),
      storage: net(1612, 3, 30),
      nsxHostOverlay: net(1613, 4, 40),
    },
  });
  must(session, {
    type: 'setWizardSection',
    section: 'components',
    value: {
      vcfOperationsPrimaryFqdn: FQDN.opsPrimary[0],
      ...(ha ? { vcfOperationsReplicaFqdn: FQDN.opsReplica[0] } : {}),
      ...(ha && s.size !== 'small' ? { vcfOperationsDataFqdn: FQDN.opsData[0] } : {}),
      cloudProxyFqdn: FQDN.cloudProxy[0],
      licenseServerFqdn: FQDN.license[0],
      fleetComponentsFqdn: FQDN.fleet[0],
      instanceComponentsFqdn: FQDN.instance[0],
      identityBrokerFqdn: FQDN.idb[0],
      servicesRuntimeFqdn: FQDN.runtime[0],
      internalClusterCidrIpv4: '198.18.0.0/15',
      vcfAutomationFqdn: FQDN.automation[0],
      vcfAutomationServicesRuntimeFqdn: FQDN.automationRuntime[0],
    },
  });
  must(session, { type: 'setWizardSection', section: 'vcenter', value: { fqdn: FQDN.vcenter[0] } });
  must(session, { type: 'setWizardSection', section: 'storageDetails', value: { datastoreName: 'lab-m01-cl01-ds-vsan01' } });
  must(session, {
    type: 'setWizardSection',
    section: 'nsx',
    value: {
      ...s.nsx,
      nodeFqdns: ha ? [FQDN.nsx1[0], FQDN.nsx2[0], FQDN.nsx3[0]] : [FQDN.nsx1[0]],
      vipFqdn: FQDN.nsxVip[0],
    },
  });
  must(session, { type: 'setWizardSection', section: 'sddcManager', value: { fqdn: FQDN.sddc[0] } });
}
