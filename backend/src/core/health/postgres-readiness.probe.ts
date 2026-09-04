import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import type { ReadinessProbe } from './readiness.types.js';

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error('aborted');
  }
}

@Injectable()
export class PostgresReadinessProbe implements ReadinessProbe {
  readonly dependency = 'postgres' as const;

  constructor(private readonly prisma: PrismaService) {}

  async check(signal: AbortSignal): Promise<void> {
    throwIfAborted(signal);

    // Prisma $queryRaw has no AbortSignal support; the in-flight query may
    // complete after timeout, but runWithTimeout keeps the promise observed.
    const ready = await this.prisma.isReady();

    throwIfAborted(signal);
    if (!ready) {
      throw new Error('postgres unavailable');
    }
  }
}
