export type ImportSessionStatusValue =
  | 'created'
  | 'uploaded'
  | 'upload_failed';

export class ImportSessionTransitionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ImportSessionTransitionError';
    this.code = code;
  }
}

export function assertCanUpload(status: ImportSessionStatusValue): void {
  if (status === 'created') {
    return;
  }

  if (status === 'upload_failed') {
    throw new ImportSessionTransitionError(
      'IMPORT.UPLOAD_NOT_ALLOWED',
      'This import session can no longer accept a file upload.',
    );
  }

  throw new ImportSessionTransitionError(
    'IMPORT.FILE_ALREADY_UPLOADED',
    'This import session already has an uploaded file.',
  );
}

export function nextStatusAfterUploadSuccess(
  status: ImportSessionStatusValue,
): 'uploaded' {
  assertCanUpload(status);
  return 'uploaded';
}

export function nextStatusAfterUploadFailure(
  status: ImportSessionStatusValue,
): 'upload_failed' {
  if (status !== 'created') {
    throw new ImportSessionTransitionError(
      status === 'upload_failed'
        ? 'IMPORT.UPLOAD_NOT_ALLOWED'
        : 'IMPORT.FILE_ALREADY_UPLOADED',
      status === 'upload_failed'
        ? 'This import session can no longer accept a file upload.'
        : 'This import session already has an uploaded file.',
    );
  }
  return 'upload_failed';
}
