import dns from "node:dns";

// Pure IP classifier for the import-download SSRF guard (M12A T3 review fix). Hostname-syntax
// checks alone (isAllowedImportHost in server.ts) don't stop DNS-rebinding: an attacker-controlled
// hostname can resolve to a private/metadata address at connect time even though the hostname
// itself looks like an ordinary public domain. This module resolves the hostname and rejects it if
// ANY returned address (not just the first) lands in a private/loopback/link-local/CGNAT range —
// including addresses that only *look* public because they're IPv4-mapped into IPv6
// (`::ffff:10.0.0.1`), which is why address classification is done on parsed octets/groups rather
// than string prefixes.

export interface ResolvedAddress {
  address: string;
  family: number;
}

function parseIPv4(ip: string): [number, number, number, number] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const parts = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
  if (parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return parts as [number, number, number, number];
}

function isPrivateIPv4(a: number, b: number, c: number, d: number): boolean {
  void c;
  void d;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 (loopback)
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local, incl. cloud metadata)
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT)
  return false;
}

type IPv6Groups = readonly [number, number, number, number, number, number, number, number];

// Expands any legal IPv6 textual form (incl. "::" compression, zone IDs, and a trailing
// dotted-quad tail like "::ffff:1.2.3.4") into 8 16-bit groups, or null if unparseable.
function expandIPv6Groups(input: string): IPv6Groups | null {
  let addr = input;
  const pct = addr.indexOf("%");
  if (pct !== -1) addr = addr.slice(0, pct); // strip zone id, e.g. fe80::1%eth0

  const v4Tail = /^(.*:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(addr);
  if (v4Tail) {
    const prefix = v4Tail[1] ?? "";
    const v4 = parseIPv4(v4Tail[2] ?? "");
    if (!v4) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    addr = prefix + hi + ":" + lo;
  }

  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];

  let groups: string[];
  if (halves.length === 1) {
    groups = head;
    if (groups.length !== 8) return null;
  } else {
    const missing = 8 - head.length - tail.length;
    if (missing < 0) return null;
    groups = [...head, ...Array<string>(missing).fill("0"), ...tail];
  }
  if (groups.length !== 8) return null;

  const nums = groups.map((g) => (g === "" ? 0 : parseInt(g, 16)));
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 0xffff)) return null;
  return nums as unknown as IPv6Groups;
}

function isPrivateIPv6(groups: IPv6Groups): boolean {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  // IPv4-mapped: ::ffff:a.b.c.d — unmap and re-check the v4 rules.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    const a = (g6 >> 8) & 0xff;
    const b = g6 & 0xff;
    const c = (g7 >> 8) & 0xff;
    const d = g7 & 0xff;
    return isPrivateIPv4(a, b, c, d);
  }
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 0) return true; // ::
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 1) return true; // ::1
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 (unique local)
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 (link-local)
  return false;
}

export function isPrivateAddress(ip: string): boolean {
  if (ip.includes(":")) {
    const groups = expandIPv6Groups(ip);
    if (!groups) return true; // unparseable → fail closed
    return isPrivateIPv6(groups);
  }
  const v4 = parseIPv4(ip);
  if (!v4) return true; // unparseable → fail closed
  return isPrivateIPv4(...v4);
}

export async function resolveHostAddresses(hostname: string): Promise<ResolvedAddress[]> {
  const result = await dns.promises.lookup(hostname, { all: true });
  return result.map((r) => ({ address: r.address, family: r.family }));
}

export type HostResolution =
  | { ok: true; addresses: ResolvedAddress[] }
  | { ok: false; reason: string };

// Resolves the hostname and rejects if ANY returned address is private (multi-A-record rebinding
// defense — an attacker can return one public and one private address to slip past a naive "some
// address is public" check). DNS failures fail closed (denied), same posture as a private address.
export async function checkHostResolution(hostname: string): Promise<HostResolution> {
  let addresses: ResolvedAddress[];
  try {
    addresses = await resolveHostAddresses(hostname);
  } catch {
    return { ok: false, reason: "DNS resolution failed" };
  }
  if (addresses.length === 0) return { ok: false, reason: "DNS resolution returned no addresses" };
  if (addresses.some((a) => isPrivateAddress(a.address))) {
    return { ok: false, reason: "host resolves to a private/internal address" };
  }
  return { ok: true, addresses };
}
