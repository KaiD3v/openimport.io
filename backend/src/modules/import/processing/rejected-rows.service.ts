import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { ENV } from '../../../core/config/env.token.js';
import type { Env } from '../../../core/config/env.js';
import type { ListRejectedRowsQueryDto } from '../dto/list-rejected-rows-query.dto.js';
import type { RejectedRowsResponseDto } from '../dto/confirm-import-response.dto.js';
import { ImportRepository } from '../import.repository.js';
import {
  decodeRejectedRowsCursor,
  encodeRejectedRowsCursor,
} from './rejected-rows-cursor.js';

@Injectable()
export class RejectedRowsService {
  constructor(
    private readonly imports: ImportRepository,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async list(
    organizationId: string,
    importId: string,
    query: ListRejectedRowsQueryDto,
  ): Promise<RejectedRowsResponseDto> {
    const session = await this.imports.findByIdForOrganization(
      organizationId,
      importId,
    );
    if (!session) {
      throw new NotFoundException({
        code: 'IMPORT.NOT_FOUND',
        message: 'Import session not found.',
      });
    }

    if (session.status !== 'ready') {
      throw new ConflictException({
        code: 'IMPORT.SNAPSHOT_NOT_READY',
        message:
          'Rejected rows are available only after processing completes successfully.',
      });
    }

    const execution = await this.imports.findLatestExecution(
      organizationId,
      importId,
    );
    if (!execution || execution.status !== 'ready') {
      throw new ConflictException({
        code: 'IMPORT.SNAPSHOT_NOT_READY',
        message:
          'Rejected rows are available only after processing completes successfully.',
      });
    }

    let afterRecordNumber = 0;
    if (query.after) {
      try {
        afterRecordNumber = decodeRejectedRowsCursor(query.after);
      } catch {
        throw new BadRequestException({
          code: 'VALIDATION.FAILED',
          message: 'Request validation failed.',
          details: [
            {
              field: 'after',
              constraints: { isCursor: 'after must be a valid rejected-rows cursor' },
            },
          ],
        });
      }
    }

    const maxLimit = this.env.IMPORT_REJECTED_ROWS_MAX_LIMIT;
    const limit = Math.min(query.limit ?? maxLimit, maxLimit);

    const rows = await this.imports.listRejectedRows({
      organizationId,
      importSessionId: importId,
      executionId: execution.id,
      afterRecordNumber,
      limit: limit + 1,
    });

    const page = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    const last = page[page.length - 1];

    return {
      data: page.map((row) => ({
        recordNumber: row.recordNumber,
        errors: row.errors,
      })),
      nextCursor:
        hasMore && last
          ? encodeRejectedRowsCursor(last.recordNumber)
          : null,
    };
  }
}
