import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, Max, Min, ValidateIf } from 'class-validator';

function keepJsonNumber(value: unknown): unknown {
  return value;
}

export const DEFAULT_IMPORT_ACCESS_TOKEN_TTL_SECONDS = 1800;
export const MIN_IMPORT_ACCESS_TOKEN_TTL_SECONDS = 60;
export const MAX_IMPORT_ACCESS_TOKEN_TTL_SECONDS = 3600;

export class CreateImportAccessTokenDto {
  @ApiPropertyOptional({
    example: DEFAULT_IMPORT_ACCESS_TOKEN_TTL_SECONDS,
    minimum: MIN_IMPORT_ACCESS_TOKEN_TTL_SECONDS,
    maximum: MAX_IMPORT_ACCESS_TOKEN_TTL_SECONDS,
    default: DEFAULT_IMPORT_ACCESS_TOKEN_TTL_SECONDS,
    description:
      'Lifetime of the issued token in seconds. Defaults to 1800. Must be a JSON integer between 60 and 3600.',
  })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(({ value }) => keepJsonNumber(value))
  @IsInt()
  @Min(MIN_IMPORT_ACCESS_TOKEN_TTL_SECONDS)
  @Max(MAX_IMPORT_ACCESS_TOKEN_TTL_SECONDS)
  expiresInSeconds?: number;
}
