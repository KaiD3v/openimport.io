import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator.js';
import { ApiErrorResponseDto } from '../../common/dto/api-error-response.dto.js';
import { failedDependenciesMessage, ReadinessService } from './readiness.service.js';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly readinessService: ReadinessService) {}

  @Get()
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiResponse({ status: 200, description: 'Process is running' })
  liveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({
    summary:
      'Readiness probe for PostgreSQL, Redis, and object storage availability',
  })
  @ApiResponse({ status: 200, description: 'Application can serve traffic' })
  @ApiResponse({ status: 503, type: ApiErrorResponseDto })
  async readiness(): Promise<{ status: 'ok' }> {
    const result = await this.readinessService.check();
    if (!result.ready) {
      throw new ServiceUnavailableException({
        code: 'HEALTH.NOT_READY',
        message: failedDependenciesMessage(result.failed),
      });
    }
    return { status: 'ok' };
  }
}
