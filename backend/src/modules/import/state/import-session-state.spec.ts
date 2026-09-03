import { describe, expect, it } from 'vitest';
import {
  ImportSessionTransitionError,
  assertCanManageMapping,
  assertCanUpload,
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
      throw new Error('expected transition error');
    } catch (error) {
      expect(error).toBeInstanceOf(ImportSessionTransitionError);
      expect((error as ImportSessionTransitionError).code).toBe(
        'IMPORT.FILE_ALREADY_UPLOADED',
      );
    }
  });

  it('rejects upload from upload_failed with UPLOAD_NOT_ALLOWED', () => {
    try {
      assertCanUpload('upload_failed');
      throw new Error('expected transition error');
    } catch (error) {
      expect(error).toBeInstanceOf(ImportSessionTransitionError);
      expect((error as ImportSessionTransitionError).code).toBe(
        'IMPORT.UPLOAD_NOT_ALLOWED',
      );
      expect((error as ImportSessionTransitionError).message).not.toMatch(
        /already has an uploaded file/i,
      );
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

  it('rejects mapping from created and upload_failed', () => {
    for (const status of ['created', 'upload_failed'] as const) {
      try {
        assertCanManageMapping(status);
        throw new Error('expected transition error');
      } catch (error) {
        expect(error).toBeInstanceOf(ImportSessionTransitionError);
        expect((error as ImportSessionTransitionError).code).toBe(
          'IMPORT.MAPPING_NOT_ALLOWED',
        );
      }
    }
  });
});
