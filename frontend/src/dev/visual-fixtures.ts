import type { ImportContext } from '../api/import-context.schema.ts'
import type { ImportPreview } from '../api/operation-schemas.ts'
import {
  IMPORT_ID,
  createdContext,
  uploadedContext,
  uploadFailedContext,
} from '../test/fixtures.ts'

export type VisualFixtureId =
  | 'waiting'
  | 'loading'
  | 'created'
  | 'upload-selected'
  | 'upload-pending'
  | 'upload-recoverable-error'
  | 'upload-failed'
  | 'uploaded-incomplete'
  | 'uploaded-complete'
  | 'mapping-dirty'
  | 'mapping-conflict'
  | 'preview-loading'
  | 'preview-valid'
  | 'preview-invalid'
  | 'preview-truncated'
  | 'preview-unavailable'
  | 'token-expired'
  | 'long-labels'

type ShellFixture = {
  id: VisualFixtureId
  label: string
  kind: 'shell'
  variant: 'status' | 'error'
  title: string
  body: string
  code?: string
  importId?: string
}

type LoadedFixture = {
  id: VisualFixtureId
  label: string
  kind: 'loaded'
  context: ImportContext
  presentation?: {
    uploadSelected?: { name: string; sizeLabel: string }
    uploadPending?: boolean
    uploadError?: string
    mappingDirtyNote?: boolean
    mappingConflict?: string
    previewLoading?: boolean
    previewUnavailable?: boolean
    preview?: ImportPreview
  }
}

export type VisualFixture = ShellFixture | LoadedFixture

const longTemplateId = '33333333-3333-4333-8333-333333333333'

const incompleteUploaded: ImportContext = {
  ...uploadedContext,
  mapping: {
    ...uploadedContext.mapping,
    revision: 1,
    isComplete: false,
    missingRequiredFields: ['priceInCents'],
    mappings: [{ columnPosition: 0, fieldKey: 'sku' }],
  },
}

const validPreview: ImportPreview = {
  importId: IMPORT_ID,
  mappingRevision: 1,
  contentSha256: 'b'.repeat(64),
  normalizationProfile: 'pt-BR-v1',
  summary: { totalRows: 2, validRows: 2, invalidRows: 0 },
  limit: 20,
  sampleTruncated: false,
  rows: [
    {
      recordNumber: 1,
      valid: true,
      data: { sku: 'ABC-1', priceInCents: 29990 },
      errors: [],
    },
    {
      recordNumber: 2,
      valid: true,
      data: { sku: 'ABC-2', priceInCents: 1590 },
      errors: [],
    },
  ],
}

const invalidPreview: ImportPreview = {
  ...validPreview,
  summary: { totalRows: 2, validRows: 1, invalidRows: 1 },
  rows: [
    validPreview.rows[0]!,
    {
      recordNumber: 2,
      valid: false,
      data: null,
      errors: [
        {
          fieldKey: 'priceInCents',
          code: 'FIELD.INVALID_CURRENCY',
          message: 'Value must be a currency amount in pt-BR format.',
        },
      ],
    },
  ],
}

const truncatedPreview: ImportPreview = {
  ...invalidPreview,
  summary: { totalRows: 240, validRows: 200, invalidRows: 40 },
  sampleTruncated: true,
}

export const VISUAL_FIXTURES: VisualFixture[] = [
  {
    id: 'waiting',
    label: 'aguardando inicialização',
    kind: 'shell',
    variant: 'status',
    title: 'Aguardando o sistema de origem',
    body: 'A importação ainda não foi inicializada. O token temporário deve chegar por postMessage, nunca pela URL.',
    importId: IMPORT_ID,
  },
  {
    id: 'loading',
    label: 'carregando contexto',
    kind: 'shell',
    variant: 'status',
    title: 'Carregando o contexto da importação',
    body: 'Consultando a sessão, o template e o mapping.',
    importId: IMPORT_ID,
  },
  {
    id: 'created',
    label: 'created — pronta para upload',
    kind: 'loaded',
    context: createdContext,
  },
  {
    id: 'upload-selected',
    label: 'upload com arquivo selecionado',
    kind: 'loaded',
    context: createdContext,
    presentation: {
      uploadSelected: {
        name: 'planilha-oficial-de-produtos-calcados-inverno-2026-revisao-final.csv',
        sizeLabel: '12 KB',
      },
    },
  },
  {
    id: 'upload-pending',
    label: 'upload em andamento',
    kind: 'loaded',
    context: createdContext,
    presentation: {
      uploadSelected: {
        name: 'produtos.csv',
        sizeLabel: '4 KB',
      },
      uploadPending: true,
    },
  },
  {
    id: 'upload-recoverable-error',
    label: 'erro recuperável de upload',
    kind: 'loaded',
    context: createdContext,
    presentation: {
      uploadSelected: {
        name: 'produtos-grandes.csv',
        sizeLabel: '12 MB',
      },
      uploadError:
        'O arquivo excede o limite permitido. Reduza o tamanho e tente novamente nesta sessão, se ela ainda estiver aberta.',
    },
  },
  {
    id: 'upload-failed',
    label: 'upload_failed — sessão terminal',
    kind: 'loaded',
    context: uploadFailedContext,
  },
  {
    id: 'uploaded-incomplete',
    label: 'mapping incompleto',
    kind: 'loaded',
    context: incompleteUploaded,
  },
  {
    id: 'uploaded-complete',
    label: 'mapping completo',
    kind: 'loaded',
    context: uploadedContext,
  },
  {
    id: 'mapping-dirty',
    label: 'mapping com alterações locais',
    kind: 'loaded',
    context: incompleteUploaded,
    presentation: {
      mappingDirtyNote: true,
    },
  },
  {
    id: 'mapping-conflict',
    label: 'conflito de revisão',
    kind: 'loaded',
    context: incompleteUploaded,
    presentation: {
      mappingConflict:
        'Outra alteração do mapping foi salva. Recarregamos a versão atual; revise e salve novamente se necessário.',
    },
  },
  {
    id: 'preview-loading',
    label: 'preview carregando',
    kind: 'loaded',
    context: uploadedContext,
    presentation: {
      previewLoading: true,
    },
  },
  {
    id: 'preview-valid',
    label: 'preview com válidos',
    kind: 'loaded',
    context: uploadedContext,
    presentation: {
      preview: validPreview,
    },
  },
  {
    id: 'preview-invalid',
    label: 'preview com inválidos',
    kind: 'loaded',
    context: uploadedContext,
    presentation: {
      preview: invalidPreview,
    },
  },
  {
    id: 'preview-truncated',
    label: 'preview truncado',
    kind: 'loaded',
    context: uploadedContext,
    presentation: {
      preview: truncatedPreview,
    },
  },
  {
    id: 'preview-unavailable',
    label: 'preview indisponível',
    kind: 'loaded',
    context: uploadedContext,
    presentation: {
      previewUnavailable: true,
    },
  },
  {
    id: 'token-expired',
    label: 'token expirado',
    kind: 'shell',
    variant: 'error',
    title: 'Sessão expirada',
    body: 'A sessão expirou e precisa ser reaberta pelo sistema de origem.',
    code: 'AUTH.INVALID_IMPORT_TOKEN',
    importId: IMPORT_ID,
  },
  {
    id: 'long-labels',
    label: 'labels longas',
    kind: 'loaded',
    context: {
      import: {
        ...uploadedContext.import,
        id: IMPORT_ID,
        templateId: longTemplateId,
        originalFilename:
          'planilha-oficial-de-produtos-calcados-inverno-2026-revisao-final-com-variacoes.csv',
        columns: [
          {
            name: 'codigo_sku_fornecedor_principal_com_descricao_extensa',
            position: 0,
          },
          {
            name: 'quantidade_em_estoque_disponivel_para_venda_imediata',
            position: 1,
          },
          {
            name: 'preco_unitario_em_reais_com_impostos_inclusos_pt_BR',
            position: 2,
          },
        ],
      },
      template: {
        ...uploadedContext.template,
        id: longTemplateId,
        name: 'Catálogo oficial de calçados esportivos e casuais — temporada inverno',
        fields: [
          {
            key: 'sku',
            label: 'SKU do fornecedor principal com identificação longa',
            type: 'string',
            required: true,
            position: 0,
          },
          {
            key: 'stock',
            label: 'Estoque disponível para venda imediata',
            type: 'integer',
            required: false,
            position: 1,
          },
          {
            key: 'priceInCents',
            label: 'Preço unitário em centavos após normalização pt-BR',
            type: 'currency',
            required: true,
            position: 2,
          },
        ],
      },
      mapping: {
        importId: IMPORT_ID,
        revision: 2,
        isComplete: false,
        missingRequiredFields: ['priceInCents'],
        mappings: [{ columnPosition: 0, fieldKey: 'sku' }],
      },
    },
  },
]
