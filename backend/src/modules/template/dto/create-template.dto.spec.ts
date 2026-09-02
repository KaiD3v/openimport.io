import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { createValidationPipe } from '../../../common/validation/create-validation-pipe.js';
import { CreateTemplateDto } from './create-template.dto.js';

const validPayload = {
  name: 'products',
  fields: [
    { key: 'sku', label: 'SKU', type: 'string', required: true },
    { key: 'priceInCents', label: 'Preço', type: 'currency', required: true },
  ],
};

const bodyMetadata = {
  type: 'body' as const,
  metatype: CreateTemplateDto,
  data: '',
};

async function transformBody(payload: unknown): Promise<CreateTemplateDto> {
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

describe('CreateTemplateDto', () => {
  it('accepts a valid template payload', async () => {
    const result = await transformBody(validPayload);

    expect(result).toBeInstanceOf(CreateTemplateDto);
    expect(result.name).toBe('products');
    expect(result.fields[0]?.required).toBe(true);
  });

  it('trims valid name and label strings', async () => {
    const result = await transformBody({
      name: '  products  ',
      fields: [
        { key: 'sku', label: '  SKU  ', type: 'string', required: false },
      ],
    });

    expect(result.name).toBe('products');
    expect(result.fields[0]?.label).toBe('SKU');
    expect(result.fields[0]?.required).toBe(false);
  });

  it('rejects an empty name', async () => {
    const response = await expectValidationFailure({
      ...validPayload,
      name: '   ',
    });

    expect(response.code).toBe('VALIDATION.FAILED');
    expect(response.details.some((detail) => detail.field === 'name')).toBe(
      true,
    );
  });

  it('rejects a name longer than 100 characters', async () => {
    const response = await expectValidationFailure({
      ...validPayload,
      name: 'n'.repeat(101),
    });

    expect(response.details.some((detail) => detail.field === 'name')).toBe(
      true,
    );
  });

  it('rejects an empty fields list', async () => {
    const response = await expectValidationFailure({
      ...validPayload,
      fields: [],
    });

    expect(response.details.some((detail) => detail.field === 'fields')).toBe(
      true,
    );
  });

  it('rejects more than 50 fields', async () => {
    const response = await expectValidationFailure({
      ...validPayload,
      fields: Array.from({ length: 51 }, (_, index) => ({
        key: `field${index}`,
        label: `Field ${index}`,
        type: 'string',
        required: false,
      })),
    });

    expect(response.details.some((detail) => detail.field === 'fields')).toBe(
      true,
    );
  });

  it('rejects an unknown field type', async () => {
    const response = await expectValidationFailure({
      ...validPayload,
      fields: [{ key: 'sku', label: 'SKU', type: 'boolean', required: true }],
    });

    expect(response.details.length).toBeGreaterThan(0);
  });

  it('rejects an unsafe field key', async () => {
    const response = await expectValidationFailure({
      ...validPayload,
      fields: [{ key: 'SKU-1', label: 'SKU', type: 'string', required: true }],
    });

    expect(response.details.length).toBeGreaterThan(0);
  });

  it('rejects a blank field label', async () => {
    const response = await expectValidationFailure({
      ...validPayload,
      fields: [{ key: 'sku', label: ' ', type: 'string', required: true }],
    });

    expect(response.details.length).toBeGreaterThan(0);
  });

  it('rejects duplicate field keys in the same payload', async () => {
    const response = await expectValidationFailure({
      ...validPayload,
      fields: [
        { key: 'sku', label: 'SKU', type: 'string', required: true },
        { key: 'sku', label: 'Stock', type: 'string', required: false },
      ],
    });

    expect(response.details.some((detail) => detail.field === 'fields')).toBe(
      true,
    );
  });

  it('rejects unknown properties including organizationId', async () => {
    const response = await expectValidationFailure({
      ...validPayload,
      organizationId: '00000000-0000-0000-0000-000000000000',
    });

    expect(
      response.details.some((detail) => detail.field === 'organizationId'),
    ).toBe(true);
  });

  it('rejects a string boolean for required', async () => {
    const asFalse = await expectValidationFailure({
      ...validPayload,
      fields: [{ key: 'sku', label: 'SKU', type: 'string', required: 'false' }],
    });
    const asTrue = await expectValidationFailure({
      ...validPayload,
      fields: [{ key: 'sku', label: 'SKU', type: 'string', required: 'true' }],
    });

    expect(asFalse.code).toBe('VALIDATION.FAILED');
    expect(asTrue.code).toBe('VALIDATION.FAILED');
  });

  it('rejects numeric booleans for required', async () => {
    const asZero = await expectValidationFailure({
      ...validPayload,
      fields: [{ key: 'sku', label: 'SKU', type: 'string', required: 0 }],
    });
    const asOne = await expectValidationFailure({
      ...validPayload,
      fields: [{ key: 'sku', label: 'SKU', type: 'string', required: 1 }],
    });

    expect(asZero.code).toBe('VALIDATION.FAILED');
    expect(asOne.code).toBe('VALIDATION.FAILED');
  });

  it('rejects a numeric name', async () => {
    const response = await expectValidationFailure({
      ...validPayload,
      name: 123,
    });

    expect(response.code).toBe('VALIDATION.FAILED');
    expect(response.details.some((detail) => detail.field === 'name')).toBe(
      true,
    );
  });

  it('rejects a numeric field key', async () => {
    const response = await expectValidationFailure({
      ...validPayload,
      fields: [{ key: 123, label: 'SKU', type: 'string', required: true }],
    });

    expect(response.code).toBe('VALIDATION.FAILED');
  });

  it('rejects a numeric field label', async () => {
    const response = await expectValidationFailure({
      ...validPayload,
      fields: [{ key: 'sku', label: 42, type: 'string', required: true }],
    });

    expect(response.code).toBe('VALIDATION.FAILED');
  });
});
