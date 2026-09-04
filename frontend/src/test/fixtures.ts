export const IMPORT_ID = '11111111-1111-4111-8111-111111111111'
export const OTHER_IMPORT_ID = '22222222-2222-4222-8222-222222222222'
export const EXECUTION_ID = '44444444-4444-4444-8444-444444444444'
export const IMPORT_TOKEN = `oi_import_${'ab'.repeat(32)}`
export const LIVE_API_KEY = `oi_live_${'cd'.repeat(32)}`
export const ALLOWED_ORIGIN = 'http://localhost:5173'
export const API_BASE_URL = 'http://localhost:3000/api/v1'

const baseImportFields = {
  progress: null as null,
  executionId: null as null,
  failure: null as null,
  confirmedAt: null as null,
}

export const createdContext = {
  import: {
    id: IMPORT_ID,
    templateId: '33333333-3333-4333-8333-333333333333',
    status: 'created' as const,
    originalFilename: null,
    byteSize: null,
    contentSha256: null,
    encoding: null,
    delimiter: null,
    dataRowCount: null,
    columns: [] as Array<{ name: string; position: number }>,
    ...baseImportFields,
    uploadedAt: null,
    createdAt: '2026-09-03T12:00:00.000Z',
    updatedAt: '2026-09-03T12:00:00.000Z',
  },
  template: {
    id: '33333333-3333-4333-8333-333333333333',
    name: 'Produtos',
    fields: [
      {
        key: 'sku',
        label: 'SKU',
        type: 'string' as const,
        required: true,
        position: 0,
      },
      {
        key: 'stock',
        label: 'Estoque',
        type: 'integer' as const,
        required: false,
        position: 1,
      },
      {
        key: 'priceInCents',
        label: 'Preço',
        type: 'currency' as const,
        required: true,
        position: 2,
      },
    ],
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z',
  },
  mapping: {
    importId: IMPORT_ID,
    revision: 0,
    mappings: [] as Array<{ columnPosition: number; fieldKey: string }>,
    isComplete: false,
    missingRequiredFields: ['sku', 'priceInCents'],
  },
}

export const uploadedContext = {
  ...createdContext,
  import: {
    ...createdContext.import,
    status: 'uploaded' as const,
    originalFilename: 'produtos-calcados.csv',
    byteSize: 2048,
    contentSha256: 'a'.repeat(64),
    encoding: 'utf-8',
    delimiter: ';',
    dataRowCount: 128,
    columns: [
      { name: 'SKU', position: 0 },
      { name: 'Estoque', position: 1 },
      { name: 'Preço', position: 2 },
    ],
    uploadedAt: '2026-09-03T12:05:00.000Z',
    updatedAt: '2026-09-03T12:05:00.000Z',
  },
  mapping: {
    importId: IMPORT_ID,
    revision: 1,
    mappings: [
      { columnPosition: 0, fieldKey: 'sku' },
      { columnPosition: 2, fieldKey: 'priceInCents' },
    ],
    isComplete: true,
    missingRequiredFields: [] as string[],
  },
}

export const uploadFailedContext = {
  ...createdContext,
  import: {
    ...createdContext.import,
    status: 'upload_failed' as const,
    originalFilename: 'produtos-calcados.csv',
    byteSize: 4096,
    contentSha256: null,
    encoding: null,
    delimiter: null,
    dataRowCount: null,
    columns: [] as Array<{ name: string; position: number }>,
    uploadedAt: null,
    updatedAt: '2026-09-03T12:06:00.000Z',
  },
}

export const queuedContext = {
  ...uploadedContext,
  import: {
    ...uploadedContext.import,
    status: 'queued' as const,
    progress: {
      processedRows: 0,
      totalRows: 128,
      validRows: 0,
      invalidRows: 0,
    },
    executionId: EXECUTION_ID,
    failure: null,
    confirmedAt: '2026-09-03T12:10:00.000Z',
    updatedAt: '2026-09-03T12:10:00.000Z',
  },
}

export const processingContext = {
  ...queuedContext,
  import: {
    ...queuedContext.import,
    status: 'processing' as const,
    progress: {
      processedRows: 40,
      totalRows: 128,
      validRows: 36,
      invalidRows: 4,
    },
    updatedAt: '2026-09-03T12:11:00.000Z',
  },
}

export const processingIndeterminateContext = {
  ...processingContext,
  import: {
    ...processingContext.import,
    progress: {
      processedRows: 12,
      totalRows: null,
      validRows: 10,
      invalidRows: 2,
    },
  },
}

export const readyContext = {
  ...queuedContext,
  import: {
    ...queuedContext.import,
    status: 'ready' as const,
    progress: {
      processedRows: 128,
      totalRows: 128,
      validRows: 120,
      invalidRows: 8,
    },
    updatedAt: '2026-09-03T12:12:00.000Z',
  },
}

export const processingFailedContext = {
  ...queuedContext,
  import: {
    ...queuedContext.import,
    status: 'processing_failed' as const,
    progress: {
      processedRows: 12,
      totalRows: 128,
      validRows: 0,
      invalidRows: 0,
    },
    failure: {
      code: 'IMPORT.PROCESSING_FAILED',
      message: 'Import processing failed after exhausting retries.',
    },
    updatedAt: '2026-09-03T12:12:30.000Z',
  },
}

export function initializeMessage(overrides: Record<string, unknown> = {}) {
  return {
    type: 'openimport.initialize',
    version: 1,
    importId: IMPORT_ID,
    accessToken: IMPORT_TOKEN,
    ...overrides,
  }
}
