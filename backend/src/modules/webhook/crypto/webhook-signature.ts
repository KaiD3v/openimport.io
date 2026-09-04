import { createHmac, timingSafeEqual } from 'node:crypto';
import { WEBHOOK_REPLAY_WINDOW_SECONDS } from '../webhook.constants.js';

export function signWebhookPayload(
  secret: string,
  timestamp: string,
  rawBody: string,
): string {
  const digest = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest('hex');
  return `v1=${digest}`;
}

export type WebhookSignatureVerifyResult =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'replay' };

function timingSafeEqualUtf8(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export function parseUnixTimestampSeconds(value: string): number | null {
  if (!/^[0-9]{1,16}$/.test(value)) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    return null;
  }
  return parsed;
}

/**
 * Consumer-side verification: HMAC over `${timestamp}.${rawBody}`, constant-time
 * compare, and a ±300s replay window. Callers should also dedupe by payload `id`.
 */
export function verifyWebhookSignature(input: {
  secret: string;
  timestampHeader: string;
  signatureHeader: string;
  rawBody: string;
  nowSeconds?: number;
  replayWindowSeconds?: number;
}): WebhookSignatureVerifyResult {
  const timestamp = parseUnixTimestampSeconds(input.timestampHeader);
  if (timestamp === null) {
    return { ok: false, reason: 'invalid' };
  }

  const expected = signWebhookPayload(
    input.secret,
    input.timestampHeader,
    input.rawBody,
  );
  if (!timingSafeEqualUtf8(expected, input.signatureHeader)) {
    return { ok: false, reason: 'invalid' };
  }

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const window = input.replayWindowSeconds ?? WEBHOOK_REPLAY_WINDOW_SECONDS;
  if (Math.abs(now - timestamp) > window) {
    return { ok: false, reason: 'replay' };
  }

  return { ok: true };
}
