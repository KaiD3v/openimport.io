const CURSOR_VERSION = 1;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ValidRowsCursorPayload = {
  version: typeof CURSOR_VERSION;
  executionId: string;
  recordNumber: number;
};

export function encodeValidRowsCursor(input: {
  executionId: string;
  recordNumber: number;
}): string {
  return Buffer.from(
    `v${CURSOR_VERSION}:${input.executionId}:${input.recordNumber}`,
    'utf8',
  ).toString('base64url');
}

export function decodeValidRowsCursor(cursor: string): ValidRowsCursorPayload {
  let decoded: string;
  try {
    decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  } catch {
    throw new Error('INVALID_CURSOR');
  }

  const match = /^v(\d+):([^:]+):(\d+)$/.exec(decoded);
  if (!match) {
    throw new Error('INVALID_CURSOR');
  }

  const version = Number(match[1]);
  if (version !== CURSOR_VERSION) {
    throw new Error('INVALID_CURSOR');
  }

  const executionId = match[2]!;
  if (!UUID_RE.test(executionId)) {
    throw new Error('INVALID_CURSOR');
  }

  const recordNumber = Number(match[3]);
  if (!Number.isSafeInteger(recordNumber) || recordNumber < 0) {
    throw new Error('INVALID_CURSOR');
  }

  return { version: CURSOR_VERSION, executionId, recordNumber };
}
