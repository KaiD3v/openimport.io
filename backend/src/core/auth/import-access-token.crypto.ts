import { createHash, randomBytes } from 'node:crypto';

export const IMPORT_ACCESS_TOKEN_PREFIX = 'oi_import_';
export const IMPORT_ACCESS_TOKEN_PREFIX_LENGTH = 24;
const TOKEN_ENTROPY_BYTES = 32;

export function generateImportAccessToken(): string {
  return `${IMPORT_ACCESS_TOKEN_PREFIX}${randomBytes(TOKEN_ENTROPY_BYTES).toString('hex')}`;
}

export function hashImportAccessToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

export function importAccessTokenPrefix(rawToken: string): string {
  return rawToken.slice(0, IMPORT_ACCESS_TOKEN_PREFIX_LENGTH);
}

export function isImportAccessToken(rawToken: string): boolean {
  return rawToken.startsWith(IMPORT_ACCESS_TOKEN_PREFIX);
}
