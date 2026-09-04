import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { ENV } from '../../../core/config/env.token.js';
import type { Env } from '../../../core/config/env.js';
import type { ListValidRowsQueryDto } from '../dto/list-valid-rows-query.dto.js';
import type { ValidRowsResponseDto } from '../dto/valid-rows-response.dto.js';
import { ImportRepository } from '../import.repository.js';
import {
  decodeValidRowsCursor,
  encodeValidRowsCursor,
} from './valid-rows-cursor.js';

const DEFAULT_VALID_ROWS_LIMIT = 50;

function isNormalizedPayload(
  value: unknown,
): value is Record<string, string | number> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every(
    (entry) => typeof entry === 'string' || typeof entry === 'number',
  );
}

@Injectable()
export class ValidRowsService {
  constructor(
    private readonly imports: ImportRepository,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async list(
    organizationId: string,
    importId: string,
    query: ListValidRowsQueryDto,
  ): Promise<ValidRowsResponseDto> {
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
          'Valid rows are available only after processing completes successfully.',
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
          'Valid rows are available only after processing completes successfully.',
      });
    }

    let afterRecordNumber = 0;
    if (query.after) {
      let decoded;
      try {
        decoded = decodeValidRowsCursor(query.after);
      } catch {
        throw new BadRequestException({
          code: 'VALIDATION.FAILED',
          message: 'Request validation failed.',
          details: [
            {
              field: 'after',
              constraints: {
                isCursor: 'after must be a valid valid-rows cursor',
              },
            },
          ],
        });
      }
      if (decoded.executionId !== execution.id) {
        throw new BadRequestException({
          code: 'VALIDATION.FAILED',
          message: 'Request validation failed.',
          details: [
            {
              field: 'after',
              constraints: {
                isCursor: 'after must be a valid valid-rows cursor',
              },
            },
          ],
        });
      }
      afterRecordNumber = decoded.recordNumber;
    }

    const maxLimit = this.env.IMPORT_VALID_ROWS_MAX_LIMIT;
    const limit = Math.min(
      query.limit ?? DEFAULT_VALID_ROWS_LIMIT,
      maxLimit,
    );

    const rows = await this.imports.listValidRows({
      organizationId,
      importSessionId: importId,
      executionId: execution.id,
      afterRecordNumber,
      limit: limit + 1,
    });

    const page = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    const last = page[page.length - 1];

    const data = page.map((row) => {
      if (!isNormalizedPayload(row.payload)) {
        throw new InternalServerErrorException({
          code: 'INTERNAL.UNEXPECTED',
          message: 'Something went wrong.',
        });
      }
      return {
        recordNumber: row.recordNumber,
        data: row.payload,
      };
    });

    return {
      importId,
      executionId: execution.id,
      data,
      nextCursor:
        hasMore && last
          ? encodeValidRowsCursor({
              executionId: execution.id,
              recordNumber: last.recordNumber,
            })
          : null,
    };
  }
}
