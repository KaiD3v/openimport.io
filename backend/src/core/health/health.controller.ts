import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator.js';
import { PrismaService } from '../database/prisma.service.js';
import { ApiErrorResponseDto } from '../../common/dto/api-error-response.dto.js';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiResponse({ status: 200, description: 'Process is running' })
  liveness(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe including database connectivity' })
  @ApiResponse({ status: 200, description: 'Application can serve traffic' })
  @ApiResponse({ status: 503, type: ApiErrorResponseDto })
  async readiness(): Promise<{ status: 'ok' }> {
    const ready = await this.prisma.isReady();
    if (!ready) {
      throw new ServiceUnavailableException({
        code: 'HEALTH.NOT_READY',
        message: 'Database is unavailable.',
      });
    }
    return { status: 'ok' };
  }
}
