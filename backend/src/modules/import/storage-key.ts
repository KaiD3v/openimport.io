import { randomBytes } from 'node:crypto';

export function buildStorageObjectKey(
  organizationId: string,
  importSessionId: string,
): string {
  const entropy = randomBytes(16).toString('hex');
  return `org/${organizationId}/imports/${importSessionId}/${entropy}.csv`;
}

export function normalizeOriginalFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? 'upload.csv';
  const stripped = base.replace(/[^\w.\- ()[\]]+/g, '_').trim();
  if (stripped.length === 0) {
    return 'upload.csv';
  }
  return stripped.slice(0, 255);
}
