/**
 * DNSSEC material fetching via DNS-over-HTTPS (DoH).
 *
 * Uses Cloudflare's DoH API with the `do=1` flag to request DNSSEC data.
 * All fetched material stays in browser memory — never sent to any contract.
 */

const DOH_URL = 'https://cloudflare-dns.com/dns-query';

export class TXTNotFoundError extends Error {
  constructor(domain: string) {
    super(`TXT record not found at _stellar-cloakwork.${domain}`);
    this.name = 'TXTNotFoundError';
  }
}

export class DNSSECMissingError extends Error {
  constructor(domain: string) {
    super(`DNSSEC signature missing or invalid for _stellar-cloakwork.${domain}`);
    this.name = 'DNSSECMissingError';
  }
}

export class RRSIGExpiredError extends Error {
  constructor() {
    super('RRSIG validity window has expired — wait for DNS TTL and republish');
    this.name = 'RRSIGExpiredError';
  }
}

export class DNSFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DNSFetchError';
  }
}

export interface DNSSECMaterial {
  rrset: Uint8Array;
  rrsig: Uint8Array;
  dnskey: Uint8Array;
  notBefore: number;
  notAfter: number;
}

/**
 * Fetch and validate DNSSEC material for a Cloakwork domain challenge.
 *
 * Queries `_stellar-cloakwork.<domain>` TXT record with DNSSEC requested.
 *
 * @param domain - The base domain name (without the `_stellar-cloakwork.` prefix)
 * @returns DNSSECMaterial with rrset, rrsig, dnskey bytes and validity window
 * @throws TXTNotFoundError if the TXT record doesn't exist
 * @throws DNSSECMissingError if the zone isn't DNSSEC-signed
 * @throws RRSIGExpiredError if the RRSIG validity window has passed
 * @throws DNSFetchError for network-level failures
 */
export async function fetchDNSSECMaterial(domain: string): Promise<DNSSECMaterial> {
  const name = `_stellar-cloakwork.${domain}`;
  const url = `${DOH_URL}?name=${encodeURIComponent(name)}&type=TXT&do=1`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: 'application/dns-json' },
    });
  } catch (err: unknown) {
    throw new DNSFetchError(
      `DoH API unreachable: ${err instanceof Error ? err.message : 'network error'}`
    );
  }

  if (!res.ok) {
    throw new DNSFetchError(`DoH API returned HTTP ${res.status}`);
  }

  const data: DoHResponse = await res.json();

  // SERVFAIL or NXDOMAIN
  if (data.Status !== 0) {
    throw new TXTNotFoundError(domain);
  }

  // Check for authenticated DNSSEC answer
  if (!data.AD) {
    throw new DNSSECMissingError(domain);
  }

  // Find TXT answer
  const txtAnswer = data.Answer?.find(
    (r) => r.type === 16 && r.name.toLowerCase().includes('_stellar-cloakwork')
  );
  if (!txtAnswer) {
    throw new TXTNotFoundError(domain);
  }

  // Find RRSIG in Answer section (type 46)
  const rrsigRecord =
    data.Answer?.find((r) => r.type === 46) ??
    data.Authority?.find((r) => r.type === 46);
  if (!rrsigRecord) {
    throw new DNSSECMissingError(domain);
  }

  // Parse RRSIG validity window from rdata string
  const { notBefore, notAfter } = parseRRSIGWindow(rrsigRecord.data);
  const now = Math.floor(Date.now() / 1000);
  if (notAfter < now) {
    throw new RRSIGExpiredError();
  }

  // Find DNSKEY in Authority section (type 48)
  const dnskeyRecord = data.Authority?.find((r) => r.type === 48) ?? null;
  if (!dnskeyRecord) {
    // DNSKEY not present in the DoH response — zone may not be fully DNSSEC-signed
    throw new DNSSECMissingError(domain);
  }

  // Encode to Uint8Array for circuit consumption
  const encoder = new TextEncoder();
  return {
    rrset: encoder.encode(JSON.stringify(data.Answer ?? [])),
    rrsig: encoder.encode(rrsigRecord.data),
    dnskey: encoder.encode(dnskeyRecord.data),
    notBefore,
    notAfter,
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

interface DoHRecord {
  name: string;
  type: number;
  TTL: number;
  data: string;
}

interface DoHResponse {
  Status: number;
  AD: boolean;
  Answer?: DoHRecord[];
  Authority?: DoHRecord[];
}

/**
 * Parse RRSIG inception and expiration from its rdata string.
 * RRSIG rdata format: "<type> <algo> <labels> <ttl> <expiration> <inception> <tag> <signer> <sig>"
 */
function parseRRSIGWindow(rdata: string): { notBefore: number; notAfter: number } {
  const parts = rdata.trim().split(/\s+/);
  // Expiration is at index 4, inception at index 5 in standard RRSIG rdata
  if (parts.length >= 6) {
    const expiration = parseRRSIGTimestamp(parts[4]);
    const inception  = parseRRSIGTimestamp(parts[5]);
    if (expiration > 0 && inception > 0) {
      if (expiration <= inception) {
        throw new Error(
          'RRSIG validity window is invalid: expiration is not after inception. ' +
          'The DNSSEC record may be malformed.'
        );
      }
      return { notBefore: inception, notAfter: expiration };
    }
  }
  // If we can't parse a valid window, throw — don't silently use a fake window.
  // A missing RRSIG timestamp means the DNSSEC data is malformed.
  throw new Error('Could not parse RRSIG validity window from DNS response. The DNSSEC record may be malformed.');
}

/**
 * Parse RRSIG timestamp — either YYYYMMDDHHmmSS format or Unix epoch.
 */
function parseRRSIGTimestamp(s: string): number {
  if (s.length === 14 && /^\d+$/.test(s)) {
    // YYYYMMDDHHmmSS format — RRSIG timestamps are always UTC
    const year  = parseInt(s.slice(0, 4));
    const month = parseInt(s.slice(4, 6)) - 1; // Date.UTC month is 0-indexed
    const day   = parseInt(s.slice(6, 8));
    const hour  = parseInt(s.slice(8, 10));
    const min   = parseInt(s.slice(10, 12));
    const sec   = parseInt(s.slice(12, 14));
    // Use Date.UTC — NOT new Date(...) which interprets args as local time
    return Math.floor(Date.UTC(year, month, day, hour, min, sec) / 1000);
  }
  const n = parseInt(s);
  return isNaN(n) ? 0 : n;
}
