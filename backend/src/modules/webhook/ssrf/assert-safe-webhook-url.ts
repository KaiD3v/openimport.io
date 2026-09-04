import { lookup as dnsLookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { WEBHOOK_URL_MAX_LENGTH } from '../webhook.constants.js';

export class UnsafeWebhookUrlError extends Error {
  readonly code = 'WEBHOOK.URL_UNSAFE';

  constructor(message = 'Webhook URL is not allowed.') {
    super(message);
    this.name = 'UnsafeWebhookUrlError';
  }
}

export type SafeWebhookUrlOptions = {
  allowPrivateTargets: boolean;
};

export type DnsLookup = (
  hostname: string,
  options: { all: true },
) => Promise<Array<{ address: string; family: number }>>;

export type PinnedWebhookAddress = {
  address: string;
  family: 4 | 6;
};

export type ResolvedWebhookTarget = {
  url: URL;
  addresses: PinnedWebhookAddress[];
  pinned: PinnedWebhookAddress;
};

const blocked = new BlockList();
blocked.addSubnet('0.0.0.0', 8, 'ipv4');
blocked.addSubnet('10.0.0.0', 8, 'ipv4');
blocked.addSubnet('100.64.0.0', 10, 'ipv4');
blocked.addSubnet('127.0.0.0', 8, 'ipv4');
blocked.addSubnet('169.254.0.0', 16, 'ipv4');
blocked.addSubnet('172.16.0.0', 12, 'ipv4');
blocked.addSubnet('192.0.0.0', 24, 'ipv4');
blocked.addSubnet('192.0.2.0', 24, 'ipv4');
blocked.addSubnet('192.168.0.0', 16, 'ipv4');
blocked.addSubnet('198.18.0.0', 15, 'ipv4');
blocked.addSubnet('198.51.100.0', 24, 'ipv4');
blocked.addSubnet('203.0.113.0', 24, 'ipv4');
blocked.addSubnet('224.0.0.0', 4, 'ipv4');
blocked.addSubnet('240.0.0.0', 4, 'ipv4');
blocked.addAddress('255.255.255.255', 'ipv4');
blocked.addAddress('::', 'ipv6');
blocked.addAddress('::1', 'ipv6');
blocked.addSubnet('fc00::', 7, 'ipv6');
blocked.addSubnet('fe80::', 10, 'ipv6');
blocked.addSubnet('ff00::', 8, 'ipv6');
blocked.addSubnet('2001:db8::', 32, 'ipv6');

const BLOCKED_HOST_EXACT = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.internal',
]);

function fail(): never {
  throw new UnsafeWebhookUrlError();
}

function hostnameIsBlocked(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (BLOCKED_HOST_EXACT.has(host)) {
    return true;
  }
  return (
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.arpa')
  );
}

function unwrapMappedIPv4(address: string): string | null {
  const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
  if (dotted) {
    return dotted[1] ?? null;
  }
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(address);
  if (hex) {
    const hi = Number.parseInt(hex[1]!, 16);
    const lo = Number.parseInt(hex[2]!, 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return null;
}

function asPinnedFamily(family: number): family is 4 | 6 {
  return family === 4 || family === 6;
}

export function isBlockedIpAddress(address: string): boolean {
  const mapped = unwrapMappedIPv4(address);
  if (mapped) {
    return isBlockedIpAddress(mapped);
  }

  const family = isIP(address);
  if (family === 4) {
    return blocked.check(address, 'ipv4');
  }
  if (family === 6) {
    return blocked.check(address, 'ipv6');
  }
  return true;
}

/**
 * Resolve and validate the webhook URL once. The returned `pinned` address is
 * the only IP the HTTP transport may use for this attempt. Callers must not
 * perform a second DNS lookup.
 */
export async function resolveSafeWebhookTarget(
  raw: string,
  options: SafeWebhookUrlOptions,
  lookup: DnsLookup = dnsLookup,
): Promise<ResolvedWebhookTarget> {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > WEBHOOK_URL_MAX_LENGTH) {
    fail();
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail();
  }

  const allowHttp = options.allowPrivateTargets;
  if (url.protocol === 'http:') {
    if (!allowHttp) {
      fail();
    }
  } else if (url.protocol !== 'https:') {
    fail();
  }

  if (url.username !== '' || url.password !== '') {
    fail();
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (hostname.length === 0) {
    fail();
  }

  if (!options.allowPrivateTargets && hostnameIsBlocked(hostname)) {
    fail();
  }

  const ipVersion = isIP(hostname);
  if (ipVersion !== 0) {
    if (!asPinnedFamily(ipVersion)) {
      fail();
    }
    if (!options.allowPrivateTargets && isBlockedIpAddress(hostname)) {
      fail();
    }
    const pinned: PinnedWebhookAddress = {
      address: hostname,
      family: ipVersion,
    };
    return { url, addresses: [pinned], pinned };
  }

  let records: Array<{ address: string; family: number }>;
  try {
    records = await lookup(hostname, { all: true });
  } catch {
    fail();
  }

  if (records.length === 0) {
    fail();
  }

  const addresses: PinnedWebhookAddress[] = [];
  for (const record of records) {
    if (!asPinnedFamily(record.family)) {
      fail();
    }
    if (!options.allowPrivateTargets && isBlockedIpAddress(record.address)) {
      fail();
    }
    addresses.push({ address: record.address, family: record.family });
  }

  const pinned = addresses[0];
  if (!pinned) {
    fail();
  }

  return { url, addresses, pinned };
}

export async function assertSafeWebhookUrl(
  raw: string,
  options: SafeWebhookUrlOptions,
  lookup: DnsLookup = dnsLookup,
): Promise<URL> {
  const target = await resolveSafeWebhookTarget(raw, options, lookup);
  return target.url;
}
