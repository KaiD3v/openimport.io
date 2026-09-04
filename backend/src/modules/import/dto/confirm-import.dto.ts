import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsInt, Matches, Max, Min } from 'class-validator';

function keepJsonNumber(value: unknown): unknown {
  return value;
}

export class ConfirmImportDto {
  @ApiProperty({
    example: 1,
    minimum: 0,
    maximum: Number.MAX_SAFE_INTEGER,
    description:
      'Mapping revision captured before confirm. Mismatches return 409 IMPORT.MAPPING_REVISION_CONFLICT.',
  })
  @Transform(({ value }) => keepJsonNumber(value))
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  expectedMappingRevision!: number;

  @ApiProperty({
    example: 'a'.repeat(64),
    description:
      'Lowercase hex SHA-256 of the uploaded object. Mismatches return 409 IMPORT.FILE_CHANGED.',
  })
  @Matches(/^[a-f0-9]{64}$/)
  expectedContentSha256!: string;
}
