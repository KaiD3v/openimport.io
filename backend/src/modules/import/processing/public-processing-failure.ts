export const PUBLIC_PROCESSING_FAILURE_CODES = [
  'IMPORT.FILE_CHANGED',
  'IMPORT.MAPPING_INCOMPLETE',
  'IMPORT.INVALID_CSV',
  'IMPORT.FILE_TOO_LARGE',
  'IMPORT.PROCESSING_FAILED',
  'IMPORT.NOT_FOUND',
] as const;

export type PublicProcessingFailureCode =
  (typeof PUBLIC_PROCESSING_FAILURE_CODES)[number];

const PUBLIC_MESSAGES: Record<PublicProcessingFailureCode, string> = {
  'IMPORT.FILE_CHANGED':
    'The uploaded file no longer matches the confirmed snapshot.',
  'IMPORT.MAPPING_INCOMPLETE':
    'The confirmed mapping is incomplete or no longer matches the session.',
  'IMPORT.INVALID_CSV': 'The CSV could not be parsed during processing.',
  'IMPORT.FILE_TOO_LARGE':
    'The file exceeded the configured size limit during processing.',
  'IMPORT.PROCESSING_FAILED':
    'Import processing failed after exhausting retries.',
  'IMPORT.NOT_FOUND': 'Import processing could not load the required session.',
};

export type PublicProcessingFailure = {
  code: string;
  message: string;
};

/**
 * Maps stored/internal failure codes to a stable public {code,message}.
 * Never echoes SDK, SQL, storage, Redis, or stack details.
 */
export function toPublicProcessingFailure(
  code: string | null | undefined,
  _message?: string | null,
): PublicProcessingFailure | null {
  if (!code) {
    return null;
  }

  if (
    (PUBLIC_PROCESSING_FAILURE_CODES as readonly string[]).includes(code)
  ) {
    return {
      code,
      message: PUBLIC_MESSAGES[code as PublicProcessingFailureCode],
    };
  }

  return {
    code: 'IMPORT.PROCESSING_FAILED',
    message: PUBLIC_MESSAGES['IMPORT.PROCESSING_FAILED'],
  };
}
