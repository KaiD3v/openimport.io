import http from 'node:http';
import https from 'node:https';
import type { IncomingMessage } from 'node:http';
import type { LookupOptions } from 'node:dns';
import type { LookupFunction } from 'node:net';
import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../../../core/config/env.token.js';
import type { Env } from '../../../core/config/env.js';
import {
  resolveSafeWebhookTarget,
  type DnsLookup,
  type PinnedWebhookAddress,
} from '../ssrf/assert-safe-webhook-url.js';

export const WEBHOOK_HTTP_POSTER = Symbol('WEBHOOK_HTTP_POSTER');

export type WebhookHttpPostInput = {
  url: string;
  body: string;
  headers: Record<string, string>;
  timeoutMs: number;
};

export type WebhookHttpPostResult = {
  status: number;
};

export type WebhookHttpPoster = {
  post(input: WebhookHttpPostInput): Promise<WebhookHttpPostResult>;
};

export type PinnedWebhookRequestInput = {
  url: URL;
  pinned: PinnedWebhookAddress;
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
};

export type PinnedWebhookRequestFn = (
  input: PinnedWebhookRequestInput,
) => Promise<WebhookHttpPostResult>;

export type PostPinnedWebhookDeps = {
  allowPrivateTargets: boolean;
  lookup?: DnsLookup;
  request?: PinnedWebhookRequestFn;
};

export function createPinnedLookup(
  pinned: PinnedWebhookAddress,
): LookupFunction {
  return ((
    _hostname: string,
    options: unknown,
    callback?: (...args: unknown[]) => void,
  ) => {
    const cb =
      typeof options === 'function'
        ? (options as (...args: unknown[]) => void)
        : callback;
    const opts =
      typeof options === 'object' && options !== null
        ? (options as LookupOptions)
        : {};
    if (!cb) {
      return;
    }
    if (opts.all) {
      cb(null, [{ address: pinned.address, family: pinned.family }]);
      return;
    }
    cb(null, pinned.address, pinned.family);
  }) as LookupFunction;
}

export function discardWebhookResponseBody(res: IncomingMessage): void {
  res.resume();
  res.destroy();
}

export async function defaultPinnedWebhookRequest(
  input: PinnedWebhookRequestInput,
): Promise<WebhookHttpPostResult> {
  const isHttps = input.url.protocol === 'https:';
  const lib = isHttps ? https : http;
  const hostname = input.url.hostname;
  const port =
    input.url.port !== ''
      ? Number.parseInt(input.url.port, 10)
      : isHttps
        ? 443
        : 80;
  const path = `${input.url.pathname}${input.url.search}`;
  const lookup = createPinnedLookup(input.pinned);
  const servername = hostname.replace(/^\[|\]$/g, '');

  return new Promise((resolve, reject) => {
    const req = lib.request(
      {
        protocol: input.url.protocol,
        hostname,
        port,
        path,
        method: 'POST',
        headers: {
          Host: input.url.host,
          ...input.headers,
          'Content-Length': Buffer.byteLength(input.body),
        },
        lookup,
        ...(isHttps ? { servername } : {}),
        timeout: input.timeoutMs,
      },
      (res: IncomingMessage) => {
        const status = res.statusCode ?? 0;
        discardWebhookResponseBody(res);
        resolve({ status });
      },
    );

    req.on('timeout', () => {
      const error = new Error('Webhook delivery timed out');
      error.name = 'TimeoutError';
      req.destroy(error);
    });
    req.on('error', (error) => {
      reject(error);
    });
    req.write(input.body);
    req.end();
  });
}

/**
 * Resolve DNS once, validate every address, then connect only to the pinned
 * IP. The original hostname is kept for Host and TLS SNI. Redirects are not
 * followed. TLS verification stays on (rejectUnauthorized is never false).
 */
export async function postPinnedWebhook(
  input: WebhookHttpPostInput,
  deps: PostPinnedWebhookDeps,
): Promise<WebhookHttpPostResult> {
  const target = await resolveSafeWebhookTarget(
    input.url,
    { allowPrivateTargets: deps.allowPrivateTargets },
    deps.lookup,
  );
  const request = deps.request ?? defaultPinnedWebhookRequest;
  return request({
    url: target.url,
    pinned: target.pinned,
    headers: input.headers,
    body: input.body,
    timeoutMs: input.timeoutMs,
  });
}

@Injectable()
export class FetchWebhookHttpPoster implements WebhookHttpPoster {
  constructor(@Inject(ENV) private readonly env: Env) {}

  post(input: WebhookHttpPostInput): Promise<WebhookHttpPostResult> {
    return postPinnedWebhook(input, {
      allowPrivateTargets: this.env.WEBHOOK_SSRF_ALLOW_PRIVATE_TARGETS,
    });
  }
}
