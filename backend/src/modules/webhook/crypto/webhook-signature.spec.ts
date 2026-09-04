import { describe, expect, it } from 'vitest';
import {
  signWebhookPayload,
  verifyWebhookSignature,
} from './webhook-signature.js';

const SECRET = 'oi_whsec_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const BODY = '{"id":"evt-1","type":"import.ready"}';

describe('webhook signature', () => {
  it('signs timestamp.rawBody with HMAC-SHA256 hex and verifies with timing-safe compare', () => {
    const timestamp = '1710000000';
    const signature = signWebhookPayload(SECRET, timestamp, BODY);

    expect(signature).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(
      verifyWebhookSignature({
        secret: SECRET,
        timestampHeader: timestamp,
        signatureHeader: signature,
        rawBody: BODY,
        nowSeconds: 1710000000,
      }),
    ).toEqual({ ok: true });
  });

  it('rejects a mutated body or secret', () => {
    const timestamp = '1710000000';
    const signature = signWebhookPayload(SECRET, timestamp, BODY);

    expect(
      verifyWebhookSignature({
        secret: SECRET,
        timestampHeader: timestamp,
        signatureHeader: signature,
        rawBody: BODY.replace('evt-1', 'evt-2'),
        nowSeconds: 1710000000,
      }),
    ).toEqual({ ok: false, reason: 'invalid' });

    expect(
      verifyWebhookSignature({
        secret: `${SECRET}x`,
        timestampHeader: timestamp,
        signatureHeader: signature,
        rawBody: BODY,
        nowSeconds: 1710000000,
      }),
    ).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects timestamps outside the 300s replay window', () => {
    const timestamp = '1710000000';
    const signature = signWebhookPayload(SECRET, timestamp, BODY);

    expect(
      verifyWebhookSignature({
        secret: SECRET,
        timestampHeader: timestamp,
        signatureHeader: signature,
        rawBody: BODY,
        nowSeconds: 1710000000 + 301,
      }),
    ).toEqual({ ok: false, reason: 'replay' });

    expect(
      verifyWebhookSignature({
        secret: SECRET,
        timestampHeader: timestamp,
        signatureHeader: signature,
        rawBody: BODY,
        nowSeconds: 1710000000 - 301,
      }),
    ).toEqual({ ok: false, reason: 'replay' });
  });

  it('accepts timestamps on the 300s boundary', () => {
    const timestamp = '1710000000';
    const signature = signWebhookPayload(SECRET, timestamp, BODY);

    expect(
      verifyWebhookSignature({
        secret: SECRET,
        timestampHeader: timestamp,
        signatureHeader: signature,
        rawBody: BODY,
        nowSeconds: 1710000000 + 300,
      }),
    ).toEqual({ ok: true });
  });
});
