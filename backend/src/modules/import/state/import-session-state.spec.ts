import { describe, expect, it } from 'vitest';
import {
  ImportSessionTransitionError,
  assertCanConfirm,
  assertCanManageMapping,
  assertCanPreview,
  assertCanUpload,
  nextStatusAfterConfirm,
  nextStatusAfterProcessingFailure,
  nextStatusAfterProcessingStart,
  nextStatusAfterProcessingSuccess,
  nextStatusAfterUploadFailure,
  nextStatusAfterUploadSuccess,
} from './import-session-state.js';

describe('import session state machine', () => {
  it('allows upload from created and transitions to uploaded', () => {
    expect(() => assertCanUpload('created')).not.toThrow();
    expect(nextStatusAfterUploadSuccess('created')).toBe('uploaded');
  });

  it('rejects a second upload from uploaded', () => {
    try {
      assertCanUpload('uploaded');
    } catch (error) {
      expect(error).toBeInstanceOf(ImportSessionTransitionError);
      expect((error as ImportSessionTransitionError).code).toBe(
        'IMPORT.FILE_ALREADY_UPLOADED',
      );
      return;
    }
    throw new Error('expected transition error');
  });

  it('rejects upload from upload_failed with UPLOAD_NOT_ALLOWED', () => {
    try {
      assertCanUpload('upload_failed');
    } catch (error) {
      expect(error).toBeInstanceOf(ImportSessionTransitionError);
      expect((error as ImportSessionTransitionError).code).toBe(
        'IMPORT.UPLOAD_NOT_ALLOWED',
      );
      expect((error as ImportSessionTransitionError).message).not.toMatch(
        /already has an uploaded file/i,
      );
      return;
    }
    throw new Error('expected transition error');
  });

  it('rejects upload after confirmation lifecycle statuses', () => {
    for (const status of [
      'queued',
      'processing',
      'ready',
      'processing_failed',
    ] as const) {
      try {
        assertCanUpload(status);
        throw new Error(`expected transition error for ${status}`);
      } catch (error) {
        expect(error).toBeInstanceOf(ImportSessionTransitionError);
        expect((error as ImportSessionTransitionError).code).toBe(
          'IMPORT.FILE_ALREADY_UPLOADED',
        );
      }
    }
  });

  it('records upload_failed without marking uploaded', () => {
    expect(nextStatusAfterUploadFailure('created')).toBe('upload_failed');
  });

  it('rejects invalid success transitions', () => {
    expect(() => nextStatusAfterUploadSuccess('uploaded')).toThrow(
      ImportSessionTransitionError,
    );
  });

  it('allows mapping only when status is uploaded', () => {
    expect(() => assertCanManageMapping('uploaded')).not.toThrow();
  });

  it('rejects mapping from created, upload_failed, and post-confirm statuses', () => {
    for (const status of [
      'created',
      'upload_failed',
      'queued',
      'processing',
      'ready',
      'processing_failed',
    ] as const) {
      try {
        assertCanManageMapping(status);
        throw new Error(`expected transition error for ${status}`);
      } catch (error) {
        expect(error).toBeInstanceOf(ImportSessionTransitionError);
        expect((error as ImportSessionTransitionError).code).toBe(
          'IMPORT.MAPPING_NOT_ALLOWED',
        );
      }
    }
  });

  it('allows preview only when status is uploaded', () => {
    expect(() => assertCanPreview('uploaded')).not.toThrow();
  });

  it('rejects preview outside uploaded', () => {
    for (const status of [
      'created',
      'upload_failed',
      'queued',
      'processing',
      'ready',
      'processing_failed',
    ] as const) {
      try {
        assertCanPreview(status);
        throw new Error(`expected transition error for ${status}`);
      } catch (error) {
        expect(error).toBeInstanceOf(ImportSessionTransitionError);
        expect((error as ImportSessionTransitionError).code).toBe(
          'IMPORT.PREVIEW_NOT_ALLOWED',
        );
      }
    }
  });

  it('allows confirm only from uploaded and transitions to queued', () => {
    expect(() => assertCanConfirm('uploaded')).not.toThrow();
    expect(nextStatusAfterConfirm('uploaded')).toBe('queued');
  });

  it('rejects confirm outside uploaded with CONFIRMATION_NOT_ALLOWED', () => {
    for (const status of [
      'created',
      'upload_failed',
      'queued',
      'processing',
      'ready',
      'processing_failed',
    ] as const) {
      try {
        assertCanConfirm(status);
        throw new Error(`expected transition error for ${status}`);
      } catch (error) {
        expect(error).toBeInstanceOf(ImportSessionTransitionError);
        expect((error as ImportSessionTransitionError).code).toBe(
          'IMPORT.CONFIRMATION_NOT_ALLOWED',
        );
      }
    }
  });

  it('transitions queued → processing → ready', () => {
    expect(nextStatusAfterProcessingStart('queued')).toBe('processing');
    expect(nextStatusAfterProcessingSuccess('processing')).toBe('ready');
  });

  it('transitions processing → processing_failed without reusing upload_failed', () => {
    expect(nextStatusAfterProcessingFailure('processing')).toBe(
      'processing_failed',
    );
    expect(nextStatusAfterProcessingFailure('queued')).toBe(
      'processing_failed',
    );
  });

  it('rejects invalid processing transitions', () => {
    expect(() => nextStatusAfterProcessingStart('uploaded')).toThrow(
      ImportSessionTransitionError,
    );
    expect(() => nextStatusAfterProcessingSuccess('queued')).toThrow(
      ImportSessionTransitionError,
    );
    expect(() => nextStatusAfterProcessingFailure('ready')).toThrow(
      ImportSessionTransitionError,
    );
  });
});
