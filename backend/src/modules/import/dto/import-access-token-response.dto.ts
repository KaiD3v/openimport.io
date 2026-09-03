import { ApiProperty } from '@nestjs/swagger';

export class ImportAccessTokenResponseDto {
  @ApiProperty({ example: 'oi_import_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })
  accessToken!: string;

  @ApiProperty({ example: 'Bearer', enum: ['Bearer'] })
  tokenType!: 'Bearer';

  @ApiProperty({ format: 'uuid' })
  importId!: string;

  @ApiProperty({ example: '2026-09-03T12:30:00.000Z' })
  expiresAt!: string;
}
