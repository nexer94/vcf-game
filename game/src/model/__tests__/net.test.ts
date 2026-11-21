import { describe, expect, it } from 'vitest';
import {
  type IpPool,
  type Ipv4Interval,
  cidrContains,
  firstBadAddressInCidr,
  formatIpv4,
  intervalOverlapStart,
  intervalsContain,
  intervalsSize,
  isNetworkOrBroadcast,
  parseCidr,
  parseIpv4,
  poolToIntervals,
} from '../net';
import {
  type BringupEnvironment,
  type BringupSpec,
  type HostNetworkSpec,
  isVcfAutomationDeployedNow,
  validateComponentFqdns,
  validateIpPools,
} from '../bringup';
import { FQDNS, makeDns, validEnv, validSpec } from './fixtures';

const ip = (s: string): number => parseIpv4(s)!;
const range = (start: string, end: string): IpPool => ({ kind: 'range', start, end });

describe('net: pools as numeric intervals', () => {
  it('converts range and address-list pools, preserving entry order and duplicates', () => {
    expect(poolToIntervals(range('10.0.0.1', '10.0.0.5'))).toEqual([{ start: ip('10.0.0.1'), end: ip('10.0.0.5') }]);
    const list = poolToIntervals({ kind: 'addresses', addresses: ['10.0.0.9', '10.0.0.3', '10.0.0.9'] })!;
    expect(list.map((i) => i.start)).toEqual([ip('10.0.0.9'), ip('10.0.0.3'), ip('10.0.0.9')]);
    expect(intervalsSize(list)).toBe(3);
  });

  it('rejects malformed and reversed pools', () => {
    expect(poolToIntervals(range('10.0.0.5', '10.0.0.1'))).toBeUndefined();
    expect(poolToIntervals(range('10.0.0.256', '10.0.0.1'))).toBeUndefined();
    expect(poolToIntervals({ kind: 'addresses', addresses: ['10.0.0.1', 'x'] })).toBeUndefined();
  });

  it('computes sizes arithmetically, including the full IPv4 space', () => {
    expect(intervalsSize(poolToIntervals(range('10.0.0.7', '10.0.0.7'))!)).toBe(1);
    expect(intervalsSize(poolToIntervals(range('10.0.0.0', '10.255.255.255'))!)).toBe(2 ** 24);
    expect(intervalsSize(poolToIntervals(range('0.0.0.0', '255.255.255.255'))!)).toBe(2 ** 32);
  });

  it('membership is inclusive at both interval ends', () => {
    const iv = poolToIntervals(range('10.0.0.10', '10.0.0.20'))!;
    expect(intervalsContain(iv, ip('10.0.0.9'))).toBe(false);
    expect(intervalsContain(iv, ip('10.0.0.10'))).toBe(true);
    expect(intervalsContain(iv, ip('10.0.0.20'))).toBe(true);
    expect(intervalsContain(iv, ip('10.0.0.21'))).toBe(false);
    const all = poolToIntervals(range('0.0.0.0', '255.255.255.255'))!;
    expect(intervalsContain(all, 0)).toBe(true);
    expect(intervalsContain(all, 2 ** 32 - 1)).toBe(true);
  });

  it('overlap start: touching, disjoint, nested', () => {
    const a: Ipv4Interval = { start: 10, end: 20 };
    expect(intervalOverlapStart(a, { start: 20, end: 30 })).toBe(20);
    expect(intervalOverlapStart(a, { start: 21, end: 30 })).toBeUndefined();
    expect(intervalOverlapStart(a, { start: 0, end: 9 })).toBeUndefined();
    expect(intervalOverlapStart(a, { start: 0, end: 10 })).toBe(10);
    expect(intervalOverlapStart(a, { start: 12, end: 14 })).toBe(12);
    expect(intervalOverlapStart({ start: 12, end: 14 }, a)).toBe(12);
  });

  it('firstBadAddressInCidr matches an address-by-address scan (all prefixes /24../32)', () => {
    const scan = (cidr: string, s: number, e: number) => {
      const c = parseCidr(cidr)!;
      for (let a = s; a <= e; a++) {
        if (!cidrContains(c, a)) return { ip: a, reason: 'outside' };
        if (isNetworkOrBroadcast(c, a)) return { ip: a, reason: 'network-or-broadcast' };
      }
      return undefined;
    };
    for (let prefix = 24; prefix <= 32; prefix++) {
      const cidr = `10.0.2.64/${prefix}`;
      const c = parseCidr(cidr)!;
      const base = ip('10.0.2.0');
      for (let s = base + 40; s < base + 140; s += 3)
        for (let e = s; e < base + 160; e += 7) expect(firstBadAddressInCidr(c, { start: s, end: e }), `${cidr} ${s}-${e}`).toEqual(scan(cidr, s, e));
    }
  });

  it('firstBadAddressInCidr handles the IPv4 space edges', () => {
    expect(firstBadAddressInCidr(parseCidr('0.0.0.0/0')!, { start: 0, end: 2 ** 32 - 1 })).toEqual({ ip: 0, reason: 'network-or-broadcast' });
    expect(firstBadAddressInCidr(parseCidr('0.0.0.0/0')!, { start: 1, end: 2 ** 32 - 1 })).toEqual({ ip: 2 ** 32 - 1, reason: 'network-or-broadcast' });
    expect(firstBadAddressInCidr(parseCidr('255.255.255.254/31')!, { start: 2 ** 32 - 2, end: 2 ** 32 - 1 })).toBeUndefined();
    expect(firstBadAddressInCidr(parseCidr('10.0.0.5/32')!, { start: ip('10.0.0.5'), end: ip('10.0.0.6') })).toEqual({ ip: ip('10.0.0.6'), reason: 'outside' });
  });
});

// ---------------------------------------------------------------------------------------------
// Huge ranges must validate fast and correctly (code-review finding: expandPool materialised them).
// ---------------------------------------------------------------------------------------------

function withNets(s: BringupSpec, patch: Partial<BringupSpec['networks']>): BringupSpec {
  return { ...s, networks: { ...s.networks, ...patch } };
}

function timed<T>(fn: () => T): { result: T; ms: number } {
  const t0 = performance.now();
  const result = fn();
  return { result, ms: performance.now() - t0 };
}

describe('validateIpPools / validateComponentFqdns with huge ranges', () => {
  it('full IPv4 services range: fast, no size error, conflicts with hosts and other pools reported', () => {
    const spec = withNets(validSpec(), { managementServicesIpPool: range('0.0.0.0', '255.255.255.255') });
    const { result, ms } = timed(() => validateIpPools(spec, validEnv()));
    expect(ms).toBeLessThan(50);
    const codes = result.map((i) => i.code);
    expect(codes).not.toContain('SERVICES_RUNTIME_IPS_TOO_FEW');
    expect(codes).not.toContain('SERVICES_RUNTIME_IPS_BELOW_RECOMMENDED');
    // Lowest host IP in validEnv is the first conflict of the services range.
    const conflicts = result.filter((i) => i.code === 'IP_CONFLICT');
    const svc = conflicts.find((i) => i.subject === 'VCF Management Services IP Range');
    expect(svc?.message).toBe('VCF Management Services IP Range: 10.0.0.101 conflicts with ESX host h1.');
    // The services range stops at the first conflict, so later pools are checked against the
    // part claimed before it (0.0.0.0 - 10.0.0.100) and the hosts.
    expect(conflicts.find((i) => i.subject === 'VCF Automation IP Range')).toBeUndefined();
  });

  it('/8 inclusion range: fast; reports network address of the subnet, enough addresses', () => {
    const s = validSpec();
    const vmotion: HostNetworkSpec = { ...s.networks.vmotion, cidr: '10.0.0.0/8', inclusionRanges: [range('10.0.0.0', '10.255.255.255')] };
    const spec = withNets(s, { vmotion, managementServicesIpPool: range('11.0.0.0', '11.255.255.255') });
    const { result, ms } = timed(() => validateIpPools(spec, validEnv()));
    expect(ms).toBeLessThan(50);
    const nb = result.find((i) => i.code === 'INCLUSION_RANGE_NETWORK_OR_BROADCAST');
    expect(nb?.message).toBe('vMotion: 10.0.0.0 is a network or broadcast address.');
    expect(result.map((i) => i.code)).not.toContain('INCLUSION_RANGE_TOO_SMALL');
  });

  it('/8 inclusion range without network address reports the broadcast address', () => {
    const s = validSpec();
    const vmotion: HostNetworkSpec = { ...s.networks.vmotion, cidr: '10.0.0.0/8', inclusionRanges: [range('10.0.0.1', '10.255.255.255')] };
    const res = validateIpPools(withNets(s, { vmotion }), validEnv());
    expect(res.find((i) => i.code === 'INCLUSION_RANGE_NETWORK_OR_BROADCAST')?.message).toBe('vMotion: 10.255.255.255 is a network or broadcast address.');
  });

  it('inclusion range leaving the subnet reports the first address after it', () => {
    const s = validSpec();
    const vmotion: HostNetworkSpec = { ...s.networks.vmotion, cidr: '10.0.2.10/32', inclusionRanges: [range('10.0.2.10', '200.0.0.0')] };
    const { result, ms } = timed(() => validateIpPools(withNets(s, { vmotion }), validEnv()));
    expect(ms).toBeLessThan(50);
    expect(result.find((i) => i.code === 'INCLUSION_RANGE_OUTSIDE_SUBNET')?.message).toBe('vMotion: 10.0.2.11 is outside 10.0.2.10/32 (VLAN 1612).');
  });

  it('component FQDN membership in a full-IPv4 reserved range is fast and correct', () => {
    const spec = withNets(validSpec(), { managementServicesIpPool: range('0.0.0.0', '255.255.255.255') });
    const { result, ms } = timed(() => validateComponentFqdns(spec, validEnv()));
    expect(ms).toBeLessThan(50);
    expect(result.some((i) => i.code === 'FQDN_IP_IN_RESERVED_RANGE')).toBe(true);
  });

  it('FQDN IP just outside a range is not reserved; at the range edge it is', () => {
    const base = validEnv();
    const spec = validSpec(); // services range 10.0.1.10 - 10.0.1.39
    const env = (addr: string): BringupEnvironment => ({
      ...base,
      dns: {
        forward: { ...base.dns.forward, [FQDNS.vcenter[0]]: addr },
        reverse: { ...makeDns([]).reverse, ...base.dns.reverse, [addr]: FQDNS.vcenter[0] },
      },
    });
    const reserved = (addr: string) => validateComponentFqdns(spec, env(addr)).some((i) => i.code === 'FQDN_IP_IN_RESERVED_RANGE');
    expect(reserved('10.0.1.9')).toBe(false);
    expect(reserved('10.0.1.10')).toBe(true);
    expect(reserved('10.0.1.39')).toBe(true);
    expect(reserved('10.0.1.40')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// Differential test: interval-wise validateIpPools == the previous address-by-address algorithm.
// ---------------------------------------------------------------------------------------------

function expand(p: IpPool): number[] | undefined {
  const iv = poolToIntervals(p);
  if (!iv) return undefined;
  const out: number[] = [];
  for (const i of iv) for (let a = i.start; a <= i.end; a++) out.push(a);
  return out;
}

/** Reference: the pre-fix (array based) checks for inclusion ranges and conflicts. */
function referenceIssues(spec: BringupSpec, env: BringupEnvironment): string[] {
  const out: string[] = [];
  const n = spec.networks;
  const pools: { name: string; addrs: number[] }[] = [];
  const add = (name: string, p: IpPool | undefined): void => {
    if (!p) return;
    const a = expand(p);
    if (a) pools.push({ name, addrs: a });
  };
  add('VCF Management Services IP Range', n.managementServicesIpPool);
  if (isVcfAutomationDeployedNow(spec)) add('VCF Automation IP Range', n.vcfAutomationIpPool);
  n.vmotion.inclusionRanges.forEach((r) => add('vMotion inclusion range', r));
  n.storage?.inclusionRanges.forEach((r) => add('Storage inclusion range', r));
  if (spec.networkConfig.vpcNetwork === 'full-stack') n.nsxHostOverlay?.inclusionRanges.forEach((r) => add('NSX Host Overlay inclusion range', r));

  const checkNet = (name: string, net: HostNetworkSpec | undefined): void => {
    if (!net) return;
    const cidr = parseCidr(net.cidr);
    if (!cidr) return;
    for (const a of net.inclusionRanges.flatMap((r) => expand(r) ?? [])) {
      if (!cidrContains(cidr, a)) {
        out.push(`OUTSIDE ${name}: ${formatIpv4(a)} is outside ${net.cidr} (VLAN ${net.vlanId}).`);
        break;
      }
      if (isNetworkOrBroadcast(cidr, a)) {
        out.push(`NB ${name}: ${formatIpv4(a)} is a network or broadcast address.`);
        break;
      }
    }
  };
  checkNet('vMotion', n.vmotion);
  if (spec.storage.type !== 'vmfs-fc') checkNet(spec.storage.type === 'nfs-v3' ? 'NFS' : 'vSAN', n.storage);
  if (spec.networkConfig.vpcNetwork === 'full-stack') checkNet('NSX Host Overlay', n.nsxHostOverlay);

  const owner = new Map<number, string>();
  for (const h of env.hosts) {
    const hip = h.network ? parseIpv4(h.network.ipv4Address) : undefined;
    if (hip !== undefined) owner.set(hip, `ESX host ${h.id}`);
  }
  for (const p of pools) {
    for (const a of p.addrs) {
      const prev = owner.get(a);
      if (prev !== undefined && prev !== p.name) {
        out.push(`CONFLICT ${p.name}: ${formatIpv4(a)} conflicts with ${prev}.`);
        break;
      }
      owner.set(a, p.name);
    }
  }
  return out;
}

function actualIssues(spec: BringupSpec, env: BringupEnvironment): string[] {
  const tag: Record<string, string> = { INCLUSION_RANGE_OUTSIDE_SUBNET: 'OUTSIDE', INCLUSION_RANGE_NETWORK_OR_BROADCAST: 'NB', IP_CONFLICT: 'CONFLICT' };
  return validateIpPools(spec, env)
    .filter((i) => tag[i.code] !== undefined)
    .map((i) => `${tag[i.code]} ${i.message}`);
}

/** Deterministic PRNG (mulberry32) so failures are reproducible. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('interval-wise IP pool validation matches the address-by-address algorithm', () => {
  it('random small pools (ranges, address lists with duplicates, overlaps, host IPs)', () => {
    const r = rng(42);
    const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
    const a = (x: number) => `10.0.0.${x}`;
    const randPool = (): IpPool => {
      if (r() < 0.6) {
        const s = int(0, 60);
        return range(a(s), a(Math.min(255, s + int(0, 25))));
      }
      return { kind: 'addresses', addresses: Array.from({ length: int(1, 5) }, () => a(int(0, 70))) };
    };
    const randNet = (base: HostNetworkSpec): HostNetworkSpec => ({
      ...base,
      cidr: `10.0.0.${int(0, 3) * 16}/${int(26, 32)}`,
      inclusionRanges: Array.from({ length: int(1, 3) }, randPool),
    });
    let compared = 0;
    for (let k = 0; k < 400; k++) {
      const s = validSpec();
      const spec = withNets(s, {
        managementServicesIpPool: randPool(),
        vcfAutomationIpPool: randPool(),
        vmotion: randNet(s.networks.vmotion),
        storage: randNet(s.networks.storage!),
        nsxHostOverlay: randNet(s.networks.nsxHostOverlay!),
      });
      const base = validEnv();
      const env: BringupEnvironment = {
        ...base,
        hosts: base.hosts.map((h) => (h.network ? { ...h, network: { ...h.network, ipv4Address: a(int(0, 70)) } } : h)),
      };
      const expected = referenceIssues(spec, env);
      expect(actualIssues(spec, env), `case ${k}`).toEqual(expected);
      compared += expected.length;
    }
    expect(compared).toBeGreaterThan(100); // the generator really exercises the error paths
  });
});
