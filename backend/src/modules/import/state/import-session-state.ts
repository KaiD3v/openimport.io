export type ImportSessionStatusValue =
  | 'created'
  | 'uploaded'
  | 'queued'
  | 'processing'
  | 'ready'
  | 'processing_failed'
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

export function assertCanManageMapping(
  status: ImportSessionStatusValue,
): void {
  if (status === 'uploaded') {
    return;
  }

  throw new ImportSessionTransitionError(
    'IMPORT.MAPPING_NOT_ALLOWED',
    'Column mapping is only available after a CSV file has been uploaded and before confirmation.',
  );
}

export function assertCanPreview(
  status: ImportSessionStatusValue,
): void {
  if (status === 'uploaded') {
    return;
  }

  throw new ImportSessionTransitionError(
    'IMPORT.PREVIEW_NOT_ALLOWED',
    'Preview is only available after a CSV file has been uploaded and before confirmation.',
  );
}

export function assertCanConfirm(status: ImportSessionStatusValue): void {
  if (status === 'uploaded') {
    return;
  }

  throw new ImportSessionTransitionError(
    'IMPORT.CONFIRMATION_NOT_ALLOWED',
    'Confirmation is only available for uploaded sessions with a complete mapping.',
  );
}

export function nextStatusAfterConfirm(
  status: ImportSessionStatusValue,
): 'queued' {
  assertCanConfirm(status);
  return 'queued';
}

export function nextStatusAfterProcessingStart(
  status: ImportSessionStatusValue,
): 'processing' {
  if (status === 'queued') {
    return 'processing';
  }

  throw new ImportSessionTransitionError(
    'IMPORT.CONFIRMATION_NOT_ALLOWED',
    'Processing can only start from a queued import session.',
  );
}

export function nextStatusAfterProcessingSuccess(
  status: ImportSessionStatusValue,
): 'ready' {
  if (status === 'processing') {
    return 'ready';
  }

  throw new ImportSessionTransitionError(
    'IMPORT.CONFIRMATION_NOT_ALLOWED',
    'A ready snapshot can only be published from a processing session.',
  );
}

export function nextStatusAfterProcessingFailure(
  status: ImportSessionStatusValue,
): 'processing_failed' {
  if (status === 'queued' || status === 'processing') {
    return 'processing_failed';
  }

  throw new ImportSessionTransitionError(
    'IMPORT.CONFIRMATION_NOT_ALLOWED',
    'Processing failure can only be recorded for queued or processing sessions.',
  );
}
