import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/database/prisma.service.js';
import type {
  CreateImportSessionData,
  ImportSessionRecord,
  MarkUploadedData,
} from './import.types.js';

const sessionInclude = {
  columns: {
    orderBy: { position: 'asc' as const },
    select: {
      id: true,
      name: true,
      position: true,
    },
  },
};

@Injectable()
export class ImportRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(
    organizationId: string,
    data: CreateImportSessionData,
  ): Promise<ImportSessionRecord> {
    return this.prisma.importSession.create({
      data: {
        organizationId,
        templateId: data.templateId,
        idempotencyKeyHash: data.idempotencyKeyHash,
        requestFingerprint: data.requestFingerprint,
        status: 'created',
      },
      include: sessionInclude,
    });
  }

  findByIdempotencyKeyHash(
    organizationId: string,
    idempotencyKeyHash: string,
  ): Promise<ImportSessionRecord | null> {
    return this.prisma.importSession.findFirst({
      where: { organizationId, idempotencyKeyHash },
      include: sessionInclude,
    });
  }

  findByIdForOrganization(
    organizationId: string,
    importId: string,
  ): Promise<ImportSessionRecord | null> {
    return this.prisma.importSession.findFirst({
      where: { id: importId, organizationId },
      include: sessionInclude,
    });
  }

  async markUploaded(
    organizationId: string,
    importId: string,
    data: MarkUploadedData,
  ): Promise<ImportSessionRecord> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.importSession.updateMany({
        where: {
          id: importId,
          organizationId,
          status: 'created',
        },
        data: {
          status: 'uploaded',
          originalFilename: data.originalFilename,
          byteSize: data.byteSize,
          contentSha256: data.contentSha256,
          encoding: data.encoding,
          delimiter: data.delimiter,
          dataRowCount: data.dataRowCount,
          storageObjectKey: data.storageObjectKey,
          uploadedAt: new Date(),
        },
      });

      if (updated.count !== 1) {
        throw new Error('IMPORT_STATUS_CONFLICT');
      }

      await tx.importColumn.createMany({
        data: data.columns.map((column) => ({
          importSessionId: importId,
          name: column.name,
          position: column.position,
        })),
      });

      const session = await tx.importSession.findFirst({
        where: { id: importId, organizationId },
        include: sessionInclude,
      });
      if (!session) {
        throw new Error('IMPORT_NOT_FOUND_AFTER_UPLOAD');
      }
      return session;
    });
  }

  async markUploadFailed(
    organizationId: string,
    importId: string,
  ): Promise<void> {
    await this.prisma.importSession.updateMany({
      where: {
        id: importId,
        organizationId,
        status: 'created',
      },
      data: {
        status: 'upload_failed',
      },
    });
  }
}
