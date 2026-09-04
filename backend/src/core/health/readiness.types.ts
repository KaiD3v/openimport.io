export type ReadinessDependency = 'postgres' | 'redis' | 'object_storage';

export interface ReadinessProbe {
  readonly dependency: ReadinessDependency;
  check(signal: AbortSignal): Promise<void>;
}

export type ReadinessCheckResult = {
  ready: boolean;
  failed: ReadinessDependency[];
};
