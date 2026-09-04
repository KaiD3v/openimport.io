import { z } from 'zod';

const envBool = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((value) => value === 'true' || value === '1');

const originList = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );

function isPostgresConnectionString(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'postgres:' || url.protocol === 'postgresql:';
  } catch {
    return false;
  }
}

function isRedisConnectionString(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'redis:' || url.protocol === 'rediss:';
  } catch {
    return false;
  }
}

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: z
      .string()
      .min(1)
      .refine(isPostgresConnectionString, {
        message: 'must be a PostgreSQL connection string',
      }),
    ALLOWED_ORIGINS: originList.pipe(z.array(z.string().url()).min(1)),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    ENABLE_DOCS: envBool,
    IMPORT_MAX_FILE_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(5_242_880),
    IMPORT_MAX_DATA_ROWS: z.coerce.number().int().positive().default(10_000),
    IMPORT_MAX_COLUMNS: z.coerce.number().int().positive().default(50),
    IMPORT_MAX_FIELD_BYTES: z.coerce.number().int().positive().default(65_536),
    S3_ENDPOINT: z.string().url(),
    S3_REGION: z.string().min(1).default('us-east-1'),
    S3_ACCESS_KEY_ID: z.string().min(1),
    S3_SECRET_ACCESS_KEY: z.string().min(1),
    S3_BUCKET: z.string().min(1),
    S3_FORCE_PATH_STYLE: z
      .enum(['true', 'false', '1', '0'])
      .default('true')
      .transform((value) => value === 'true' || value === '1'),
    REDIS_URL: z
      .string()
      .min(1)
      .refine(isRedisConnectionString, {
        message: 'must be a Redis connection string',
      }),
    IMPORT_WORKER_CONCURRENCY: z.coerce
      .number()
      .int()
      .positive()
      .max(32)
      .default(2),
    IMPORT_WORKER_MAX_ATTEMPTS: z.coerce
      .number()
      .int()
      .positive()
      .max(20)
      .default(5),
    IMPORT_WORKER_BACKOFF_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(2_000),
    IMPORT_PERSIST_BATCH_SIZE: z.coerce
      .number()
      .int()
      .positive()
      .max(1_000)
      .default(100),
    IMPORT_REJECTED_ROWS_MAX_LIMIT: z.coerce
      .number()
      .int()
      .positive()
      .max(200)
      .default(50),
    IMPORT_VALID_ROWS_MAX_LIMIT: z.coerce
      .number()
      .int()
      .positive()
      .max(100)
      .default(100),
    IMPORT_RESULT_BATCH_MAX_SIZE: z.coerce
      .number()
      .int()
      .positive()
      .max(100)
      .default(100),
    IMPORT_JOB_RECONCILE_INTERVAL_MS: z.coerce
      .number()
      .int()
      .positive()
      .max(3_600_000)
      .default(15_000),
    IMPORT_JOB_RECONCILE_BATCH_SIZE: z.coerce
      .number()
      .int()
      .positive()
      .max(200)
      .default(25),
    WEBHOOK_SECRET_ENCRYPTION_KEY: z
      .string()
      .regex(/^[0-9a-f]{64}$/, {
        message: 'must be 64 lowercase hexadecimal characters',
      }),
    WEBHOOK_WORKER_CONCURRENCY: z.coerce
      .number()
      .int()
      .positive()
      .max(32)
      .default(4),
    WEBHOOK_WORKER_MAX_ATTEMPTS: z.coerce
      .number()
      .int()
      .positive()
      .max(20)
      .default(5),
    WEBHOOK_WORKER_BACKOFF_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(2_000),
    WEBHOOK_DELIVERY_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .max(30_000)
      .default(5_000),
    WEBHOOK_JOB_RECONCILE_INTERVAL_MS: z.coerce
      .number()
      .int()
      .positive()
      .max(3_600_000)
      .default(15_000),
    WEBHOOK_JOB_RECONCILE_BATCH_SIZE: z.coerce
      .number()
      .int()
      .positive()
      .max(200)
      .default(25),
    WEBHOOK_SSRF_ALLOW_PRIVATE_TARGETS: envBool,
    HEALTH_PROBE_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .positive()
      .min(100)
      .max(10_000)
      .default(2_000),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production' && env.ALLOWED_ORIGINS.includes('*')) {
      ctx.addIssue({
        code: 'custom',
        path: ['ALLOWED_ORIGINS'],
        message: 'wildcard origin is not allowed in production',
      });
    }
    if (env.NODE_ENV === 'production' && env.WEBHOOK_SSRF_ALLOW_PRIVATE_TARGETS) {
      ctx.addIssue({
        code: 'custom',
        path: ['WEBHOOK_SSRF_ALLOW_PRIVATE_TARGETS'],
        message: 'private webhook targets are not allowed in production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

function formatFieldErrors(
  fieldErrors: Record<string, string[] | undefined>,
): string {
  return Object.entries(fieldErrors)
    .map(([field, messages]) => `${field}: ${(messages ?? []).join(', ')}`)
    .join('; ');
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    throw new Error(
      `Invalid environment configuration: ${formatFieldErrors(fieldErrors)}`,
    );
  }
  return Object.freeze(parsed.data);
}
