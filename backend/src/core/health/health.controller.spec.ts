import { describe, expect, it, vi } from 'vitest';
import { HealthController } from './health.controller.js';
import type { ReadinessService } from './readiness.service.js';

describe('HealthController', () => {
  it('does not consult dependencies on liveness', () => {
    const readiness = {
      check: vi.fn(),
    } as unknown as ReadinessService;
    const controller = new HealthController(readiness);

    expect(controller.liveness()).toEqual({ status: 'ok' });
    expect(readiness.check).not.toHaveBeenCalled();
  });
});
