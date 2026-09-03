import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class CreateImportSessionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  templateId!: string;
}
