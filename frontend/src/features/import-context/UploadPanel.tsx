import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useId, useRef, useState } from 'react'
import { isOpenImportApiError, OpenImportApiError } from '../../api/errors.ts'
import type { ImportContext } from '../../api/import-context.schema.ts'
import { importContextQueryKey } from '../../api/query-key.ts'
import { assertSingleCsvFile, formatFileSize } from '../../api/upload-form.ts'
import { uploadImportFile } from '../../api/upload-import-file.ts'
import { readSessionCredential } from '../../embed/session-credential.ts'
import { copyForApiError } from './copy.ts'

type UploadPanelProps = {
  context: ImportContext
  apiBaseUrl: string
  generation: number
}

export function UploadPanel({
  context,
  apiBaseUrl,
  generation,
}: UploadPanelProps) {
  const inputId = useId()
  const abortRef = useRef<AbortController | null>(null)
  const [selected, setSelected] = useState<File | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const queryClient = useQueryClient()
  const canUpload = context.import.status === 'created'

  const mutation = useMutation({
    mutationFn: async (file: File) => {
      const accessToken = readSessionCredential(context.import.id)
      if (!accessToken) {
        throw new OpenImportApiError({
          status: 401,
          code: 'AUTH.INVALID_IMPORT_TOKEN',
          message: 'Token ausente.',
        })
      }

      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      return uploadImportFile({
        apiBaseUrl,
        importId: context.import.id,
        accessToken,
        file,
        signal: controller.signal,
      })
    },
    retry: false,
    onSuccess: async () => {
      setSelected(null)
      setLocalError(null)
      await queryClient.invalidateQueries({
        queryKey: [...importContextQueryKey(context.import.id), generation],
      })
    },
    onError: async (error) => {
      await queryClient.invalidateQueries({
        queryKey: [...importContextQueryKey(context.import.id), generation],
      })
      if (isOpenImportApiError(error)) {
        setLocalError(copyForApiError(error).body)
      }
    },
  })

  if (!canUpload) {
    return null
  }
  function chooseFiles(files: FileList | File[] | null) {
    try {
      const file = assertSingleCsvFile(files)
      setSelected(file)
      setLocalError(null)
    } catch (error) {
      setSelected(null)
      setLocalError(
        isOpenImportApiError(error)
          ? error.message
          : 'Não foi possível selecionar o arquivo.',
      )
    }
  }

  const mutationCopy =
    mutation.error && isOpenImportApiError(mutation.error)
      ? copyForApiError(mutation.error)
      : null

  return (
    <section
      className="oi-workbench oi-workbench-primary"
      aria-labelledby="oi-upload-title"
    >
      <div className="oi-workbench-head">
        <h2 id="oi-upload-title">Enviar CSV</h2>
        <p className="oi-workbench-lead">
          Selecione um único arquivo. O envio só começa quando você confirmar.
        </p>
      </div>

      <div
        className={dragging ? 'oi-dropzone oi-dropzone-active' : 'oi-dropzone'}
        onDragEnter={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          chooseFiles(event.dataTransfer.files)
        }}
      >
        <label htmlFor={inputId} className="oi-file-label">
          Escolher arquivo CSV
        </label>
        <input
          id={inputId}
          className="oi-sr-only"
          type="file"
          accept=".csv,text/csv,text/plain,application/octet-stream"
          disabled={mutation.isPending}
          onChange={(event) => {
            chooseFiles(event.target.files)
            event.target.value = ''
          }}
        />
        <p className="oi-dropzone-hint">ou arraste o arquivo para esta área</p>
      </div>

      {selected ? (
        <div className="oi-file-card">
          <p className="oi-file-card-label">Arquivo selecionado</p>
          <p>
            <strong className="oi-file-name">{selected.name}</strong>
          </p>
          <p className="oi-file-size">{formatFileSize(selected.size)}</p>
          <div className="oi-inline-actions">
            <button
              type="button"
              className="oi-secondary"
              disabled={mutation.isPending}
              onClick={() => {
                setSelected(null)
                setLocalError(null)
              }}
            >
              Remover seleção
            </button>
            <button
              type="button"
              className="oi-primary"
              disabled={mutation.isPending}
              onClick={() => mutation.mutate(selected)}
            >
              Enviar arquivo
            </button>
          </div>
        </div>
      ) : null}

      {mutation.isPending ? (
        <p className="oi-pending-row" role="status" aria-label="Enviando arquivo">
          Enviando arquivo…
          <button
            type="button"
            className="oi-secondary"
            onClick={() => abortRef.current?.abort()}
          >
            Cancelar envio
          </button>
        </p>
      ) : null}

      {localError || mutationCopy ? (
        <div className="oi-inline-error" role="alert">
          <p>{localError ?? mutationCopy?.body}</p>
          {mutationCopy?.code || mutationCopy?.traceId ? (
            <p className="oi-support">
              {[mutationCopy.code, mutationCopy.traceId]
                .filter(Boolean)
                .join(' · ')}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
