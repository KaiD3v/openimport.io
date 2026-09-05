import type { Server } from 'node:http';
import type { Env } from '../../core/config/env.js';

type HttpServerWithCheckingInterval = Server & {
  connectionsCheckingInterval: number;
};

/**
 * Applies Node HTTP server limits before the server accepts traffic.
 *
 * Semantics (Node 18+/24):
 * - `headersTimeout` + `connectionsCheckingInterval`: incomplete headers → 408/close.
 *   Node only polls these timers on `connectionsCheckingInterval` (default 30s), so we
 *   set the interval low enough that short configured timeouts are observable.
 * - `requestTimeout`: bounds time to assemble a request before dispatch; it does **not**
 *   cancel controller work after a complete request is handed to Nest.
 * - `timeout` (socket inactivity): after headers are parsed, a stalled request body is
 *   closed by inactivity — Node does not treat post-dispatch body stalls as
 *   `requestTimeout`. We map `HTTP_REQUEST_TIMEOUT_MS` here for that case.
 * - `keepAliveTimeout` / `maxRequestsPerSocket`: idle keep-alive and reuse caps.
 */
export function applyHttpServerLimits(
  server: Server,
  env: Pick<
    Env,
    | 'HTTP_REQUEST_TIMEOUT_MS'
    | 'HTTP_HEADERS_TIMEOUT_MS'
    | 'HTTP_KEEP_ALIVE_TIMEOUT_MS'
    | 'HTTP_MAX_REQUESTS_PER_SOCKET'
  >,
): void {
  const httpServer = server as HttpServerWithCheckingInterval;
  httpServer.headersTimeout = env.HTTP_HEADERS_TIMEOUT_MS;
  httpServer.requestTimeout = env.HTTP_REQUEST_TIMEOUT_MS;
  httpServer.keepAliveTimeout = env.HTTP_KEEP_ALIVE_TIMEOUT_MS;
  httpServer.maxRequestsPerSocket = env.HTTP_MAX_REQUESTS_PER_SOCKET;
  // Socket inactivity: stalls incomplete bodies after the request is dispatched.
  httpServer.timeout = env.HTTP_REQUEST_TIMEOUT_MS;
  // Default Node interval is 30s; without this, short headersTimeout values never fire.
  httpServer.connectionsCheckingInterval = Math.min(
    1_000,
    Math.max(50, Math.floor(env.HTTP_HEADERS_TIMEOUT_MS / 2)),
  );
}

/**
 * Parses TRUST_PROXY for Express.
 * - false/0/unset → false
 * - true → 'loopback' (never unrestricted boolean true)
 * - positive integer string → hop count
 * - otherwise → subnet list / Express trust setting string
 */
export function parseTrustProxySetting(
  value: string | undefined,
): false | number | string {
  if (value === undefined || value === 'false' || value === '0') {
    return false;
  }
  if (value === 'true') {
    return 'loopback';
  }
  if (/^\d+$/.test(value)) {
    const hops = Number(value);
    if (hops >= 1) {
      return hops;
    }
    return false;
  }
  return value;
}
