import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { createValidationPipe } from '../../../common/validation/create-validation-pipe.js';
import { ReportImportResultsDto } from './report-import-results.dto.js';

const executionId = '11111111-1111-4111-8111-111111111111';

const validPayload = {
  executionId,
  results: [
    { recordNumber: 1, outcome: 'accepted', clientRecordId: 'c-1' },
    {
      recordNumber: 3,
      outcome: 'rejected',
      error: { code: 'SKU_EXISTS', message: 'Already exists' },
    },
  ],
};

const bodyMetadata = {
  type: 'body' as const,
  metatype: ReportImportResultsDto,
  data: '',
};

async function transformBody(payload: unknown): Promise<ReportImportResultsDto> {
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
      message: string;
      details: { field: string; constraints: Record<string, string> }[];
    };
  }
}

describe('ReportImportResultsDto', () => {
  it('accepts a mixed accepted/rejected batch', async () => {
    const result = await transformBody(validPayload);
    expect(result).toBeInstanceOf(ReportImportResultsDto);
    expect(result.results).toHaveLength(2);
  });

  it('rejects unknown properties', async () => {
    const response = await expectValidationFailure({
      ...validPayload,
      organizationId: 'should-not-pass',
    });
    expect(response.code).toBe('VALIDATION.FAILED');
  });

  it('rejects string coercion for recordNumber', async () => {
    const response = await expectValidationFailure({
      executionId,
      results: [{ recordNumber: '1', outcome: 'accepted' }],
    });
    expect(response.code).toBe('VALIDATION.FAILED');
  });

  it('rejects rejected items without error', async () => {
    const response = await expectValidationFailure({
      executionId,
      results: [{ recordNumber: 1, outcome: 'rejected' }],
    });
    expect(response.code).toBe('VALIDATION.FAILED');
  });

  it('rejects empty results arrays', async () => {
    const response = await expectValidationFailure({
      executionId,
      results: [],
    });
    expect(response.code).toBe('VALIDATION.FAILED');
  });

  it('rejects oversized clientRecordId and error fields', async () => {
    const response = await expectValidationFailure({
      executionId,
      results: [
        {
          recordNumber: 1,
          outcome: 'rejected',
          clientRecordId: 'x'.repeat(129),
          error: { code: 'c'.repeat(65), message: 'm'.repeat(501) },
        },
      ],
    });
    expect(response.code).toBe('VALIDATION.FAILED');
  });

  it('accepts recordNumber at the PostgreSQL INTEGER bounds', async () => {
    const min = await transformBody({
      executionId,
      results: [{ recordNumber: 1, outcome: 'accepted' }],
    });
    expect(min.results[0]?.recordNumber).toBe(1);

    const max = await transformBody({
      executionId,
      results: [{ recordNumber: 2_147_483_647, outcome: 'accepted' }],
    });
    expect(max.results[0]?.recordNumber).toBe(2_147_483_647);
  });

  it('rejects recordNumber above PostgreSQL INTEGER max', async () => {
    for (const recordNumber of [
      2_147_483_648,
      Number.MAX_SAFE_INTEGER,
      1e100,
    ]) {
      const response = await expectValidationFailure({
        executionId,
        results: [{ recordNumber, outcome: 'accepted' }],
      });
      expect(response.code).toBe('VALIDATION.FAILED');
    }
  });

  it('rejects zero, negative, and decimal recordNumber', async () => {
    for (const recordNumber of [0, -1, 1.5]) {
      const response = await expectValidationFailure({
        executionId,
        results: [{ recordNumber, outcome: 'accepted' }],
      });
      expect(response.code).toBe('VALIDATION.FAILED');
    }
  });
});
