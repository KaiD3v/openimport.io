import { describe, expect, it, vi } from 'vitest';
import {
  UnsafeWebhookUrlError,
  assertSafeWebhookUrl,
  isBlockedIpAddress,
  resolveSafeWebhookTarget,
  type DnsLookup,
} from './assert-safe-webhook-url.js';

describe('assertSafeWebhookUrl', () => {
  it('classifies loopback, private, link-local, metadata and mapped addresses as blocked', () => {
    expect(isBlockedIpAddress('127.0.0.1')).toBe(true);
    expect(isBlockedIpAddress('10.0.0.1')).toBe(true);
    expect(isBlockedIpAddress('192.168.1.1')).toBe(true);
    expect(isBlockedIpAddress('169.254.169.254')).toBe(true);
    expect(isBlockedIpAddress('172.16.0.1')).toBe(true);
    expect(isBlockedIpAddress('::1')).toBe(true);
    expect(isBlockedIpAddress('fc00::1')).toBe(true);
    expect(isBlockedIpAddress('fe80::1')).toBe(true);
    expect(isBlockedIpAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isBlockedIpAddress('::ffff:7f00:1')).toBe(true);
    expect(isBlockedIpAddress('::ffff:a9fe:a9fe')).toBe(true);
    expect(isBlockedIpAddress('::ffff:10.0.0.1')).toBe(true);
    expect(isBlockedIpAddress('8.8.8.8')).toBe(false);
    expect(isBlockedIpAddress('1.1.1.1')).toBe(false);
    expect(isBlockedIpAddress('2001:4860:4860::8888')).toBe(false);
  });

  it('rejects non-https, credentials, localhost names and private IP literals', async () => {
    const lookup = vi.fn<DnsLookup>();

    await expect(
      assertSafeWebhookUrl('http://example.com/hook', { allowPrivateTargets: false }, lookup),
    ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    await expect(
      assertSafeWebhookUrl('https://user:pass@example.com/hook', { allowPrivateTargets: false }, lookup),
    ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    await expect(
      assertSafeWebhookUrl('https://localhost/hook', { allowPrivateTargets: false }, lookup),
    ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    await expect(
      assertSafeWebhookUrl('https://127.0.0.1/hook', { allowPrivateTargets: false }, lookup),
    ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    await expect(
      assertSafeWebhookUrl('https://169.254.169.254/latest/meta-data', { allowPrivateTargets: false }, lookup),
    ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    await expect(
      assertSafeWebhookUrl('https://[::ffff:127.0.0.1]/hook', { allowPrivateTargets: false }, lookup),
    ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    await expect(
      assertSafeWebhookUrl('https://[::ffff:7f00:1]/hook', { allowPrivateTargets: false }, lookup),
    ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
    expect(lookup).not.toHaveBeenCalled();
  });

  it('rejects a hostname when any resolved address is private', async () => {
    const lookup: DnsLookup = vi.fn().mockResolvedValue([
      { address: '1.1.1.1', family: 4 },
      { address: '10.0.0.8', family: 4 },
    ]);

    await expect(
      assertSafeWebhookUrl('https://dual.example/hook', { allowPrivateTargets: false }, lookup),
    ).rejects.toBeInstanceOf(UnsafeWebhookUrlError);
  });

  it('accepts https when every resolved address is public and pins the first', async () => {
    const lookup: DnsLookup = vi.fn().mockResolvedValue([
      { address: '1.1.1.1', family: 4 },
      { address: '8.8.8.8', family: 4 },
    ]);

    const target = await resolveSafeWebhookTarget(
      'https://hooks.example.com/import-ready',
      { allowPrivateTargets: false },
      lookup,
    );
    expect(target.url.hostname).toBe('hooks.example.com');
    expect(target.pinned).toEqual({ address: '1.1.1.1', family: 4 });
    expect(target.addresses).toEqual([
      { address: '1.1.1.1', family: 4 },
      { address: '8.8.8.8', family: 4 },
    ]);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith('hooks.example.com', { all: true });
  });

  it('allows loopback http only when private targets are explicitly enabled', async () => {
    const lookup = vi.fn<DnsLookup>();
    const url = await assertSafeWebhookUrl(
      'http://127.0.0.1:9999/hook',
      { allowPrivateTargets: true },
      lookup,
    );
    expect(url.hostname).toBe('127.0.0.1');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('does not consult lookup a second time after pinning a public answer', async () => {
    let calls = 0;
    const lookup: DnsLookup = async () => {
      calls += 1;
      if (calls === 1) {
        return [{ address: '1.1.1.1', family: 4 }];
      }
      return [{ address: '169.254.169.254', family: 4 }];
    };

    const target = await resolveSafeWebhookTarget(
      'https://rebind.example/hook',
      { allowPrivateTargets: false },
      lookup,
    );
    expect(target.pinned.address).toBe('1.1.1.1');
    expect(calls).toBe(1);
  });
});
