export const IMPORT_READY_EVENT_TYPE = 'import.ready';

export const WEBHOOK_SECRET_PREFIX = 'oi_whsec_';
export const WEBHOOK_SECRET_PREFIX_LENGTH = 16;
export const WEBHOOK_SECRET_ENTROPY_BYTES = 32;

export const WEBHOOK_REPLAY_WINDOW_SECONDS = 300;

export const WEBHOOK_URL_MAX_LENGTH = 2048;

export const WEBHOOK_SIGNATURE_HEADER = 'OpenImport-Signature';
export const WEBHOOK_TIMESTAMP_HEADER = 'OpenImport-Timestamp';
export const WEBHOOK_IDEMPOTENCY_HEADER = 'OpenImport-Idempotency-Key';
