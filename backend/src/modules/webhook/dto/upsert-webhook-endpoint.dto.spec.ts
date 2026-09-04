import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { createValidationPipe } from '../../../common/validation/create-validation-pipe.js';
import { UpsertWebhookEndpointDto } from './upsert-webhook-endpoint.dto.js';

const bodyMetadata = {
  type: 'body' as const,
  metatype: UpsertWebhookEndpointDto,
  data: '',
};

async function transformBody(payload: unknown): Promise<UpsertWebhookEndpointDto> {
  return createValidationPipe().transform(payload, bodyMetadata);
}

describe('UpsertWebhookEndpointDto', () => {
  it('accepts an https URL', async () => {
    const dto = await transformBody({
      url: 'https://hooks.example.com/import-ready',
    });
    expect(dto.url).toBe('https://hooks.example.com/import-ready');
  });

  it('rejects unknown properties and non-URL values', async () => {
    for (const payload of [
      {},
      { url: 'not-a-url' },
      { url: 'https://hooks.example.com/x', extra: true },
      { url: 1 },
    ]) {
      try {
        await transformBody(payload);
        throw new Error('expected validation to fail');
      } catch (error) {
        if (error instanceof Error && error.message === 'expected validation to fail') {
          throw error;
        }
        expect(error).toBeInstanceOf(BadRequestException);
      }
    }
  });
});
