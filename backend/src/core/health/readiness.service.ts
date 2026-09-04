import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Env } from '../config/env.js';
import { ENV } from '../config/env.token.js';
import { runWithTimeout } from './readiness-timeout.js';
import type {
  ReadinessCheckResult,
  ReadinessDependency,
  ReadinessProbe,
} from './readiness.types.js';

export const READINESS_PROBES = Symbol('READINESS_PROBES');

@Injectable()
export class ReadinessService {
  private readonly logger = new Logger(ReadinessService.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(READINESS_PROBES) private readonly probes: ReadinessProbe[],
  ) {}

  async check(): Promise<ReadinessCheckResult> {
    const results = await Promise.all(
      this.probes.map(async (probe) => ({
        dependency: probe.dependency,
        ok: await this.runProbe(probe),
      })),
    );

    const failed = results
      .filter((result) => !result.ok)
      .map((result) => result.dependency);

    if (failed.length > 0) {
      this.logger.warn(
        { failedDependencies: failed },
        'Readiness probe failed',
      );
    }

    return { ready: failed.length === 0, failed };
  }

  private async runProbe(probe: ReadinessProbe): Promise<boolean> {
    try {
      await runWithTimeout(
        (signal) => probe.check(signal),
        this.env.HEALTH_PROBE_TIMEOUT_MS,
      );
      return true;
    } catch {
      return false;
    }
  }
}

export function failedDependenciesMessage(
  failed: ReadinessDependency[],
): string {
  void failed;
  return 'Application is not ready.';
}
