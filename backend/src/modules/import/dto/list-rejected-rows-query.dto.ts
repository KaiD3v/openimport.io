import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

function keepJsonNumber(value: unknown): unknown {
  return value;
}

export class ListRejectedRowsQueryDto {
  @ApiPropertyOptional({
    example: 50,
    minimum: 1,
    maximum: 200,
    default: 50,
    description: 'Page size. Capped by IMPORT_REJECTED_ROWS_MAX_LIMIT.',
  })
  @IsOptional()
  @Type(() => Number)
  @Transform(({ value }) => keepJsonNumber(value))
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({
    description: 'Opaque cursor from a previous page (`nextCursor`).',
  })
  @IsOptional()
  @IsString()
  after?: string;
}
