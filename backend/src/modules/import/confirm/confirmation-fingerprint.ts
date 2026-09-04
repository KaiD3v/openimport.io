import { createHash } from 'node:crypto';

export type ConfirmationSnapshot = {
  expectedMappingRevision: number;
  expectedContentSha256: string;
};

const SHA256_HEX = /^[a-f0-9]{64}$/;

export function isContentSha256(value: string): boolean {
  return SHA256_HEX.test(value);
}

/**
 * Deterministic fingerprint for an idempotent confirmation snapshot.
 * Same revision + hash → same fingerprint; used for replay detection.
 */
export function confirmationFingerprint(
  snapshot: ConfirmationSnapshot,
): string {
  return createHash('sha256')
    .update(
      `${snapshot.expectedMappingRevision}:${snapshot.expectedContentSha256}`,
      'utf8',
    )
    .digest('hex');
}

export function confirmationJobId(
  importSessionId: string,
  fingerprint: string,
): string {
  // Avoid ':' separators — BullMQ will stop accepting multi-segment ':' job IDs.
  return `import-process.${importSessionId}.${fingerprint}`;
}

export function snapshotsMatch(
  left: ConfirmationSnapshot,
  right: ConfirmationSnapshot,
): boolean {
  return (
    left.expectedMappingRevision === right.expectedMappingRevision &&
    left.expectedContentSha256 === right.expectedContentSha256
  );
}
