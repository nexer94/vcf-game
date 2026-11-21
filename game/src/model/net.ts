/**
 * Minimal, pure IPv4 / DNS helpers used by the model validations.
 * These are generic networking utilities (not VCF facts).
 */

export function parseIpv4(ip: string): number | undefined {
  const parts = ip.split('.');
  if (parts.length !== 4) return undefined;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return undefined;
    const v = Number(p);
    if (v > 255) return undefined;
    n = n * 256 + v;
  }
  return n;
}

export function formatIpv4(n: number): string {
  return [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join('.');
}

export interface Ipv4Cidr {
  readonly network: number;
  readonly prefix: number;
}

export function parseCidr(cidr: string): Ipv4Cidr | undefined {
  const [ip, pfx] = cidr.split('/');
  if (ip === undefined || pfx === undefined || !/^\d{1,2}$/.test(pfx)) return undefined;
  const addr = parseIpv4(ip);
  const prefix = Number(pfx);
  if (addr === undefined || prefix > 32) return undefined;
  const size = 2 ** (32 - prefix);
  return { network: addr - (addr % size), prefix };
}

export function cidrSize(c: Ipv4Cidr): number {
  return 2 ** (32 - c.prefix);
}

export function cidrContains(c: Ipv4Cidr, ip: number): boolean {
  return ip >= c.network && ip < c.network + cidrSize(c);
}

export function isNetworkOrBroadcast(c: Ipv4Cidr, ip: number): boolean {
  if (c.prefix >= 31) return false;
  return ip === c.network || ip === c.network + cidrSize(c) - 1;
}

/** An IP pool as entered in the wizard / JSON: contiguous range or explicit address list. */
export type IpPool =
  | { readonly kind: 'range'; readonly start: string; readonly end: string }
  | { readonly kind: 'addresses'; readonly addresses: readonly string[] };

/**
 * Closed numeric IPv4 interval [start, end] (both inclusive, uint32 values).
 * Pools are always handled as intervals – never materialised into address arrays, so even a
 * 0.0.0.0–255.255.255.255 range costs O(1).
 */
export interface Ipv4Interval {
  readonly start: number;
  readonly end: number;
}

/**
 * Converts a pool into an ordered list of intervals (entry order is preserved: a range yields one
 * interval, an address list yields one single-address interval per entry, duplicates included).
 * Returns undefined if any address is malformed or the range is reversed.
 */
export function poolToIntervals(pool: IpPool): Ipv4Interval[] | undefined {
  if (pool.kind === 'addresses') {
    const out: Ipv4Interval[] = [];
    for (const a of pool.addresses) {
      const n = parseIpv4(a);
      if (n === undefined) return undefined;
      out.push({ start: n, end: n });
    }
    return out;
  }
  const s = parseIpv4(pool.start);
  const e = parseIpv4(pool.end);
  if (s === undefined || e === undefined || e < s) return undefined;
  return [{ start: s, end: e }];
}

/** Number of address entries (end − start + 1 summed; duplicate list entries count separately). */
export function intervalsSize(intervals: readonly Ipv4Interval[]): number {
  let n = 0;
  for (const i of intervals) n += i.end - i.start + 1;
  return n;
}

/** True if `ip` lies in any of the intervals. */
export function intervalsContain(intervals: readonly Ipv4Interval[], ip: number): boolean {
  return intervals.some((i) => ip >= i.start && ip <= i.end);
}

/** Lowest address shared by two intervals, or undefined if they do not overlap. */
export function intervalOverlapStart(a: Ipv4Interval, b: Ipv4Interval): number | undefined {
  const s = Math.max(a.start, b.start);
  return s <= Math.min(a.end, b.end) ? s : undefined;
}

/** Range of the CIDR as an interval (network .. broadcast). */
export function cidrInterval(c: Ipv4Cidr): Ipv4Interval {
  return { start: c.network, end: c.network + cidrSize(c) - 1 };
}

/**
 * First address of `iv` (ascending) that is outside `c` or is its network/broadcast address.
 * Equivalent to scanning the interval address by address, but O(1).
 */
export function firstBadAddressInCidr(
  c: Ipv4Cidr,
  iv: Ipv4Interval,
): { readonly ip: number; readonly reason: 'outside' | 'network-or-broadcast' } | undefined {
  const { start: cs, end: ce } = cidrInterval(c);
  const s = iv.start;
  if (s < cs || s > ce) return { ip: s, reason: 'outside' };
  if (isNetworkOrBroadcast(c, s)) return { ip: s, reason: 'network-or-broadcast' };
  // s is a usable address inside the subnet; the next bad candidate is the broadcast (prefix < 31)
  // or the first address after the subnet.
  if (iv.end < ce) return undefined;
  if (c.prefix < 31) return { ip: ce, reason: 'network-or-broadcast' };
  if (iv.end > ce) return { ip: ce + 1, reason: 'outside' };
  return undefined;
}

/** Simulated DNS: forward (A) and reverse (PTR) records. */
export interface DnsRecords {
  /** FQDN (lowercase) -> IPv4 address. */
  readonly forward: Readonly<Record<string, string>>;
  /** IPv4 address -> FQDN. */
  readonly reverse: Readonly<Record<string, string>>;
}

export type DnsCheck =
  | { readonly ok: true; readonly ip: string }
  | { readonly ok: false; readonly reason: 'no-forward' | 'no-reverse' | 'reverse-mismatch'; readonly ip?: string };

/** Checks that an FQDN has both a forward A record and a matching reverse PTR record. */
export function checkForwardReverse(dns: DnsRecords, fqdn: string): DnsCheck {
  const ip = dns.forward[fqdn.toLowerCase()];
  if (ip === undefined) return { ok: false, reason: 'no-forward' };
  const back = dns.reverse[ip];
  if (back === undefined) return { ok: false, reason: 'no-reverse', ip };
  if (back.toLowerCase() !== fqdn.toLowerCase()) return { ok: false, reason: 'reverse-mismatch', ip };
  return { ok: true, ip };
}
