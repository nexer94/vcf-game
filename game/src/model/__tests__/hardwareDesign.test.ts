import { describe, expect, it } from 'vitest';
import { validateEsxHostsForBringup } from '../bringup';
import { buildHardwareCatalog } from '../hardwareCatalog';
import { hardwareContext, optionAvailabilityWithHardware, toBringupHosts, validateManagementClusterHardware } from '../hardwareDesign';
import { type PhysicalState, addServer, emptyPhysicalState, installEsxOnServer } from '../physical';
import type { TransitionResult } from '../validation';

const catalog = buildHardwareCatalog();
const u = <S>(r: TransitionResult<S>): S => {
  if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`);
  return r.state;
};
const cfg = (id: string) => {
  const s = catalog.starterServers.find((x) => x.id === id);
  if (!s) throw new Error(id);
  return s.config;
};
function servers(...starters: string[]): PhysicalState {
  let s = emptyPhysicalState();
  starters.forEach((st, i) => (s = u(addServer(s, catalog, `esx-0${i + 1}`, cfg(st), st))));
  return s;
}
const n = (k: number, st: string) => Array.from({ length: k }, () => st);
const hw = (s: PhysicalState) => hardwareContext(s, catalog);

describe('bring-up adapter', () => {
  it('maps vendor, HW fingerprint and pNIC count; vmk0 on VSS after ESX install', () => {
    let s = servers('hpe-dl380g12-med', 'hpe-dl380g12-lrg');
    s = u(installEsxOnServer(s, 'esx-01', '9.1.1'));
    const [a, b] = toBringupHosts(s);
    expect(a).toMatchObject({ id: 'esx-01', hwVendor: 'HPE', pnicCount: 2, esxVersion: '9.1.1', vmk0OnStandardSwitch: true });
    expect(b).toMatchObject({ pnicCount: 4, vmk0OnStandardSwitch: false });
    expect(a?.hwProfileId).not.toBe(b?.hwProfileId);
  });

  it('bringup homogeneity / single-vendor validation sees the physical hosts', () => {
    const s = servers('hpe-dl380g12-med', 'dell-r670-med', 'hpe-dl380g12-med');
    const codes = validateEsxHostsForBringup(toBringupHosts(s), { dns: { forward: {}, reverse: {} }, model: 'simple', storage: 'vsan-esa' }).map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['ESX_HETEROGENEOUS_CLUSTER', 'ESX_MULTIPLE_VENDORS']));
  });

  it('management cluster HW findings combine per-host and cluster checks', () => {
    const f = validateManagementClusterHardware(servers('hpe-dl380g12-med', 'hpe-dl380g12-crdrive'), catalog, ['esx-01', 'esx-02'], 'vsan-esa');
    expect(f.map((x) => x.code)).toEqual(expect.arrayContaining(['HW_ESA_DRIVE_CYBER_RECOVERY_ONLY', 'HW_CLUSTER_HETEROGENEOUS']));
  });
});

describe('design options limited by hardware', () => {
  it('no hardware yet: requirement shown neutrally, option stays available (UX §3.1)', () => {
    const r = optionAvailabilityWithHardware('deployment-model', 'high-availability', {}, hw(emptyPhysicalState()));
    expect(r.available).toBe(true);
    expect(r.hardware.status).toBe('no-hardware-yet');
    expect(r.hardware.requirements[0]?.message).toContain('at least 4 ESX hosts');
  });

  it('High Availability needs 4 hosts -> "buy 1 more host"', () => {
    const r = optionAvailabilityWithHardware('deployment-model', 'high-availability', { 'principal-storage': 'vsan-esa' }, hw(servers(...n(3, 'hpe-dl380g12-med'))));
    expect(r.available).toBe(false);
    expect(r.hardware.status).toBe('insufficient');
    expect(r.hardware.errors[0]).toMatchObject({ issue: { code: 'MGMT_DOMAIN_TOO_FEW_HOSTS' }, unlock: { kind: 'buy-hosts', count: 1 } });
    expect(optionAvailabilityWithHardware('deployment-model', 'simple', { 'principal-storage': 'vsan-esa' }, hw(servers(...n(3, 'hpe-dl380g12-med')))).available).toBe(true);
  });

  it('Simple with NFS needs 2 hosts, with vSAN 3 (10 §6.1)', () => {
    const two = hw(servers(...n(2, 'hpe-dl380g12-med')));
    expect(optionAvailabilityWithHardware('principal-storage', 'nfs-v3', { 'deployment-model': 'simple' }, two).available).toBe(true);
    const v = optionAvailabilityWithHardware('principal-storage', 'vsan-esa', { 'deployment-model': 'simple' }, two);
    expect(v.hardware.errors.map((e) => e.unlock)).toContainEqual({ kind: 'buy-hosts', count: 1 });
  });

  it('vSAN ESA requires ESA-eligible hosts; DEV findings become warnings', () => {
    const bad = optionAvailabilityWithHardware('principal-storage', 'vsan-esa', {}, hw(servers('hpe-dl380g12-med', 'hpe-dl380g12-med', 'hpe-dl380g12-dell-drive')));
    expect(bad.available).toBe(false);
    expect(bad.hardware.errors[0]?.unlock).toEqual({ kind: 'fix-host-config', hostIds: ['esx-03'], codes: ['HW_ESA_DRIVE_OTHER_OEM'] });
    const dev = optionAvailabilityWithHardware('principal-storage', 'vsan-esa', {}, hw(servers(...n(3, 'dell-r670-med-10g'))));
    expect(dev.available).toBe(true);
    expect(dev.hardware.warnings.map((w) => w.issue.code)).toEqual(expect.arrayContaining(['HW_ESA_10GBE_COMPLIANCE', 'HW_ESA_LARGER_NODE_10GBE']));
  });

  it('VMFS on FC needs FC HBAs', () => {
    const r = optionAvailabilityWithHardware('principal-storage', 'vmfs-fc', {}, hw(servers('len-sr630v4-compute', 'len-sr630v4-sm')));
    expect(r.hardware.errors[0]?.unlock).toEqual({ kind: 'add-fc-hba', hostIds: ['esx-02'] });
  });

  it('NFS v3 with a single pNIC host (20 §5.3 #3)', () => {
    let s = servers('hpe-dl380g12-med');
    s = u(addServer(s, catalog, 'esx-02', { ...cfg('hpe-dl380g12-med'), nics: [] }));
    const r = optionAvailabilityWithHardware('principal-storage', 'nfs-v3', { 'deployment-model': 'simple' }, hw(s));
    expect(r.hardware.errors.find((e) => e.issue.code === 'NFS_SINGLE_PNIC_UNSUPPORTED')?.unlock).toEqual({ kind: 'add-nic-ports', hostIds: ['esx-02'], minPortsPerHost: 2 });
  });

  it('Storage and Workload Separation needs 6 pNICs; Single VDS fine with 2', () => {
    const h = hw(servers(...n(4, 'hpe-dl380g12-lrg')));
    const r = optionAvailabilityWithHardware('distributed-switch-model', 'storage-and-workload-separation', {}, h);
    expect(r.available).toBe(false);
    expect(r.hardware.errors[0]?.unlock).toMatchObject({ kind: 'add-nic-ports', minPortsPerHost: 6 });
    expect(optionAvailabilityWithHardware('distributed-switch-model', 'single', {}, h).hardware.status).toBe('ok');
    expect(optionAvailabilityWithHardware('distributed-switch-model', 'workload-separation', {}, h).hardware.status).toBe('not-hw-dependent');
  });

  it('vSAN pNIC recommendation for large nodes with 2 pNIC', () => {
    const r = optionAvailabilityWithHardware('distributed-switch-model', 'single', { 'principal-storage': 'vsan-esa' }, hw(servers(...n(3, 'dell-r670-med'))));
    expect(r.hardware.warnings[0]?.issue).toMatchObject({ code: 'HW_VSAN_NIC_COUNT_RCMD', severity: 'recommendation' });
  });

  it('several vendors block HW-dependent options with a single-vendor unlock', () => {
    const r = optionAvailabilityWithHardware('deployment-model', 'simple', {}, hw(servers('hpe-dl380g12-med', 'dell-r670-med', 'hpe-dl380g12-med')));
    expect(r.hardware.errors.find((e) => e.issue.code === 'ESX_MULTIPLE_VENDORS')?.unlock).toEqual({ kind: 'use-single-vendor', vendors: ['HPE', 'Dell'] });
  });

  it('design constraint errors are kept (multi-rack L3 for the mgmt cluster)', () => {
    const r = optionAvailabilityWithHardware('mgmt-cluster-model', 'multi-rack-l3', { 'deployment-model': 'simple' }, hw(servers(...n(3, 'hpe-dl380g12-med'))));
    expect(r.available).toBe(false);
    expect(r.errors[0]?.code).toBe('MGMT_DEFAULT_CLUSTER_L3_UNSUPPORTED');
  });
});
