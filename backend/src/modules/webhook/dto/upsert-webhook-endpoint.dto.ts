import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, IsUrl, MaxLength } from 'class-validator';
import { WEBHOOK_URL_MAX_LENGTH } from '../webhook.constants.js';

export class UpsertWebhookEndpointDto {
  @ApiProperty({
    example: 'https://hooks.example.com/openimport/import-ready',
    maxLength: WEBHOOK_URL_MAX_LENGTH,
    description:
      'HTTPS URL that will receive signed import.ready POST callbacks. Query strings are allowed but never logged.',
  })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(WEBHOOK_URL_MAX_LENGTH)
  @IsUrl({ require_protocol: true, require_tld: false })
  url!: string;
}
