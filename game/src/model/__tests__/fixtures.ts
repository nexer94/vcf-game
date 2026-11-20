/**
 * Test fixtures: a valid greenfield bring-up (new fleet, HA Small, vSAN ESA, 4 hosts).
 * Values (names/IPs) are illustrative test data, not facts from documentation.
 */
import {
  type BringupEnvironment,
  type BringupSpec,
  type DepotState,
  type EsxHost,
  type InstallerOvfInput,
  type InstallerState,
  VCF_BINARIES,
  configureDepot,
  configureHostNetwork,
  configureHostNtp,
  deployInstallerOva,
  initialDepotState,
  initialInstallerState,
  installEsx,
  newBareMetalHost,
  regenerateHostCertificate,
  setBinaryStatus,
  setHostSsh,
} from '../bringup';
import type { DnsRecords } from '../net';
import type { TransitionResult } from '../validation';

export const DOMAIN = 'sfo.rainpole.io';
export const ESX_VERSION = '9.1.1';
export const NTP = `ntp.${DOMAIN}`;
export const DNS_SERVER = '10.0.0.4';

export function unwrap<S>(r: TransitionResult<S>): S {
  if (!r.ok) throw new Error(`transition failed: ${r.error.code} ${r.error.message}`);
  return r.state;
}

export function makeDns(entries: readonly (readonly [string, string])[]): DnsRecords {
  const forward: Record<string, string> = {};
  const reverse: Record<string, string> = {};
  for (const [f, ip] of entries) {
    forward[f] = ip;
    reverse[ip] = f;
  }
  return { forward, reverse };
}

export const FQDNS = {
  installer: [`installer.${DOMAIN}`, '10.0.0.10'],
  ntp: [NTP, '10.0.0.5'],
  vcenter: [`vc01.${DOMAIN}`, '10.0.0.20'],
  sddc: [`sddc01.${DOMAIN}`, '10.0.0.21'],
  nsxVip: [`nsx01.${DOMAIN}`, '10.0.0.22'],
  nsx1: [`nsx01a.${DOMAIN}`, '10.0.0.23'],
  nsx2: [`nsx01b.${DOMAIN}`, '10.0.0.24'],
  nsx3: [`nsx01c.${DOMAIN}`, '10.0.0.25'],
  opsPrimary: [`ops01a.${DOMAIN}`, '10.0.0.30'],
  opsReplica: [`ops01b.${DOMAIN}`, '10.0.0.31'],
  opsData: [`ops01c.${DOMAIN}`, '10.0.0.32'],
  cloudProxy: [`opscp01.${DOMAIN}`, '10.0.0.33'],
  license: [`lic01.${DOMAIN}`, '10.0.0.34'],
  fleet: [`fleet01.${DOMAIN}`, '10.0.0.35'],
  instance: [`inst01.${DOMAIN}`, '10.0.0.36'],
  idb: [`idb01.${DOMAIN}`, '10.0.0.37'],
  runtime: [`vsp01.${DOMAIN}`, '10.0.0.38'],
  automation: [`auto01.${DOMAIN}`, '10.0.0.39'],
  automationRuntime: [`vsp02.${DOMAIN}`, '10.0.0.40'],
} as const;

export const HOSTS = [1, 2, 3, 4].map((i) => [`esx0${i}.${DOMAIN}`, `10.0.0.10${i}`] as const);

export function baseDns(): DnsRecords {
  return makeDns([...Object.values(FQDNS), ...HOSTS]);
}

export function preparedHost(i: number, overrides: Partial<{ vendor: string; profile: string; pnics: number }> = {}): EsxHost {
  const [fqdn, ip] = HOSTS[i]!;
  let h = newBareMetalHost(`h${i + 1}`, {
    hwVendor: overrides.vendor ?? 'VendorA',
    hwProfileId: overrides.profile ?? 'profile-1',
    pnicCount: overrides.pnics ?? 2,
  });
  h = unwrap(installEsx(h, ESX_VERSION));
  h = unwrap(
    configureHostNetwork(h, {
      vlanId: 1611,
      ipv4Address: ip,
      subnetMask: '255.255.255.0',
      defaultGateway: '10.0.0.1',
      dnsServers: [DNS_SERVER],
      hostnameFqdn: fqdn,
      customDnsSuffixes: [],
    }),
  );
  h = unwrap(configureHostNtp(h, [NTP]));
  h = unwrap(setHostSsh(h, true));
  h = unwrap(regenerateHostCertificate(h));
  h = unwrap(setHostSsh(h, false));
  return h;
}

export const VALID_PASSWORD = 'Xq7#Rainpole!2026z';

export function installerOvf(overrides: Partial<InstallerOvfInput> = {}): InstallerOvfInput {
  return {
    vmName: 'vcf-installer',
    placement: 'outside-management',
    datastore: 'other',
    rootPassword: VALID_PASSWORD,
    localUserPassword: 'Bz9^Kt4@Lm2!Qw8x',
    hostnameFqdn: FQDNS.installer[0],
    ntpServers: [NTP],
    ipVersion: 'ipv4',
    ipv4Address: FQDNS.installer[1],
    subnetMask: '255.255.255.0',
    defaultGateway: '10.0.0.1',
    dnsDomainName: DOMAIN,
    domainSearchPath: DOMAIN,
    dnsServers: [DNS_SERVER],
    ...overrides,
  };
}

export function deployedInstaller(overrides: Partial<InstallerOvfInput> = {}): InstallerState {
  return unwrap(deployInstallerOva(initialInstallerState('9.1.1'), installerOvf(overrides), baseDns()));
}

export function readyDepot(): DepotState {
  let d = unwrap(configureDepot(initialDepotState(), { kind: 'online', input: { activationCode: 'ACT-123' } }));
  for (const b of VCF_BINARIES) {
    d = unwrap(setBinaryStatus(d, b, 'downloading'));
    d = unwrap(setBinaryStatus(d, b, 'validating'));
    d = unwrap(setBinaryStatus(d, b, 'downloaded'));
  }
  return d;
}

export function validSpec(): BringupSpec {
  return {
    target: 'new-fleet',
    existing: {
      existingVcfOperations: false,
      existingVcenter: false,
      vcenterRegisteredWithNsx: false,
      existingVcfAutomationOrDeployLater: false,
    },
    model: 'high-availability',
    size: 'small',
    networkConfig: {
      vmManagementNetwork: 'shared-with-esx-management',
      vcfManagementNetwork: 'shared-with-vm-management',
      dualStack: false,
      vmotionIpScheme: 'ipv4',
      storageIpScheme: 'ipv4',
      deployOpsAndAutomationToCustomNetwork: false,
      vpcNetwork: 'full-stack',
      vpcGatewayConnectivity: 'centralized',
    },
    storage: { type: 'vsan-esa', vsanEsaAllowAutoClaimHclIncompatible: false },
    general: {
      version: '9.1.1',
      instanceName: 'sfo-m01',
      managementDomainName: 'sfo-m01',
      ceip: true,
      dnsServers: [DNS_SERVER],
      ntpServers: [NTP],
      dnsDomainName: DOMAIN,
      autogeneratePasswords: true,
    },
    esxHosts: HOSTS.map(([fqdn]) => ({ fqdn })),
    networks: {
      esxManagement: { vlanId: 1611, cidr: '10.0.0.0/24', gateway: '10.0.0.1' },
      managementServicesIpPool: { kind: 'range', start: '10.0.1.10', end: '10.0.1.39' },
      vcfAutomationIpPool: { kind: 'range', start: '10.0.1.50', end: '10.0.1.54' },
      vmotion: { vlanId: 1612, cidr: '10.0.2.0/24', gateway: '10.0.2.1', mtu: 9000, inclusionRanges: [{ kind: 'range', start: '10.0.2.10', end: '10.0.2.20' }] },
      storage: { vlanId: 1613, cidr: '10.0.3.0/24', gateway: '10.0.3.1', mtu: 9000, inclusionRanges: [{ kind: 'range', start: '10.0.3.10', end: '10.0.3.20' }] },
      nsxHostOverlay: { vlanId: 1614, cidr: '10.0.4.0/24', gateway: '10.0.4.1', mtu: 9000, inclusionRanges: [{ kind: 'range', start: '10.0.4.10', end: '10.0.4.30' }] },
    },
    components: {
      vcfOperationsPrimaryFqdn: FQDNS.opsPrimary[0],
      vcfOperationsReplicaFqdn: FQDNS.opsReplica[0],
      cloudProxyFqdn: FQDNS.cloudProxy[0],
      licenseServerFqdn: FQDNS.license[0],
      fleetComponentsFqdn: FQDNS.fleet[0],
      instanceComponentsFqdn: FQDNS.instance[0],
      identityBrokerFqdn: FQDNS.idb[0],
      servicesRuntimeFqdn: FQDNS.runtime[0],
      internalClusterCidrIpv4: '198.18.0.0/15',
      vcfAutomationFqdn: FQDNS.automation[0],
      vcfAutomationServicesRuntimeFqdn: FQDNS.automationRuntime[0],
    },
    vcenter: { fqdn: FQDNS.vcenter[0] },
    storageDetails: { datastoreName: 'sfo-m01-cl01-ds-vsan01' },
    vds: {
      profile: 'default',
      switches: [
        {
          name: 'sfo-m01-cl01-vds01',
          uplinks: 2,
          uplinkMode: 'vds-uplinks',
          trafficTypes: ['esx-management', 'vcf-management', 'vm-management', 'vmotion', 'vsan', 'nsx'],
          loadBalancing: 'route-based-on-physical-nic-load',
        },
      ],
    },
    nsx: { nodeFqdns: [FQDNS.nsx1[0], FQDNS.nsx2[0], FQDNS.nsx3[0]], vipFqdn: FQDNS.nsxVip[0] },
    sddcManager: { fqdn: FQDNS.sddc[0] },
  };
}

export function validEnv(): BringupEnvironment {
  return {
    installer: deployedInstaller(),
    depot: readyDepot(),
    hosts: [0, 1, 2, 3].map((i) => preparedHost(i)),
    dns: baseDns(),
  };
}
