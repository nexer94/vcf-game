import { describe, expect, it } from 'vitest';
import {
  type BringupEnvironment,
  type BringupSpec,
  type DeploymentEvent,
  type DeploymentState,
  type DeploymentStatus,
  ADDITIONAL_INSTANCE_SIZING,
  DEPLOYMENT_TRANSITIONS,
  PASSWORD_USERNAME_PART_MIN_LENGTH,
  FIRST_INSTANCE_SIZING,
  VCF_BINARIES,
  buildFleetFromBringup,
  configureDepot,
  configureHostNetwork,
  configureHostNtp,
  deployInstallerOva,
  fqdnRequirements,
  initialDepotState,
  initialDeploymentState,
  initialInstallerState,
  installEsx,
  installerAfterDeployment,
  instanceSizingFor,
  isVcfAutomationDeployedNow,
  managementDomainComponentsFor,
  newBareMetalHost,
  passwordContainsUsernamePart,
  regenerateHostCertificate,
  setBinaryStatus,
  setHostSsh,
  sizingProfileOf,
  transitionDeployment,
  validateBinariesForDeployment,
  validateBringupSpec,
  validateConfigureOfflineDepot,
  validateConfigureOnlineDepot,
  validateDeployInstallerOva,
  validateEsxHostsForBringup,
  validateFqdnSyntax,
  validateInstallerCanDeploy,
  validateInstallerHostNfsMount,
  validateInstallerPassword,
  workflowTypeOf,
} from '../bringup';
import { validateFleet, validateInstance } from '../architecture';
import { errorsOf, gameScopeOf, issue, recommendationsOf, warningsOf } from '../validation';
import {
  FQDNS,
  HOSTS,
  NTP,
  baseDns,
  deployedInstaller,
  installerOvf,
  makeDns,
  preparedHost,
  readyDepot,
  unwrap,
  validEnv,
  validSpec,
} from './fixtures';

const codes = (spec: BringupSpec, env: BringupEnvironment): string[] =>
  validateBringupSpec(spec, env).map((i) => i.code);

function run(state: DeploymentState, ...events: DeploymentEvent[]): DeploymentState {
  return events.reduce((s, e) => unwrap(transitionDeployment(s, e)), state);
}

describe('bring-up happy path', () => {
  it('valid HA-Small spec validates with no errors and no warnings', () => {
    const issues = validateBringupSpec(validSpec(), validEnv());
    expect(issues).toEqual([]);
  });

  it('valid Simple spec (1 NSX node, no replica) validates cleanly', () => {
    const s = validSpec();
    const { vcfOperationsReplicaFqdn: _r, ...comps } = s.components;
    void _r;
    const spec: BringupSpec = { ...s, model: 'simple', nsx: { ...s.nsx, nodeFqdns: [FQDNS.nsx1[0]] }, components: comps };
    expect(validateBringupSpec(spec, validEnv())).toEqual([]);
  });

  it('runs the deployment state machine to completion and builds a valid fleet', () => {
    const spec = validSpec();
    const env = validEnv();
    let st = run(initialDeploymentState('wizard'), { type: 'submit-for-review' }, { type: 'start-validation' });
    expect(st.status).toBe('validating');
    st = run(st, { type: 'validation-finished', issues: validateBringupSpec(spec, env) });
    expect(st.status).toBe('ready-to-deploy');
    st = run(st, { type: 'deploy' }, { type: 'deployment-succeeded' });
    expect(st.status).toBe('completed');

    const installer = installerAfterDeployment(env.installer);
    expect(installer.mode).toBe('installer'); // outside management: stays installer
    expect(installer.platformsDeployed).toBe(1);
    expect(validateInstallerCanDeploy(installer)).toEqual([]);

    const fleet = buildFleetFromBringup(
      spec,
      { fleetId: 'f1', fleetName: 'fleet-sfo', instanceId: 'i1', domainId: 'd1', clusterId: 'c1' },
      'single-rack',
    );
    expect(validateFleet(fleet)).toEqual([]);
    const inst = fleet.instances[0]!;
    expect(inst.isFirstInstance).toBe(true);
    expect(inst.managementDomain.clusters[0]!.hosts).toHaveLength(4);
    const nsxNodes = FIRST_INSTANCE_SIZING['ha-small'].nsx.nodes;
    expect(nsxNodes).toBe(3);
    expect(inst.managementDomain.components.find((c) => c.kind === 'vcf-operations')?.nodes).toBe(2);
    expect(workflowTypeOf(spec)).toBe('VCF');
  });

  it('documented recommendation (services runtime < 30 IPs) is neither error nor warning -> ready to deploy', () => {
    const s = validSpec();
    const spec: BringupSpec = {
      ...s,
      networks: { ...s.networks, managementServicesIpPool: { kind: 'range', start: '10.0.1.10', end: '10.0.1.29' } },
    };
    const issues = validateBringupSpec(spec, validEnv());
    expect(errorsOf(issues)).toEqual([]);
    expect(warningsOf(issues)).toEqual([]);
    expect(recommendationsOf(issues).map((i) => i.code)).toEqual(['SERVICES_RUNTIME_IPS_BELOW_RECOMMENDED']);
    const st = run(initialDeploymentState(), { type: 'submit-for-review' }, { type: 'start-validation' }, { type: 'validation-finished', issues });
    expect(st.status).toBe('ready-to-deploy');
  });

  it('warnings only -> awaiting acknowledgement -> acknowledge -> deploy', () => {
    // The bring-up model currently emits no documented installer warning; the state machine is
    // exercised with a synthetic warning (20 §5.1 semantics).
    const issues = [issue('ESX_NTP_NOT_RUNNING', 'warning', 'synthetic warning', '20 §5.1')];
    let st = run(initialDeploymentState(), { type: 'submit-for-review' }, { type: 'start-validation' }, { type: 'validation-finished', issues });
    expect(st.status).toBe('awaiting-acknowledgement');
    expect(transitionDeployment(st, { type: 'deploy' }).ok).toBe(false);
    st = run(st, { type: 'acknowledge-warnings' });
    expect(st).toMatchObject({ status: 'ready-to-deploy', warningsAcknowledged: true });
    st = run(st, { type: 'deploy' });
    expect(st.status).toBe('deploying');
  });

  it('errors block deploy until edited and re-validated', () => {
    const spec = { ...validSpec(), size: 'large' as const, model: 'simple' as const };
    const issues = validateBringupSpec(spec, validEnv());
    let st = run(initialDeploymentState('json'), { type: 'submit-for-review' }, { type: 'start-validation' }, { type: 'validation-finished', issues });
    expect(st.status).toBe('validation-failed');
    expect(transitionDeployment(st, { type: 'deploy' }).ok).toBe(false);
    expect(transitionDeployment(st, { type: 'acknowledge-warnings' }).ok).toBe(false);
    st = run(st, { type: 'edit' }, { type: 'submit-for-review' }, { type: 'start-validation' }, { type: 'validation-finished', issues: [] });
    expect(st.status).toBe('ready-to-deploy');
    expect(st.source).toBe('json');
  });

  it('failed task -> retry -> success', () => {
    let st = run(initialDeploymentState(), { type: 'submit-for-review' }, { type: 'start-validation' }, { type: 'validation-finished', issues: [] }, { type: 'deploy' });
    st = run(st, { type: 'task-failed', task: 'Deploy NSX Manager' });
    expect(st).toMatchObject({ status: 'deployment-failed', failedTask: 'Deploy NSX Manager' });
    expect(transitionDeployment(st, { type: 'edit' }).ok).toBe(false);
    st = run(st, { type: 'retry' });
    expect(st.status).toBe('deploying');
    expect(st.failedTask).toBeUndefined();
    st = run(st, { type: 'deployment-succeeded' });
    expect(st.status).toBe('completed');
  });
});

describe('deployment state machine rejects illegal transitions', () => {
  const allEvents: DeploymentEvent[] = [
    { type: 'submit-for-review' },
    { type: 'edit' },
    { type: 'start-validation' },
    { type: 'validation-finished', issues: [] },
    { type: 'acknowledge-warnings' },
    { type: 'deploy' },
    { type: 'task-failed', task: 't' },
    { type: 'retry' },
    { type: 'deployment-succeeded' },
  ];
  const statuses = Object.keys(DEPLOYMENT_TRANSITIONS) as DeploymentStatus[];
  for (const status of statuses) {
    for (const ev of allEvents) {
      const allowed = DEPLOYMENT_TRANSITIONS[status].includes(ev.type);
      it(`${status} + ${ev.type} -> ${allowed ? 'ok' : 'rejected'}`, () => {
        const r = transitionDeployment({ status, source: 'wizard', issues: [], warningsAcknowledged: false }, ev);
        expect(r.ok).toBe(allowed);
        if (!r.ok) expect(r.error.code).toBe('ILLEGAL_DEPLOYMENT_TRANSITION');
      });
    }
  }
  it('cannot deploy straight from draft', () => {
    expect(transitionDeployment(initialDeploymentState(), { type: 'deploy' }).ok).toBe(false);
  });
  it('completed is terminal', () => {
    expect(DEPLOYMENT_TRANSITIONS.completed).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Each validation fires on its documented error state.
// ---------------------------------------------------------------------------

type Mut = (s: BringupSpec, e: BringupEnvironment) => [BringupSpec, BringupEnvironment];

function withDns(e: BringupEnvironment, extra: readonly (readonly [string, string])[], drop: readonly string[] = []): BringupEnvironment {
  const entries = [...Object.entries(e.dns.forward).filter(([f]) => !drop.includes(f)), ...extra];
  return { ...e, dns: makeDns(entries) };
}

const replaceHost = (e: BringupEnvironment, i: number, h: BringupEnvironment['hosts'][number]): BringupEnvironment => ({
  ...e,
  hosts: e.hosts.map((x, j) => (j === i ? h : x)),
});

const cases: [string, Mut, ('error' | 'warning' | 'recommendation')?][] = [
  ['INSTALLER_IN_SDDC_MANAGER_MODE', (s, e) => [s, { ...e, installer: { ...e.installer, mode: 'sddc-manager' } }]],
  ['INSTALLER_NOT_DEPLOYED', (s, e) => [s, { ...e, installer: initialInstallerState() }]],
  ['INSTALLER_SINGLE_PLATFORM', (s, e) => [s, { ...e, installer: { ...deployedInstaller({ placement: 'management-host', datastore: 'local-disk' }), platformsDeployed: 1 } }]],
  ['INSTALLER_VERSION_TOO_OLD', (s, e) => [s, { ...e, installer: { ...e.installer, version: '9.1.0.400' } }]],
  ['NEW_INSTANCE_REQUIRES_EXISTING_OPS', (s, e) => [{ ...s, target: 'new-instance' }, e]],
  ['EXISTING_OPS_REQUIRES_EXISTING_VCENTER', (s, e) => [{ ...s, existing: { ...s.existing, existingVcfOperations: true } }, e]],
  ['NSX_REGISTRATION_REQUIRES_EXISTING_VCENTER', (s, e) => [{ ...s, existing: { ...s.existing, vcenterRegisteredWithNsx: true } }, e]],
  ['CONVERGENCE_NOT_MODELLED', (s, e) => [{ ...s, existing: { ...s.existing, existingVcenter: true } }, e]],
  ['SIZE_NOT_ALLOWED_FOR_MODEL', (s, e) => [{ ...s, model: 'simple', size: 'medium' }, e]],
  ['DUAL_STACK_REQUIRES_DUAL_STACK_INSTALLER', (s, e) => [{ ...s, networkConfig: { ...s.networkConfig, dualStack: true } }, e]],
  ['CUSTOM_NETWORK_ONLY_NEW_FLEET', (s, e) => [{ ...s, target: 'new-instance', networkConfig: { ...s.networkConfig, deployOpsAndAutomationToCustomNetwork: true } }, e]],
  ['CUSTOM_NETWORK_WITH_EXISTING_OPS', (s, e) => [{ ...s, existing: { ...s.existing, existingVcfOperations: true }, networkConfig: { ...s.networkConfig, deployOpsAndAutomationToCustomNetwork: true } }, e]],
  ['DIT_ENCRYPTION_VSAN_ONLY', (s, e) => [{ ...s, storage: { type: 'vmfs-fc', vmfsDatastoreAttachedToAllHosts: true, vsanDataInTransitEncryption: { enabled: true } } }, e]],
  ['VMFS_DATASTORE_NOT_ON_ALL_HOSTS', (s, e) => [{ ...s, storage: { type: 'vmfs-fc', vmfsDatastoreAttachedToAllHosts: false } }, e]],
  ['NFS_SERVER_MISSING', (s, e) => [{ ...s, storage: { type: 'nfs-v3', nfsServerExists: false }, storageDetails: { datastoreName: 'ds', nfsSharePath: '/x', nfsServerIpv4: '10.0.3.5' } }, e]],
  ['NFS_DETAILS_MISSING', (s, e) => [{ ...s, storage: { type: 'nfs-v3', nfsServerExists: true } }, e]],
  ['NFS_SINGLE_UPLINK_VDS_UNSUPPORTED', (s, e) => [{ ...s, storage: { type: 'nfs-v3', nfsServerExists: true }, storageDetails: { datastoreName: 'ds', nfsSharePath: '/x', nfsServerIpv4: '10.0.3.5' }, vds: { ...s.vds, switches: [{ ...s.vds.switches[0]!, uplinks: 1 }] } }, e]],
  ['NFS_SINGLE_PNIC_UNSUPPORTED', (s, e) => [{ ...s, storage: { type: 'nfs-v3', nfsServerExists: true }, storageDetails: { datastoreName: 'ds', nfsSharePath: '/x', nfsServerIpv4: '10.0.3.5' } }, replaceHost(e, 0, preparedHost(0, { pnics: 1 }))]],
  ['DATASTORE_NAME_MISSING', (s, e) => [{ ...s, storageDetails: { datastoreName: ' ' } }, e]],
  ['INSTANCE_NAME_MISSING', (s, e) => [{ ...s, general: { ...s.general, instanceName: '' } }, e]],
  ['INSTANCE_NAME_NOT_UNIQUE', (s, e) => [s, { ...e, existingInstanceNames: ['sfo-m01'] }]],
  ['MGMT_DOMAIN_NAME_MISSING', (s, e) => [{ ...s, general: { ...s.general, managementDomainName: '' } }, e]],
  ['DNS_DOMAIN_MISSING', (s, e) => [{ ...s, general: { ...s.general, dnsDomainName: '' } }, e]],
  ['DNS_SERVERS_MISSING', (s, e) => [{ ...s, general: { ...s.general, dnsServers: [] } }, e]],
  ['NTP_SERVERS_MISSING', (s, e) => [{ ...s, general: { ...s.general, ntpServers: [] } }, e]],
  ['DNS_RECORD_MISSING', (s, e) => [s, withDns(e, [], [NTP])]],
  ['ESX_HOST_DUPLICATE', (s, e) => [{ ...s, esxHosts: [...s.esxHosts, s.esxHosts[0]!] }, e]],
  ['ESX_HOST_NOT_FOUND', (s, e) => [{ ...s, esxHosts: [...s.esxHosts, { fqdn: 'esx99.sfo.rainpole.io' }] }, e]],
  ['ESX_FQDN_MISMATCH', (s, e) => {
    const h = e.hosts[0]!;
    const renamed = unwrap(configureHostNetwork(h, { ...h.network!, hostnameFqdn: 'esx01-new.sfo.rainpole.io' }));
    return [s, replaceHost(e, 0, renamed)];
  }],
  // Fixture is HA + vSAN ESA: 10 §6.1 requires 4 hosts in the management default cluster.
  ['MGMT_DOMAIN_TOO_FEW_HOSTS', (s, e) => [{ ...s, esxHosts: s.esxHosts.slice(0, 3) }, e]],
  ['ESX_HETEROGENEOUS_CLUSTER', (s, e) => [s, replaceHost(e, 1, preparedHost(1, { profile: 'profile-2' }))]],
  ['ESX_MULTIPLE_VENDORS', (s, e) => [s, replaceHost(e, 1, preparedHost(1, { vendor: 'VendorB' }))]],
  ['ESX_STATELESS', (s, e) => [s, replaceHost(e, 0, { ...e.hosts[0]!, stateless: true })]],
  ['ESX_VERSION_MISMATCH', (s, e) => [s, { ...e, rules: { requiredEsxVersion: '9.1.2' } }]],
  ['ESX_VMK0_NOT_ON_VSS', (s, e) => [s, replaceHost(e, 0, { ...e.hosts[0]!, vmk0OnStandardSwitch: false })]],
  ['ESX_STATIC_IP_INVALID', (s, e) => [s, replaceHost(e, 0, { ...e.hosts[0]!, network: { ...e.hosts[0]!.network!, ipv4Address: 'dhcp' } })]],
  ['ESX_CUSTOM_DNS_SUFFIXES', (s, e) => [s, replaceHost(e, 0, { ...e.hosts[0]!, network: { ...e.hosts[0]!.network!, customDnsSuffixes: ['rainpole.io'] } })]],
  ['ESX_CERT_CN_MISMATCH', (s, e) => [s, replaceHost(e, 0, { ...e.hosts[0]!, certificateCn: 'localhost.localdomain' })]],
  ['ESX_NTP_NOT_RUNNING', (s, e) => [s, replaceHost(e, 0, { ...e.hosts[0]!, ntp: { ...e.hosts[0]!.ntp, serviceRunning: false } })]],
  ['DNS_IP_MISMATCH', (s, e) => [s, withDns(e, [[HOSTS[0]![0], '10.0.0.199']], [HOSTS[0]![0]])]],
  ['IP_POOL_INVALID', (s, e) => [{ ...s, networks: { ...s.networks, managementServicesIpPool: { kind: 'range', start: '10.0.1.40', end: '10.0.1.10' } } }, e]],
  ['SERVICES_RUNTIME_IPS_TOO_FEW', (s, e) => [{ ...s, networks: { ...s.networks, managementServicesIpPool: { kind: 'range', start: '10.0.1.10', end: '10.0.1.20' } } }, e]],
  ['SERVICES_RUNTIME_IPS_BELOW_RECOMMENDED', (s, e) => [{ ...s, networks: { ...s.networks, managementServicesIpPool: { kind: 'range', start: '10.0.1.10', end: '10.0.1.21' } } }, e], 'recommendation'],
  ['VCF_AUTOMATION_IPS_TOO_FEW', (s, e) => [{ ...s, networks: { ...s.networks, vcfAutomationIpPool: { kind: 'addresses', addresses: ['10.0.1.50', '10.0.1.51', '10.0.1.52', '10.0.1.53'] } } }, e]],
  ['INTERNAL_CIDR_INVALID', (s, e) => [{ ...s, components: { ...s.components, internalClusterCidrIpv4: '10.244.0.0/16' } }, e]],
  ['HOST_NETWORK_MISSING', (s, e) => {
    const { storage: _s, ...nets } = s.networks;
    void _s;
    return [{ ...s, networks: nets }, e];
  }],
  ['NETWORK_CIDR_INVALID', (s, e) => [{ ...s, networks: { ...s.networks, vmotion: { ...s.networks.vmotion, cidr: 'nope' } } }, e]],
  ['INCLUSION_RANGE_TOO_SMALL', (s, e) => [{ ...s, networks: { ...s.networks, nsxHostOverlay: { ...s.networks.nsxHostOverlay!, inclusionRanges: [{ kind: 'range', start: '10.0.4.10', end: '10.0.4.15' }] } } }, e]],
  ['INCLUSION_RANGE_OUTSIDE_SUBNET', (s, e) => [{ ...s, networks: { ...s.networks, vmotion: { ...s.networks.vmotion, inclusionRanges: [{ kind: 'range', start: '10.0.9.10', end: '10.0.9.20' }] } } }, e]],
  ['INCLUSION_RANGE_NETWORK_OR_BROADCAST', (s, e) => [{ ...s, networks: { ...s.networks, vmotion: { ...s.networks.vmotion, inclusionRanges: [{ kind: 'range', start: '10.0.2.250', end: '10.0.2.255' }] } } }, e]],
  ['IP_CONFLICT', (s, e) => [{ ...s, networks: { ...s.networks, vcfAutomationIpPool: { kind: 'range', start: '10.0.1.35', end: '10.0.1.39' } } }, e]],
  ['FQDN_REQUIRED', (s, e) => {
    const { identityBrokerFqdn: _i, ...c } = s.components;
    void _i;
    return [{ ...s, components: c }, e];
  }],
  ['FQDN_NOT_LOWERCASE', (s, e) => [{ ...s, components: { ...s.components, fleetComponentsFqdn: 'Fleet01.sfo.rainpole.io' } }, e]],
  ['FQDN_LOCAL_DOMAIN', (s, e) => [{ ...s, components: { ...s.components, identityBrokerFqdn: 'idb01.corp.local' } }, withDns(e, [['idb01.corp.local', '10.0.0.60']], [FQDNS.idb[0]])]],
  ['INSTALLER_HOST_NFS_NOT_MOUNTED', (s, e) => [nfsSpec(s), { ...e, installer: deployedInstaller({ placement: 'management-host', datastore: 'local-disk', esxHostId: 'h1', hostnameFqdn: FQDNS.sddc[0], ipv4Address: FQDNS.sddc[1] }) }]],
  ['FQDN_TLD_INVALID', (s, e) => [{ ...s, vcenter: { fqdn: 'vc01.corp.io1' } }, withDns(e, [['vc01.corp.io1', '10.0.0.61']])]],
  ['FQDN_NOT_FULLY_QUALIFIED', (s, e) => [{ ...s, vcenter: { fqdn: 'vc01' } }, withDns(e, [['vc01', '10.0.0.62']])]],
  ['FQDN_IP_NOT_UNIQUE', (s, e) => [s, withDns(e, [[FQDNS.vcenter[0], FQDNS.sddc[1]], [FQDNS.sddc[0], FQDNS.sddc[1]]], [FQDNS.vcenter[0]])]],
  ['FQDN_IP_IN_RESERVED_RANGE', (s, e) => [s, withDns(e, [[FQDNS.vcenter[0], '10.0.1.15']], [FQDNS.vcenter[0]])]],
  ['NSX_NODE_COUNT', (s, e) => [{ ...s, nsx: { ...s.nsx, nodeFqdns: [FQDNS.nsx1[0]] } }, e]],
  ['NSX_DISTRIBUTED_CONNECTIVITY_MISSING', (s, e) => [{ ...s, networkConfig: { ...s.networkConfig, vpcGatewayConnectivity: 'distributed' } }, e]],
  ['VDS_NONE', (s, e) => [{ ...s, vds: { profile: 'custom', switches: [] } }, e]],
  ['VDS_PROFILE_SWITCH_COUNT', (s, e) => [{ ...s, vds: { ...s.vds, profile: 'storage-traffic-separation' } }, e]],
  ['VDS_NO_UPLINK', (s, e) => [{ ...s, vds: { profile: 'custom', switches: [{ ...s.vds.switches[0]!, uplinks: 0 }] } }, e]],
  ['VDS_UPLINKS_EXCEED_PNICS', (s, e) => [{ ...s, vds: { profile: 'custom', switches: [{ ...s.vds.switches[0]!, uplinks: 4 }] } }, e]],
  ['LAG_PHYSICAL_NETWORK_NOT_READY', (s, e) => [{ ...s, vds: { ...s.vds, switches: [{ ...s.vds.switches[0]!, uplinkMode: 'vds-lag' }] } }, { ...e, physicalNetworkLagReady: false }]],
  ['SDDC_MANAGER_FQDN_FIXED', (s, e) => [s, { ...e, installer: deployedInstaller({ placement: 'management-host', datastore: 'local-disk' }) }]],
  ['INSTALLER_CANNOT_REACH', (s, e) => [s, { ...e, unreachableFromInstaller: [NTP] }]],
  ['BINARY_NOT_DOWNLOADED', (s, e) => [s, { ...e, depot: { ...e.depot, binaries: { ...e.depot.binaries, 'VMware NSX': 'downloading' } } }]],
];

function nfsSpec(s: BringupSpec): BringupSpec {
  return { ...s, storage: { type: 'nfs-v3', nfsServerExists: true }, storageDetails: { datastoreName: 'ds', nfsSharePath: '/x', nfsServerIpv4: '10.0.3.5' } };
}

describe('validateBringupSpec: each validation fires', () => {
  for (const [code, mut, severity = 'error'] of cases) {
    it(code, () => {
      const [spec, env] = mut(validSpec(), validEnv());
      const issues = validateBringupSpec(spec, env);
      const hit = issues.find((i) => i.code === code);
      expect(hit, `expected ${code}, got ${issues.map((i) => i.code).join(', ')}`).toBeDefined();
      expect(hit!.severity).toBe(severity);
      expect(hit!.specRef).toMatch(/§|\[S\d+\]/);
    });
  }

  it('custom networking defers VCF Operations / cloud proxy / license / Automation FQDNs', () => {
    const s = validSpec();
    const spec: BringupSpec = { ...s, networkConfig: { ...s.networkConfig, deployOpsAndAutomationToCustomNetwork: true } };
    const req = fqdnRequirements(spec).filter((r) => r.required).map((r) => r.field);
    expect(req).not.toContain('VCF Operations primary node FQDN');
    expect(req).not.toContain('Cloud Proxy FQDN');
    expect(req).not.toContain('License Server FQDN');
    expect(req).not.toContain('VCF Automation FQDN');
  });

  it('data node FQDN required only for HA Medium / Large', () => {
    const field = 'VCF Operations data node FQDN';
    const req = (spec: BringupSpec) => fqdnRequirements(spec).find((r) => r.field === field)!.required;
    expect(req(validSpec())).toBe(false);
    expect(req({ ...validSpec(), size: 'medium' })).toBe(true);
    expect(codes({ ...validSpec(), size: 'medium' }, validEnv())).toContain('FQDN_REQUIRED');
  });

  it('VLAN-backed VPC needs no NSX host overlay network', () => {
    const s = validSpec();
    const { nsxHostOverlay: _o, ...nets } = s.networks;
    void _o;
    const spec: BringupSpec = { ...s, networks: nets, networkConfig: { ...s.networkConfig, vpcNetwork: 'vlan-backed' } };
    expect(validateBringupSpec(spec, validEnv())).toEqual([]);
  });

  it('sizing profile mapping', () => {
    expect(sizingProfileOf('simple', 'small')).toBe('simple');
    expect(sizingProfileOf('high-availability', 'large')).toBe('ha-large');
    expect(FIRST_INSTANCE_SIZING.simple.totals).toEqual({ vcpu: 76, ramGb: 251, diskGb: 7448 });
  });
});

describe('VCF Installer appliance', () => {
  const dns = baseDns();
  it('valid OVA deploy puts appliance in installer mode', () => {
    const st = unwrap(deployInstallerOva(initialInstallerState(), installerOvf(), dns));
    expect(st.mode).toBe('installer');
  });

  it.each([
    ['short1A!', 'PASSWORD_TOO_SHORT'],
    ['xq7#rainpole!2026z', 'PASSWORD_NO_UPPERCASE'],
    ['XQ7#RAINPOLE!2026Z', 'PASSWORD_NO_LOWERCASE'],
    ['Xq#Rainpole!abcdez', 'PASSWORD_NO_DIGIT'],
    ['Xq7Rainpole2026zzz', 'PASSWORD_NO_SPECIAL'],
    ['Xq7#Root!2026zzzzz', 'PASSWORD_CONTAINS_USERNAME'],
  ])('password %s -> %s', (pw, code) => {
    const issues = validateInstallerPassword(pw, 'Root user password', { usernames: ['root'] });
    expect(issues.map((i) => i.code)).toContain(code);
    expect(issues.every((i) => i.severity === 'error')).toBe(true);
  });

  it('dictionary word check uses the supplied dictionary', () => {
    const issues = validateInstallerPassword('Xq7#Rainpole!2026z', 'p', { usernames: [], dictionaryWords: ['rainpole'] });
    expect(issues.map((i) => i.code)).toEqual(['PASSWORD_CONTAINS_DICTIONARY_WORD']);
  });

  it.each([
    ['INSTALLER_TOO_MANY_DNS_SERVERS', { dnsServers: ['10.0.0.4', '10.0.0.5', '10.0.0.6'] }],
    ['INSTALLER_STATIC_IP_INVALID', { ipv4Address: '' }],
    ['INSTALLER_IPV6_MISSING', { ipVersion: 'ipv4-ipv6' as const }],
    ['INSTALLER_DATASTORE_NOT_LOCAL', { placement: 'management-host' as const, datastore: 'other' as const }],
    ['DNS_RECORD_MISSING', { hostnameFqdn: 'missing.sfo.rainpole.io' }],
  ])('%s', (code, over) => {
    const issues = validateDeployInstallerOva(initialInstallerState(), installerOvf(over), dns);
    expect(issues.map((i) => i.code)).toContain(code);
    expect(deployInstallerOva(initialInstallerState(), installerOvf(over), dns).ok).toBe(false);
  });

  it('cannot deploy OVA twice', () => {
    const st = deployedInstaller();
    expect(validateDeployInstallerOva(st, installerOvf(), dns).map((i) => i.code)).toContain('INSTALLER_ALREADY_DEPLOYED');
  });

  it('on a management host: switches to SDDC Manager mode and can no longer deploy', () => {
    const st = installerAfterDeployment(deployedInstaller({ placement: 'management-host', datastore: 'local-disk' }));
    expect(st.mode).toBe('sddc-manager');
    expect(validateInstallerCanDeploy(st).map((i) => i.code)).toEqual(['INSTALLER_IN_SDDC_MANAGER_MODE']);
  });

  it('outside management: can deploy multiple platforms', () => {
    let st = deployedInstaller();
    st = installerAfterDeployment(installerAfterDeployment(st));
    expect(st.platformsDeployed).toBe(2);
    expect(validateInstallerCanDeploy(st)).toEqual([]);
  });
});

describe('ESX host preparation transitions', () => {
  const bare = newBareMetalHost('h', { hwVendor: 'V', hwProfileId: 'p', pnicCount: 2 });
  const net = {
    ipv4Address: HOSTS[0]![1],
    subnetMask: '255.255.255.0',
    defaultGateway: '10.0.0.1',
    dnsServers: ['10.0.0.4'],
    hostnameFqdn: HOSTS[0]![0],
    customDnsSuffixes: [],
  };

  it('network config requires installed ESX', () => {
    const r = configureHostNetwork(bare, net);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ESX_NOT_INSTALLED');
  });

  it('NTP requires management network', () => {
    const r = configureHostNtp(unwrap(installEsx(bare, '9.1.1')), [NTP]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ESX_NETWORK_NOT_CONFIGURED');
  });

  it('certificate regeneration requires SSH and sets CN to the hostname', () => {
    const h = unwrap(configureHostNetwork(unwrap(installEsx(bare, '9.1.1')), net));
    const r = regenerateHostCertificate(h);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('ESX_SSH_DISABLED');
    const ok = unwrap(regenerateHostCertificate(unwrap(setHostSsh(h, true))));
    expect(ok.certificateCn).toBe(HOSTS[0]![0]);
  });

  it('fresh install has CN localhost.localdomain', () => {
    expect(unwrap(installEsx(bare, '9.1.1')).certificateCn).toBe('localhost.localdomain');
  });
});

describe('depot and binaries', () => {
  it('online depot validations', () => {
    expect(validateConfigureOnlineDepot({ activationCode: '' }).map((i) => i.code)).toEqual(['DEPOT_ACTIVATION_CODE_MISSING']);
    const proxy = { protocol: 'http' as const, host: 'proxy', port: 3128, sslInterception: false, proxyCaInTruststore: false };
    expect(validateConfigureOnlineDepot({ activationCode: 'a', proxy: { ...proxy, auth: 'kerberos' } }).map((i) => i.code)).toEqual(['DEPOT_PROXY_AUTH_UNSUPPORTED']);
    expect(validateConfigureOnlineDepot({ activationCode: 'a', proxy: { ...proxy, auth: 'ntlmv2' } }).map((i) => i.code)).toEqual(['DEPOT_PROXY_AUTH_UNSUPPORTED']);
    expect(validateConfigureOnlineDepot({ activationCode: 'a', proxy: { ...proxy, auth: 'basic', sslInterception: true } }).map((i) => i.code)).toEqual(['DEPOT_SSL_INTERCEPTION']);
    expect(validateConfigureOnlineDepot({ activationCode: 'a', proxy: { ...proxy, auth: 'basic', sslInterception: true, proxyCaInTruststore: true } })).toEqual([]);
  });

  it('offline depot validations', () => {
    expect(validateConfigureOfflineDepot({ url: '', certificateImported: false, servicesRestarted: false }).map((i) => i.code)).toEqual(['DEPOT_URL_MISSING']);
    expect(validateConfigureOfflineDepot({ url: 'https://depot.sfo.rainpole.io', certificateImported: true, servicesRestarted: false }).map((i) => i.code)).toEqual(['DEPOT_CERT_NOT_TRUSTED']);
  });

  it('offline depot replaces online configuration (only one depot type)', () => {
    const online = unwrap(configureDepot(initialDepotState(), { kind: 'online', input: { activationCode: 'a' } }));
    const offline = unwrap(configureDepot(online, { kind: 'offline', input: { url: 'http://depot', certificateImported: false, servicesRestarted: false } }));
    expect(offline.connection.kind).toBe('offline');
  });

  it('download requires a connected depot; illegal status jumps rejected', () => {
    const r = setBinaryStatus(initialDepotState(), 'VMware NSX', 'downloading');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('DEPOT_NOT_CONNECTED');
    const d = unwrap(configureDepot(initialDepotState(), { kind: 'online', input: { activationCode: 'a' } }));
    const jump = setBinaryStatus(d, 'VMware NSX', 'downloaded');
    expect(jump.ok).toBe(false);
    if (!jump.ok) expect(jump.error.code).toBe('ILLEGAL_BINARY_TRANSITION');
  });

  it('all 16 binaries required; reused products skipped', () => {
    expect(VCF_BINARIES).toHaveLength(16);
    expect(validateBinariesForDeployment(initialDepotState())).toHaveLength(16);
    expect(validateBinariesForDeployment(readyDepot())).toEqual([]);
    expect(validateBinariesForDeployment(initialDepotState(), ['VMware vCenter'])).toHaveLength(15);
  });
});

// ---------------------------------------------------------------------------
// Fact-check fixes: .local / lowercase per field class (20 §3.5, §5.1, §8 q15),
// replica HA-only (q10), new-instance components, game-scope flag, NFS mount, password parts.
// ---------------------------------------------------------------------------

describe('FQDN .local and lowercase rules per field (20 §3.5 [S14][S19][S55])', () => {
  const local = (fqdn: string): string => fqdn.replace(/\.[^.]+\.[^.]+$/, '.corp.local');

  type FieldKey = keyof typeof FQDNS;
  const apply = (s: BringupSpec, key: FieldKey, fqdn: string): BringupSpec => {
    const c = s.components;
    switch (key) {
      case 'vcenter': return { ...s, vcenter: { fqdn } };
      case 'sddc': return { ...s, sddcManager: { fqdn } };
      case 'nsxVip': return { ...s, nsx: { ...s.nsx, vipFqdn: fqdn } };
      case 'nsx1': return { ...s, nsx: { ...s.nsx, nodeFqdns: [fqdn, ...s.nsx.nodeFqdns.slice(1)] } };
      case 'opsPrimary': return { ...s, components: { ...c, vcfOperationsPrimaryFqdn: fqdn } };
      case 'opsReplica': return { ...s, components: { ...c, vcfOperationsReplicaFqdn: fqdn } };
      case 'cloudProxy': return { ...s, components: { ...c, cloudProxyFqdn: fqdn } };
      case 'license': return { ...s, components: { ...c, licenseServerFqdn: fqdn } };
      case 'fleet': return { ...s, components: { ...c, fleetComponentsFqdn: fqdn } };
      case 'instance': return { ...s, components: { ...c, instanceComponentsFqdn: fqdn } };
      case 'idb': return { ...s, components: { ...c, identityBrokerFqdn: fqdn } };
      case 'runtime': return { ...s, components: { ...c, servicesRuntimeFqdn: fqdn } };
      case 'automation': return { ...s, components: { ...c, vcfAutomationFqdn: fqdn } };
      case 'automationRuntime': return { ...s, components: { ...c, vcfAutomationServicesRuntimeFqdn: fqdn } };
      default: throw new Error(`unsupported ${key}`);
    }
  };
  const withFqdn = (key: FieldKey, fqdn: string): string[] => {
    const [orig, ip] = FQDNS[key];
    const e = validEnv();
    const entries = [...Object.entries(e.dns.forward).filter(([f]) => f !== orig), [fqdn.toLowerCase(), ip] as const];
    return codes(apply(validSpec(), key, fqdn), { ...e, dns: makeDns(entries) });
  };

  const containerized: FieldKey[] = ['fleet', 'instance', 'idb', 'runtime', 'automation', 'automationRuntime'];
  const traditional: FieldKey[] = ['vcenter', 'sddc', 'nsxVip', 'nsx1', 'opsPrimary', 'opsReplica'];
  const unclassified: FieldKey[] = ['cloudProxy', 'license'];

  it.each(containerized)('%s: .local -> FQDN_LOCAL_DOMAIN, capitals -> FQDN_NOT_LOWERCASE', (key) => {
    expect(withFqdn(key, local(FQDNS[key][0]))).toEqual(['FQDN_LOCAL_DOMAIN']);
    expect(withFqdn(key, FQDNS[key][0].toUpperCase())).toEqual(['FQDN_NOT_LOWERCASE']);
  });

  it.each(traditional)('%s (traditional appliance): .local and capitals allowed', (key) => {
    expect(withFqdn(key, local(FQDNS[key][0]))).toEqual([]);
    expect(withFqdn(key, FQDNS[key][0].replace(/^./, (ch) => ch.toUpperCase()))).toEqual([]);
  });

  it.each(unclassified)('%s (20 §8 q15): .local and capitals not validated', (key) => {
    expect(withFqdn(key, local(FQDNS[key][0]))).toEqual([]);
    expect(withFqdn(key, FQDNS[key][0].toUpperCase())).toEqual([]);
  });

  it('ESX host with .local FQDN is allowed', () => {
    const h = preparedHost(0);
    const n = { ...h.network!, hostnameFqdn: 'esx01.corp.local' };
    const host = { ...h, network: n, certificateCn: 'esx01.corp.local' };
    const dns = makeDns([['esx01.corp.local', n.ipv4Address]]);
    const issues = validateEsxHostsForBringup([host, preparedHost(1), preparedHost(2), preparedHost(3)], { dns: { forward: { ...baseDns().forward, ...dns.forward }, reverse: { ...baseDns().reverse, ...dns.reverse } }, model: 'high-availability', storage: 'vsan-esa' });
    expect(issues.map((i) => i.code)).toEqual([]);
  });

  it('VCF Installer appliance FQDN: .local / capitals not validated (20 §8 q15)', () => {
    const dns = makeDns([['VCFInstaller.corp.local', '10.0.0.250']]);
    const issues = validateDeployInstallerOva(initialInstallerState(), installerOvf({ hostnameFqdn: 'VCFInstaller.corp.local', ipv4Address: '10.0.0.250' }), {
      forward: { 'vcfinstaller.corp.local': '10.0.0.250' },
      reverse: dns.reverse,
    });
    expect(issues).toEqual([]);
  });

  it('validateFqdnSyntax defaults to no .local / lowercase check', () => {
    expect(validateFqdnSyntax('VC01.corp.local', 'x')).toEqual([]);
    expect(validateFqdnSyntax('VC01.corp.local', 'x', 'traditional-appliance')).toEqual([]);
    expect(validateFqdnSyntax('VC01.corp.local', 'x', 'containerized-service').map((i) => i.code)).toEqual(['FQDN_NOT_LOWERCASE', 'FQDN_LOCAL_DOMAIN']);
  });

  it('fqdnRequirements classifies exactly the six containerized fields', () => {
    const cls = fqdnRequirements(validSpec()).filter((r) => r.fqdnClass === 'containerized-service').map((r) => r.field);
    expect(cls.sort()).toEqual(
      [
        'Fleet components FQDN',
        'Identity broker FQDN',
        'Instance components FQDN',
        'VCF Automation FQDN',
        'VCF services runtime FQDN',
        'VCF services runtime FQDN for VCF Automation',
      ].sort(),
    );
  });
});

describe('replica node FQDN only for HA (20 §8 q10)', () => {
  const field = 'VCF Operations replica node FQDN';
  const req = (spec: BringupSpec) => fqdnRequirements(spec).find((r) => r.field === field)!.required;
  it('required in HA, not in Simple', () => {
    expect(req(validSpec())).toBe(true);
    expect(req({ ...validSpec(), model: 'simple' })).toBe(false);
  });
  it('missing replica in HA -> FQDN_REQUIRED', () => {
    const s = validSpec();
    const { vcfOperationsReplicaFqdn: _r, ...c } = s.components;
    void _r;
    const issues = validateBringupSpec({ ...s, components: c }, validEnv());
    expect(issues.filter((i) => i.code === 'FQDN_REQUIRED').map((i) => i.subject)).toEqual([field]);
  });
});

describe('CONVERGENCE_NOT_MODELLED is a game-scope limitation', () => {
  it('carries scope game-scope; other issues do not', () => {
    const s = validSpec();
    const issues = validateBringupSpec({ ...s, existing: { ...s.existing, existingVcenter: true } }, validEnv());
    expect(gameScopeOf(issues).map((i) => i.code)).toEqual(['CONVERGENCE_NOT_MODELLED']);
    expect(issues.filter((i) => i.code !== 'CONVERGENCE_NOT_MODELLED').every((i) => i.scope === undefined)).toBe(true);
  });
});

describe('new VCF Instance (target new-instance)', () => {
  const newInstanceSpec = (): BringupSpec => {
    const s = validSpec();
    return { ...s, target: 'new-instance', existing: { ...s.existing, existingVcfOperations: true } };
  };

  it('does not require VCF Automation / fleet components / VCF Operations FQDNs; identity broker optional', () => {
    const req = fqdnRequirements(newInstanceSpec()).filter((r) => r.required).map((r) => r.field);
    for (const f of ['VCF Automation FQDN', 'VCF services runtime FQDN for VCF Automation', 'Fleet components FQDN', 'Identity broker FQDN', 'VCF Operations primary node FQDN', 'License Server FQDN'])
      expect(req).not.toContain(f);
    expect(isVcfAutomationDeployedNow(newInstanceSpec())).toBe(false);
  });

  it('components: additional-instance sizing, no fleet-level services, no VCF Operations / Automation / license server', () => {
    const s = newInstanceSpec();
    const kinds = managementDomainComponentsFor(s).map((c) => c.kind);
    for (const k of ['vcf-operations', 'vcf-automation', 'license-server', 'fleet-lifecycle', 'salt-raas', 'software-depot'] as const) expect(kinds).not.toContain(k);
    for (const k of ['sddc-manager', 'cloud-proxy', 'vcf-services-runtime', 'sddc-lifecycle', 'salt-master', 'telemetry', 'identity-broker'] as const) expect(kinds).toContain(k);
    const runtime = managementDomainComponentsFor(s).find((c) => c.kind === 'vcf-services-runtime')!;
    const ms = ADDITIONAL_INSTANCE_SIZING['ha-small'].managementServices;
    expect(runtime.nodes).toBe(ms.controlPlaneNodes + ms.workerNodes);
    expect(instanceSizingFor(s)).toBe(ADDITIONAL_INSTANCE_SIZING['ha-small']);
  });

  it('identity broker is added only when its FQDN is supplied', () => {
    const s = newInstanceSpec();
    const { identityBrokerFqdn: _i, ...c } = s.components;
    void _i;
    expect(managementDomainComponentsFor({ ...s, components: c }).map((x) => x.kind)).not.toContain('identity-broker');
  });

  it('built instance is not first and passes validateInstance', () => {
    const fleet = buildFleetFromBringup(newInstanceSpec(), { fleetId: 'f', fleetName: 'f', instanceId: 'i2', domainId: 'd2', clusterId: 'c2' }, 'single-rack');
    const inst = fleet.instances[0]!;
    expect(inst.isFirstInstance).toBe(false);
    expect(validateInstance(inst)).toEqual([]);
  });
});

describe('NFS v3 with the installer on a management host (20 §3.2 [S7][S14])', () => {
  const env = (mounted: boolean | undefined, esxHostId: string | undefined): BringupEnvironment => {
    const e = validEnv();
    return {
      ...e,
      hosts: e.hosts.map((h) => (h.id === 'h1' && mounted !== undefined ? { ...h, nfsDatastoreMounted: mounted } : h)),
      installer: deployedInstaller({
        placement: 'management-host',
        datastore: 'local-disk',
        hostnameFqdn: FQDNS.sddc[0],
        ipv4Address: FQDNS.sddc[1],
        ...(esxHostId !== undefined ? { esxHostId } : {}),
      }),
    };
  };
  it('not mounted -> INSTALLER_HOST_NFS_NOT_MOUNTED; mounted -> ok; unknown host -> not checked', () => {
    expect(validateInstallerHostNfsMount(nfsSpec(validSpec()), env(undefined, 'h1')).map((i) => i.code)).toEqual(['INSTALLER_HOST_NFS_NOT_MOUNTED']);
    expect(validateInstallerHostNfsMount(nfsSpec(validSpec()), env(true, 'h1'))).toEqual([]);
    expect(validateInstallerHostNfsMount(nfsSpec(validSpec()), env(undefined, undefined))).toEqual([]);
    expect(validateInstallerHostNfsMount(validSpec(), env(undefined, 'h1'))).toEqual([]);
  });
});

describe('installer password: user name parts (modelling decision, 20 §3.6 [S6])', () => {
  it.each([
    ['Xq7#Admin!2026zzz', ['admin@local'], true],
    ['Xq7#Locals!2026zz', ['admin@local'], true],
    ['Xq7#Adm!Loc!2026z', ['admin@local'], false], // 3-char fragments are below the threshold
    ['Xq7#Rainpole!2026z', ['admin@local', 'vcf', 'root'], false],
    ['Xq7#VCF!2026zzzzz', ['vcf'], true], // short user name checked as a whole
    ['Xq7#Ro0t!2026zzzz', ['root'], false],
  ])('%s with %j -> %s', (pw, users, expected) => {
    expect(passwordContainsUsernamePart(pw, users[0]!) || users.some((u) => passwordContainsUsernamePart(pw, u))).toBe(expected);
    const codesFound = validateInstallerPassword(pw, 'p', { usernames: users }).map((i) => i.code);
    expect(codesFound.includes('PASSWORD_CONTAINS_USERNAME')).toBe(expected);
  });
  it('threshold constant is 4', () => {
    expect(PASSWORD_USERNAME_PART_MIN_LENGTH).toBe(4);
  });
});
