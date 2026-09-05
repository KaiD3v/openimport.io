import express from 'express';
import type { Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveClientIp } from './client-ip.js';
import type { Env } from '../../core/config/env.js';

describe('proxy trust chain', () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (!server) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      server!.close((error) => (error ? reject(error) : resolve()));
    });
    server = undefined;
  });

  it('with trust proxy=1 uses overwritten XFF and ignores client spoof when remote is the proxy', async () => {
    const app = express();
    app.set('trust proxy', 1);
    let seenIp = '';
    app.get('/ip', (req, res) => {
      seenIp = resolveClientIp(req as never, {
        RATE_LIMIT_TRUSTED_PROXY: true,
      } as Env);
      res.json({ ip: seenIp, expressIp: req.ip });
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server!.address();
    if (!address || typeof address === 'string') {
      throw new Error('expected port');
    }

    // Simulate nginx overwrite: only the proxy-observed client IP is forwarded.
    const response = await fetch(`http://127.0.0.1:${address.port}/ip`, {
      headers: { 'X-Forwarded-For': '203.0.113.10' },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ip: string; expressIp: string };
    expect(body.ip).toBe('203.0.113.10');
    expect(body.expressIp).toBe('203.0.113.10');
  });

  it('without trusted proxy ignores X-Forwarded-For for rate-limit IP', async () => {
    const app = express();
    app.set('trust proxy', false);
    app.get('/ip', (req, res) => {
      res.json({
        limited: resolveClientIp(req as never, {
          RATE_LIMIT_TRUSTED_PROXY: false,
        } as Env),
        expressIp: req.ip,
      });
    });

    await new Promise<void>((resolve) => {
      server = app.listen(0, '127.0.0.1', () => resolve());
    });
    const address = server!.address();
    if (!address || typeof address === 'string') {
      throw new Error('expected port');
    }

    const response = await fetch(`http://127.0.0.1:${address.port}/ip`, {
      headers: { 'X-Forwarded-For': '198.51.100.20' },
    });
    const body = (await response.json()) as {
      limited: string;
      expressIp: string;
    };
    expect(body.limited).toMatch(/127\.0\.0\.1|::1/);
    expect(body.limited).not.toBe('198.51.100.20');
  });
});
