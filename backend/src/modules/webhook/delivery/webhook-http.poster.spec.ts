import { createServer, type IncomingMessage } from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../core/config/env.js';
import {
  FetchWebhookHttpPoster,
  createPinnedLookup,
  discardWebhookResponseBody,
  postPinnedWebhook,
} from './webhook-http.poster.js';
import type { DnsLookup } from '../ssrf/assert-safe-webhook-url.js';

describe('pinned webhook HTTP transport', () => {
  const servers: Array<{ close: () => Promise<void> }> = [];

  afterEach(async () => {
    while (servers.length > 0) {
      const server = servers.pop();
      if (server) {
        await server.close();
      }
    }
  });

  it('connects only to the address pinned on the first lookup when DNS later rebinds', async () => {
    let lookups = 0;
    const lookup: DnsLookup = async () => {
      lookups += 1;
      if (lookups === 1) {
        return [{ address: '1.1.1.1', family: 4 }];
      }
      return [{ address: '169.254.169.254', family: 4 }];
    };
    const request = vi.fn(async (input) => {
      expect(input.pinned).toEqual({ address: '1.1.1.1', family: 4 });
      expect(input.url.hostname).toBe('hooks.example.com');
      return { status: 204 };
    });

    const result = await postPinnedWebhook(
      {
        url: 'https://hooks.example.com/import-ready?token=secret',
        body: '{}',
        headers: { 'Content-Type': 'application/json' },
        timeoutMs: 1000,
      },
      { allowPrivateTargets: false, lookup, request },
    );

    expect(result.status).toBe(204);
    expect(lookups).toBe(1);
    expect(request).toHaveBeenCalledOnce();
  });

  it('keeps the original hostname for Host and SNI while pinning the IP', async () => {
    const lookup: DnsLookup = vi.fn().mockResolvedValue([
      { address: '1.1.1.1', family: 4 },
    ]);
    const request = vi.fn(async (input) => {
      expect(input.url.hostname).toBe('hooks.example.com');
      expect(input.pinned.address).toBe('1.1.1.1');
      return { status: 200 };
    });

    await postPinnedWebhook(
      {
        url: 'https://hooks.example.com/ready',
        body: '{}',
        headers: {},
        timeoutMs: 1000,
      },
      { allowPrivateTargets: false, lookup, request },
    );

    const pinnedLookup = createPinnedLookup({ address: '1.1.1.1', family: 4 });
    const all = await new Promise<Array<{ address: string; family: number }>>(
      (resolve, reject) => {
        pinnedLookup(
          'hooks.example.com',
          { all: true },
          (error, addresses) => {
            if (error) {
              reject(error);
              return;
            }
            resolve(addresses as Array<{ address: string; family: number }>);
          },
        );
      },
    );
    expect(all).toEqual([{ address: '1.1.1.1', family: 4 }]);
  });

  it('discards the response body after reading the status', async () => {
    const resume = vi.fn();
    const destroy = vi.fn();
    const res = {
      readableEnded: false,
      destroyed: false,
      resume,
      destroy,
    } as unknown as IncomingMessage;

    discardWebhookResponseBody(res);
    expect(resume).toHaveBeenCalledOnce();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('does not buffer a large response body from a loopback receiver', async () => {
    const server = createServer((_req, res) => {
      res.writeHead(204, { 'Content-Type': 'text/plain' });
      res.write('x'.repeat(256 * 1024));
      res.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.listen(0, '127.0.0.1', () => resolve());
      server.on('error', reject);
    });
    servers.push({
      close: () =>
        new Promise((resolve, reject) => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        }),
    });
    const address = server.address() as AddressInfo;
    const poster = new FetchWebhookHttpPoster({
      WEBHOOK_SSRF_ALLOW_PRIVATE_TARGETS: true,
    } as Env);

    const started = Date.now();
    const result = await poster.post({
      url: `http://127.0.0.1:${address.port}/hook`,
      body: '{}',
      headers: { 'Content-Type': 'application/json' },
      timeoutMs: 2000,
    });
    expect(result.status).toBe(204);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
