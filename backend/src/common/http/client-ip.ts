import type { Request } from 'express';
import type { Env } from '../../core/config/env.js';

/**
 * Resolves the client IP for rate limiting.
 * When RATE_LIMIT_TRUSTED_PROXY is false, ignores X-Forwarded-For entirely.
 * When true, uses Express request.ip (requires TRUST_PROXY hops/CIDRs).
 */
export function resolveClientIp(request: Request, env: Env): string {
  if (env.RATE_LIMIT_TRUSTED_PROXY) {
    const forwarded = request.ip;
    if (typeof forwarded === 'string' && forwarded.length > 0) {
      return stripIpv6Mapped(forwarded);
    }
  }

  const socketAddress = request.socket?.remoteAddress;
  if (typeof socketAddress === 'string' && socketAddress.length > 0) {
    return stripIpv6Mapped(socketAddress);
  }
  return 'unknown';
}

function stripIpv6Mapped(ip: string): string {
  if (ip.startsWith('::ffff:')) {
    return ip.slice('::ffff:'.length);
  }
  return ip;
}
