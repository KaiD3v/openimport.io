export function encodeRejectedRowsCursor(recordNumber: number): string {
  return Buffer.from(`rn:${recordNumber}`, 'utf8').toString('base64url');
}

export function decodeRejectedRowsCursor(cursor: string): number {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    throw new Error('INVALID_CURSOR');
  }
  const match = /^rn:(\d+)$/.exec(decoded);
  if (!match) {
    throw new Error('INVALID_CURSOR');
  }
  const recordNumber = Number(match[1]);
  if (!Number.isSafeInteger(recordNumber) || recordNumber < 0) {
    throw new Error('INVALID_CURSOR');
  }
  return recordNumber;
}
