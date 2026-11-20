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

/** Expand a pool to numeric addresses; returns undefined if any address is malformed. */
export function expandPool(pool: IpPool): number[] | undefined {
  if (pool.kind === 'addresses') {
    const out: number[] = [];
    for (const a of pool.addresses) {
      const n = parseIpv4(a);
      if (n === undefined) return undefined;
      out.push(n);
    }
    return out;
  }
  const s = parseIpv4(pool.start);
  const e = parseIpv4(pool.end);
  if (s === undefined || e === undefined || e < s) return undefined;
  const out: number[] = [];
  for (let i = s; i <= e; i++) out.push(i);
  return out;
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
