import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { createValidationPipe } from '../../../common/validation/create-validation-pipe.js';
import { CreateImportPreviewDto } from './create-import-preview.dto.js';

const bodyMetadata = {
  type: 'body' as const,
  metatype: CreateImportPreviewDto,
  data: '',
};

async function transformBody(payload: unknown): Promise<CreateImportPreviewDto> {
  return createValidationPipe().transform(payload, bodyMetadata);
}

async function expectValidationFailure(payload: unknown) {
  try {
    await transformBody(payload);
    throw new Error('expected validation to fail');
  } catch (error) {
    if (error instanceof Error && error.message === 'expected validation to fail') {
      throw error;
    }
    expect(error).toBeInstanceOf(BadRequestException);
    return (error as BadRequestException).getResponse() as {
      code: string;
    };
  }
}

describe('CreateImportPreviewDto', () => {
  it('accepts a valid payload and leaves limit optional', async () => {
    const requiredOnly = await transformBody({ expectedMappingRevision: 1 });
    expect(requiredOnly.expectedMappingRevision).toBe(1);
    expect(requiredOnly.limit).toBeUndefined();

    const withLimit = await transformBody({
      expectedMappingRevision: 0,
      limit: 20,
    });
    expect(withLimit.limit).toBe(20);
  });

  it('rejects numeric strings, booleans, null, arrays, and unknown properties', async () => {
    for (const payload of [
      { expectedMappingRevision: '1' },
      { expectedMappingRevision: true },
      { expectedMappingRevision: null },
      { expectedMappingRevision: [1] },
      { expectedMappingRevision: 1, limit: '20' },
      { expectedMappingRevision: 1, limit: true },
      { expectedMappingRevision: 1, limit: null },
      { expectedMappingRevision: 1, limit: [20] },
      { expectedMappingRevision: 1, extra: true },
    ]) {
      const response = await expectValidationFailure(payload);
      expect(response.code).toBe('VALIDATION.FAILED');
    }
  });

  it('rejects limit outside 1..100', async () => {
    expect(
      (await expectValidationFailure({ expectedMappingRevision: 1, limit: 0 }))
        .code,
    ).toBe('VALIDATION.FAILED');
    expect(
      (await expectValidationFailure({ expectedMappingRevision: 1, limit: 101 }))
        .code,
    ).toBe('VALIDATION.FAILED');
  });

  it('accepts Number.MAX_SAFE_INTEGER as expectedMappingRevision', async () => {
    const result = await transformBody({
      expectedMappingRevision: Number.MAX_SAFE_INTEGER,
    });
    expect(result.expectedMappingRevision).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('rejects revisions outside the safe integer range', async () => {
    expect(
      (
        await expectValidationFailure({
          expectedMappingRevision: Number.MAX_SAFE_INTEGER + 1,
        })
      ).code,
    ).toBe('VALIDATION.FAILED');
    expect(
      (await expectValidationFailure({ expectedMappingRevision: 1e100 })).code,
    ).toBe('VALIDATION.FAILED');
    expect(
      (await expectValidationFailure({ expectedMappingRevision: -1 })).code,
    ).toBe('VALIDATION.FAILED');
    expect(
      (await expectValidationFailure({ expectedMappingRevision: 1.5 })).code,
    ).toBe('VALIDATION.FAILED');
  });
});
