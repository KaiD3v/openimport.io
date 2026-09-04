import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import {
  WEBHOOK_SECRET_ENTROPY_BYTES,
  WEBHOOK_SECRET_PREFIX,
  WEBHOOK_SECRET_PREFIX_LENGTH,
} from '../webhook.constants.js';

const AES_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const ENCRYPTION_KEY_BYTES = 32;

/** Versioned envelope: AES-GCM with AAD `organizationId:endpointId`. */
export const WEBHOOK_SECRET_CIPHERTEXT_V2_PREFIX = 'v2.';

export function generateWebhookSecret(): string {
  return `${WEBHOOK_SECRET_PREFIX}${randomBytes(WEBHOOK_SECRET_ENTROPY_BYTES).toString('hex')}`;
}

export function webhookSecretPrefix(rawSecret: string): string {
  return rawSecret.slice(0, WEBHOOK_SECRET_PREFIX_LENGTH);
}

export function webhookSecretAad(
  organizationId: string,
  endpointId: string,
): string {
  return `${organizationId}:${endpointId}`;
}

export function parseWebhookEncryptionKey(hexKey: string): Buffer {
  if (!/^[0-9a-f]{64}$/.test(hexKey)) {
    throw new Error('WEBHOOK_SECRET_ENCRYPTION_KEY must be 64 lowercase hex characters.');
  }
  const key = Buffer.from(hexKey, 'hex');
  if (key.length !== ENCRYPTION_KEY_BYTES) {
    throw new Error('WEBHOOK_SECRET_ENCRYPTION_KEY must decode to 32 bytes.');
  }
  return key;
}

function encryptInner(plaintext: string, hexKey: string, aad?: string): Buffer {
  const key = parseWebhookEncryptionKey(hexKey);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(AES_ALGORITHM, key, iv);
  if (aad !== undefined) {
    cipher.setAAD(Buffer.from(aad, 'utf8'));
  }
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

function decryptInner(blob: Buffer, hexKey: string, aad?: string): string {
  const key = parseWebhookEncryptionKey(hexKey);
  if (blob.length <= IV_LENGTH + AUTH_TAG_LENGTH) {
    throw new Error('Webhook secret ciphertext is malformed.');
  }
  const iv = blob.subarray(0, IV_LENGTH);
  const tag = blob.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const data = blob.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(AES_ALGORITHM, key, iv);
  if (aad !== undefined) {
    decipher.setAAD(Buffer.from(aad, 'utf8'));
  }
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString(
    'utf8',
  );
}

/**
 * Encrypt a webhook signing secret.
 * When `aad` is provided, the ciphertext is prefixed with `v2.` and bound to
 * that AAD (organizationId:endpointId). Legacy callers omit AAD (v1 blob).
 */
export function encryptWebhookSecret(
  plaintext: string,
  hexKey: string,
  aad?: string,
): string {
  const blob = encryptInner(plaintext, hexKey, aad);
  if (aad !== undefined) {
    return `${WEBHOOK_SECRET_CIPHERTEXT_V2_PREFIX}${blob.toString('base64')}`;
  }
  return blob.toString('base64');
}

/**
 * Decrypt a webhook signing secret.
 * `v2.` blobs require the same AAD used at encrypt time. Unprefixed blobs are
 * legacy v1 (no AAD) and remain readable after the snapshot backfill.
 */
export function decryptWebhookSecret(
  ciphertext: string,
  hexKey: string,
  aad?: string,
): string {
  if (ciphertext.startsWith(WEBHOOK_SECRET_CIPHERTEXT_V2_PREFIX)) {
    if (aad === undefined) {
      throw new Error('Webhook secret ciphertext requires AAD.');
    }
    return decryptInner(
      Buffer.from(ciphertext.slice(WEBHOOK_SECRET_CIPHERTEXT_V2_PREFIX.length), 'base64'),
      hexKey,
      aad,
    );
  }
  return decryptInner(Buffer.from(ciphertext, 'base64'), hexKey);
}
