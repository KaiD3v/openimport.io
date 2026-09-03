import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { createValidationPipe } from '../../../common/validation/create-validation-pipe.js';
import { PutImportMappingDto } from '../dto/put-import-mapping.dto.js';

const validPayload = {
  expectedRevision: 0,
  mappings: [
    { columnPosition: 0, fieldKey: 'sku' },
    { columnPosition: 3, fieldKey: 'priceInCents' },
  ],
};

const bodyMetadata = {
  type: 'body' as const,
  metatype: PutImportMappingDto,
  data: '',
};

async function transformBody(payload: unknown): Promise<PutImportMappingDto> {
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

describe('PutImportMappingDto', () => {
  it('accepts a valid mapping payload', async () => {
    const result = await transformBody(validPayload);

    expect(result).toBeInstanceOf(PutImportMappingDto);
    expect(result.expectedRevision).toBe(0);
    expect(result.mappings).toHaveLength(2);
  });

  it('accepts an empty mappings array', async () => {
    const result = await transformBody({
      expectedRevision: 2,
      mappings: [],
    });

    expect(result.mappings).toEqual([]);
    expect(result.expectedRevision).toBe(2);
  });

  it('rejects string coercion for columnPosition', async () => {
    const response = await expectValidationFailure({
      expectedRevision: 0,
      mappings: [{ columnPosition: '0', fieldKey: 'sku' }],
    });

    expect(response.code).toBe('VALIDATION.FAILED');
    expect(
      response.details.some((detail) =>
        detail.field.includes('columnPosition'),
      ),
    ).toBe(true);
  });

  it('rejects string coercion for expectedRevision', async () => {
    const response = await expectValidationFailure({
      expectedRevision: '0',
      mappings: [],
    });

    expect(response.code).toBe('VALIDATION.FAILED');
    expect(
      response.details.some((detail) => detail.field === 'expectedRevision'),
    ).toBe(true);
  });

  it('rejects unknown properties', async () => {
    const response = await expectValidationFailure({
      ...validPayload,
      organizationId: '00000000-0000-0000-0000-000000000001',
    });

    expect(response.code).toBe('VALIDATION.FAILED');
  });

  it('rejects unknown nested properties', async () => {
    const response = await expectValidationFailure({
      expectedRevision: 0,
      mappings: [
        {
          columnPosition: 0,
          fieldKey: 'sku',
          label: 'extra',
        },
      ],
    });

    expect(response.code).toBe('VALIDATION.FAILED');
  });

  it('rejects a negative columnPosition', async () => {
    const response = await expectValidationFailure({
      expectedRevision: 0,
      mappings: [{ columnPosition: -1, fieldKey: 'sku' }],
    });

    expect(response.code).toBe('VALIDATION.FAILED');
  });

  it('rejects a negative expectedRevision', async () => {
    const response = await expectValidationFailure({
      expectedRevision: -1,
      mappings: [],
    });

    expect(response.code).toBe('VALIDATION.FAILED');
  });

  it('rejects more than 50 mappings', async () => {
    const response = await expectValidationFailure({
      expectedRevision: 0,
      mappings: Array.from({ length: 51 }, (_, index) => ({
        columnPosition: index,
        fieldKey: `field${index}`,
      })),
    });

    expect(response.code).toBe('VALIDATION.FAILED');
  });

  it('rejects nested empty arrays as mapping elements', async () => {
    const response = await expectValidationFailure({
      expectedRevision: 1,
      mappings: [[]],
    });

    expect(response.code).toBe('VALIDATION.FAILED');
  });

  it('rejects nested arrays that contain association objects', async () => {
    const response = await expectValidationFailure({
      expectedRevision: 1,
      mappings: [[{ columnPosition: 0, fieldKey: 'sku' }]],
    });

    expect(response.code).toBe('VALIDATION.FAILED');
  });

  it.each([null, 'sku', 0, true])(
    'rejects non-object mapping element %j',
    async (element) => {
      const response = await expectValidationFailure({
        expectedRevision: 0,
        mappings: [element],
      });

      expect(response.code).toBe('VALIDATION.FAILED');
    },
  );

  it('rejects an empty mapping object missing required fields', async () => {
    const response = await expectValidationFailure({
      expectedRevision: 0,
      mappings: [{}],
    });

    expect(response.code).toBe('VALIDATION.FAILED');
  });

  it('rejects a mapping object missing fieldKey', async () => {
    const response = await expectValidationFailure({
      expectedRevision: 0,
      mappings: [{ columnPosition: 0 }],
    });

    expect(response.code).toBe('VALIDATION.FAILED');
  });
});
