import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { createValidationPipe } from '../../../common/validation/create-validation-pipe.js';
import { CreateImportAccessTokenDto } from './create-import-access-token.dto.js';

const bodyMetadata = {
  type: 'body' as const,
  metatype: CreateImportAccessTokenDto,
  data: '',
};

async function transformBody(payload: unknown): Promise<CreateImportAccessTokenDto> {
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
    return (error as BadRequestException).getResponse() as { code: string };
  }
}

describe('CreateImportAccessTokenDto', () => {
  it('accepts an empty object and a valid TTL', async () => {
    const empty = await transformBody({});
    expect(empty.expiresInSeconds).toBeUndefined();

    const withTtl = await transformBody({ expiresInSeconds: 60 });
    expect(withTtl.expiresInSeconds).toBe(60);
  });

  it('rejects out-of-range TTL, numeric strings, and unknown properties', async () => {
    for (const payload of [
      { expiresInSeconds: 59 },
      { expiresInSeconds: 3601 },
      { expiresInSeconds: '1800' },
      { expiresInSeconds: 1800.5 },
      { expiresInSeconds: true },
      { extra: true },
    ]) {
      const response = await expectValidationFailure(payload);
      expect(response.code).toBe('VALIDATION.FAILED');
    }
  });
});
