import { Inject, Injectable } from '@nestjs/common';
import {
  OBJECT_STORAGE,
  type ObjectStorage,
} from '../../integrations/object-storage/object-storage.port.js';
import type { ReadinessProbe } from './readiness.types.js';

@Injectable()
export class ObjectStorageReadinessProbe implements ReadinessProbe {
  readonly dependency = 'object_storage' as const;

  constructor(
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  async check(signal: AbortSignal): Promise<void> {
    await this.storage.checkReady({ signal });
  }
}
