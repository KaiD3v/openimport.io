import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ENV } from '../../../core/config/env.token.js';
import type { Env } from '../../../core/config/env.js';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from '../../../integrations/object-storage/object-storage.port.js';
import { ImportRepository } from '../import.repository.js';

/** Soft cap so one cycle can walk past a full batch of healthy rows. */
const MAX_PAGES_PER_CYCLE = 5;

/**
 * Deletes CSV objects for terminal sessions after the configured retention TTL.
 * Claim/lease in PostgreSQL coordinates multi-instance cleaners; S3 calls stay
 * outside DB transactions.
 */
@Injectable()
export class ImportFileRetentionCleaner
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ImportFileRetentionCleaner.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private cursor: { finishedAt: Date; id: string } | null = null;

  constructor(
    private readonly imports: ImportRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onModuleInit(): void {
    if (this.env.NODE_ENV === 'test') {
      return;
    }
    this.timer = setInterval(() => {
      void this.safeCleanup();
    }, this.env.IMPORT_FILE_CLEANUP_INTERVAL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Test helper: reset scan cursor between scenarios. */
  resetCursor(): void {
    this.cursor = null;
  }

  private async safeCleanup(): Promise<void> {
    try {
      await this.cleanupOnce();
    } catch (error) {
      this.logger.error({
        msg: 'import.file_retention.cleanup_failed',
        errorName: error instanceof Error ? error.name : 'unknown',
      });
    }
  }

  async cleanupOnce(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const batchSize = this.env.IMPORT_FILE_CLEANUP_BATCH_SIZE;

      for (let page = 0; page < MAX_PAGES_PER_CYCLE; page += 1) {
        const candidates = await this.imports.listFileRetentionCandidates({
          limit: batchSize,
          retentionHours: this.env.IMPORT_FILE_RETENTION_HOURS,
          claimTtlMs: this.env.IMPORT_FILE_CLEANUP_CLAIM_MS,
          after: this.cursor,
        });

        if (candidates.length === 0) {
          this.cursor = null;
          break;
        }

        for (const row of candidates) {
          await this.cleanupCandidate(row);
        }

        const last = candidates[candidates.length - 1]!;
        this.cursor = { finishedAt: last.finishedAt, id: last.id };

        if (candidates.length < batchSize) {
          this.cursor = null;
          break;
        }
      }
    } finally {
      this.running = false;
    }
  }

  private async cleanupCandidate(row: {
    id: string;
    organizationId: string;
    status: string;
    storageObjectKey: string;
  }): Promise<void> {
    const claimToken = randomUUID();

    try {
      const claim = await this.imports.claimFileRetentionCandidate(
        row.id,
        claimToken,
        new Date(),
        this.env.IMPORT_FILE_CLEANUP_CLAIM_MS,
      );

      if (!claim.claimed || !claim.storageObjectKey) {
        this.logger.warn({
          msg: 'import.file_retention.claim_lost',
          importId: row.id,
          organizationId: row.organizationId,
          status: row.status,
        });
        return;
      }

      try {
        await this.storage.deleteObject(claim.storageObjectKey);
      } catch {
        await this.imports.releaseFileRetentionClaim(row.id, claimToken);
        this.logger.error({
          msg: 'import.file_retention.delete_failed',
          importId: row.id,
          organizationId: row.organizationId,
          status: row.status,
        });
        return;
      }

      const completed = await this.imports.completeFileRetentionCleanup(row.id, {
        expectedKey: claim.storageObjectKey,
        claimToken,
        deletedAt: new Date(),
      });

      if (!completed) {
        this.logger.warn({
          msg: 'import.file_retention.complete_cas_miss',
          importId: row.id,
          organizationId: row.organizationId,
          status: row.status,
        });
        return;
      }

      this.logger.log({
        msg: 'import.file_retention.completed',
        importId: row.id,
        organizationId: row.organizationId,
        status: row.status,
      });
    } catch (error) {
      this.logger.error({
        msg: 'import.file_retention.candidate_failed',
        importId: row.id,
        organizationId: row.organizationId,
        status: row.status,
        errorName: error instanceof Error ? error.name : 'unknown',
      });
    }
  }
}
