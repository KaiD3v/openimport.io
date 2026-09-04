import { describe, expect, it } from 'vitest';
import {
  WEBHOOK_SECRET_CIPHERTEXT_V2_PREFIX,
  decryptWebhookSecret,
  encryptWebhookSecret,
  generateWebhookSecret,
  webhookSecretAad,
  webhookSecretPrefix,
} from './webhook-secret.crypto.js';
import {
  WEBHOOK_SECRET_PREFIX,
  WEBHOOK_SECRET_PREFIX_LENGTH,
} from '../webhook.constants.js';

const ENCRYPTION_KEY =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

describe('webhook secret crypto', () => {
  it('generates a prefixed high-entropy secret and a short UI prefix', () => {
    const secret = generateWebhookSecret();
    expect(secret.startsWith(WEBHOOK_SECRET_PREFIX)).toBe(true);
    expect(secret.length).toBe(WEBHOOK_SECRET_PREFIX.length + 64);
    expect(webhookSecretPrefix(secret)).toHaveLength(WEBHOOK_SECRET_PREFIX_LENGTH);
    expect(webhookSecretPrefix(secret)).toBe(secret.slice(0, WEBHOOK_SECRET_PREFIX_LENGTH));
  });

  it('round-trips encryption without exposing plaintext in the ciphertext', () => {
    const secret = generateWebhookSecret();
    const ciphertext = encryptWebhookSecret(secret, ENCRYPTION_KEY);

    expect(ciphertext).not.toContain(secret);
    expect(decryptWebhookSecret(ciphertext, ENCRYPTION_KEY)).toBe(secret);
  });

  it('binds v2 ciphertext to organization and endpoint AAD', () => {
    const secret = generateWebhookSecret();
    const aad = webhookSecretAad(
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    );
    const ciphertext = encryptWebhookSecret(secret, ENCRYPTION_KEY, aad);

    expect(ciphertext.startsWith(WEBHOOK_SECRET_CIPHERTEXT_V2_PREFIX)).toBe(true);
    expect(ciphertext).not.toContain(secret);
    expect(decryptWebhookSecret(ciphertext, ENCRYPTION_KEY, aad)).toBe(secret);
    expect(() =>
      decryptWebhookSecret(
        ciphertext,
        ENCRYPTION_KEY,
        webhookSecretAad(
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        ),
      ),
    ).toThrow();
  });

  it('still decrypts legacy v1 ciphertext without AAD after snapshot copy', () => {
    const secret = generateWebhookSecret();
    const legacy = encryptWebhookSecret(secret, ENCRYPTION_KEY);
    expect(legacy.startsWith(WEBHOOK_SECRET_CIPHERTEXT_V2_PREFIX)).toBe(false);
    expect(
      decryptWebhookSecret(
        legacy,
        ENCRYPTION_KEY,
        webhookSecretAad('org', 'endpoint'),
      ),
    ).toBe(secret);
  });

  it('rejects a malformed encryption key without echoing it', () => {
    expect(() => encryptWebhookSecret('x', 'not-hex')).toThrow(
      /WEBHOOK_SECRET_ENCRYPTION_KEY/,
    );
    try {
      encryptWebhookSecret('x', 'supersecret-not-valid-key');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain('supersecret-not-valid-key');
    }
  });
});
