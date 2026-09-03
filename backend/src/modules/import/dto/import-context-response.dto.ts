import { ApiProperty } from '@nestjs/swagger';
import { TemplateResponseDto } from '../../template/dto/template-response.dto.js';
import { ImportMappingResponseDto } from './import-mapping-response.dto.js';
import { ImportSessionResponseDto } from './import-session-response.dto.js';

export class ImportContextResponseDto {
  @ApiProperty({ type: ImportSessionResponseDto })
  import!: ImportSessionResponseDto;

  @ApiProperty({ type: TemplateResponseDto })
  template!: TemplateResponseDto;

  @ApiProperty({ type: ImportMappingResponseDto })
  mapping!: ImportMappingResponseDto;
}
