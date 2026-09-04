import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IMPORT_READY_EVENT_TYPE } from '../webhook.constants.js';

export class WebhookEndpointResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'https://hooks.example.com/openimport/import-ready' })
  url!: string;

  @ApiProperty({ example: IMPORT_READY_EVENT_TYPE, enum: [IMPORT_READY_EVENT_TYPE] })
  eventType!: typeof IMPORT_READY_EVENT_TYPE;

  @ApiProperty({ example: true })
  isActive!: boolean;

  @ApiProperty({ example: 'oi_whsec_aaaaaaa' })
  secretPrefix!: string;

  @ApiPropertyOptional({
    example: 'oi_whsec_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    description: 'Full signing secret. Present only on create/rotate; never returned by GET.',
  })
  secret?: string;

  @ApiProperty({ example: '2026-09-04T12:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-09-04T12:00:00.000Z' })
  updatedAt!: string;
}
