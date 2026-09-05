import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { isOpenImportApiError, OpenImportApiError } from '../../api/errors.ts'
import type { ImportContext } from '../../api/import-context.schema.ts'
import type { ImportPreview } from '../../api/operation-schemas.ts'
import { postImportConfirm } from '../../api/post-import-confirm.ts'
import { importContextQueryKey } from '../../api/query-key.ts'
import { readSessionCredential } from '../../embed/session-credential.ts'
import { applyConfirmToContext } from './apply-confirm-to-context.ts'
import { copyForApiError } from './copy.ts'
import { isPreviewFresh } from './processing-progress.ts'

type ConfirmPanelProps = {
  context: ImportContext
  apiBaseUrl: string
  generation: number
  mappingDirty: boolean
  preview: ImportPreview | null
  confirming: boolean
  onConfirmingChange: (value: boolean) => void
}

export function ConfirmPanel({
  context,
  apiBaseUrl,
  generation,
  mappingDirty,
  preview,
  confirming,
  onConfirmingChange,
}: ConfirmPanelProps) {
  const queryClient = useQueryClient()
  const submitLock = useRef(false)
  const confirmAccepted = useRef(false)
  const [errorCopy, setErrorCopy] = useState<ReturnType<
    typeof copyForApiError
  > | null>(null)

  const contextQueryKey = [
    ...importContextQueryKey(context.import.id),
    generation,
  ] as const

  const previewFresh =
    preview !== null &&
    isPreviewFresh({
      previewMappingRevision: preview.mappingRevision,
      previewContentSha256: preview.contentSha256,
      mappingRevision: context.mapping.revision,
      contentSha256: context.import.contentSha256,
    })

  const canConfirm =
    context.import.status === 'uploaded' &&
    context.mapping.isComplete &&
    !mappingDirty &&
    previewFresh &&
    Boolean(context.import.contentSha256) &&
    !confirming

  const mutation = useMutation({
    mutationFn: async () => {
      const accessToken = readSessionCredential(context.import.id)
      if (!accessToken) {
        throw new OpenImportApiError({
          status: 401,
          code: 'AUTH.INVALID_IMPORT_TOKEN',
          message: 'Token ausente.',
        })
      }
      if (!context.import.contentSha256) {
        throw new OpenImportApiError({
          status: 409,
          code: 'IMPORT.CONFIRMATION_NOT_ALLOWED',
          message: 'Arquivo indisponível para confirmação.',
        })
      }

      return postImportConfirm({
        apiBaseUrl,
        importId: context.import.id,
        accessToken,
        expectedMappingRevision: context.mapping.revision,
        expectedContentSha256: context.import.contentSha256,
      })
    },
    retry: false,
    onMutate: () => {
      submitLock.current = true
      onConfirmingChange(true)
      setErrorCopy(null)
    },
    onSuccess: (response) => {
      confirmAccepted.current = true
      setErrorCopy(null)
      queryClient.setQueryData<ImportContext>(contextQueryKey, (current) => {
        if (!current) {
          return current
        }
        return applyConfirmToContext(current, response)
      })
      void queryClient.invalidateQueries({ queryKey: [...contextQueryKey] })
    },
    onError: async (error) => {
      if (isOpenImportApiError(error)) {
        setErrorCopy(copyForApiError(error))
        if (
          error.code === 'IMPORT.MAPPING_INCOMPLETE' ||
          error.code === 'IMPORT.MAPPING_REVISION_CONFLICT' ||
          error.code === 'IMPORT.FILE_CHANGED' ||
          error.code === 'IMPORT.CONFIRMATION_NOT_ALLOWED'
        ) {
          await queryClient.invalidateQueries({
            queryKey: [...contextQueryKey],
          })
        }
      }
    },
    onSettled: () => {
      submitLock.current = false
      onConfirmingChange(false)
    },
  })

  function submitConfirm() {
    if (
      confirmAccepted.current ||
      submitLock.current ||
      !canConfirm ||
      mutation.isPending
    ) {
      return
    }
    mutation.mutate()
  }

  const blockReason = !context.mapping.isComplete
    ? 'Complete o mapping antes de confirmar.'
    : mappingDirty
      ? 'Há alterações locais no mapping. Salve e gere um novo preview antes de confirmar.'
      : !preview
        ? 'Gere um preview do mapping atual antes de confirmar.'
        : preview && !previewFresh
          ? 'O preview está desatualizado em relação ao mapping ou ao arquivo. Gere o preview novamente.'
          : confirming || mutation.isPending
            ? 'Confirmação em andamento.'
            : null

  if (context.import.status !== 'uploaded') {
    return null
  }

  return (
    <section
      className="oi-workbench"
      aria-labelledby="oi-confirm-title"
      data-testid="confirm-panel"
    >
      <div className="oi-workbench-head">
        <h2 id="oi-confirm-title">Confirmar importação</h2>
        <p className="oi-workbench-lead">
          O mapping e o arquivo serão congelados. O processamento é assíncrono e
          não grava diretamente no banco do sistema cliente — apenas prepara o
          snapshot no OpenImport.
        </p>
      </div>

      {blockReason ? (
        <p className="oi-note" role="status" id="oi-confirm-block">
          {blockReason}
        </p>
      ) : null}

      {errorCopy ? (
        <div className="oi-inline-error" role="alert">
          <p>
            <strong>{errorCopy.title}.</strong> {errorCopy.body}
          </p>
          <p className="oi-support">
            {[errorCopy.code, errorCopy.traceId].filter(Boolean).join(' · ')}
          </p>
        </div>
      ) : null}

      <div className="oi-inline-actions oi-action-bar">
        <button
          type="button"
          className="oi-primary"
          disabled={!canConfirm || mutation.isPending}
          aria-describedby={blockReason ? 'oi-confirm-block' : undefined}
          onClick={submitConfirm}
        >
          {mutation.isPending || confirming
            ? 'Confirmando…'
            : 'Confirmar importação'}
        </button>
        {errorCopy?.retry ? (
          <button
            type="button"
            className="oi-secondary"
            disabled={mutation.isPending}
            onClick={submitConfirm}
          >
            Tentar novamente
          </button>
        ) : null}
      </div>
    </section>
  )
}
