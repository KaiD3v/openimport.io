import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useReducer, useState } from 'react'
import { isOpenImportApiError, OpenImportApiError } from '../../api/errors.ts'
import { fetchImportContext } from '../../api/fetch-import-context.ts'
import type { ImportContext } from '../../api/import-context.schema.ts'
import { putImportMapping } from '../../api/put-import-mapping.ts'
import { importContextQueryKey } from '../../api/query-key.ts'
import { readSessionCredential } from '../../embed/session-credential.ts'
import { copyForApiError, fieldTypeLabel } from './copy.ts'
import {
  countAssociatedRequiredFields,
  createMappingDraft,
  draftFieldForColumn,
  fieldUsedByOtherColumn,
  mappingDraftReducer,
  serializeMappingDraft,
} from './mapping-draft.ts'

type MappingEditorProps = {
  context: ImportContext
  apiBaseUrl: string
  generation: number
  onDraftChange: (dirty: boolean) => void
  onSaved: () => void
}

export function MappingEditor({
  context,
  apiBaseUrl,
  generation,
  onDraftChange,
  onSaved,
}: MappingEditorProps) {
  const [draft, dispatch] = useReducer(
    mappingDraftReducer,
    context.mapping,
    createMappingDraft,
  )
  const [saveError, setSaveError] = useState<string | null>(null)
  const queryClient = useQueryClient()

  useEffect(() => {
    dispatch({ type: 'hydrate', mapping: context.mapping })
  }, [context.mapping])

  useEffect(() => {
    onDraftChange(draft.dirty)
  }, [draft.dirty, onDraftChange])

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

      return putImportMapping({
        apiBaseUrl,
        importId: context.import.id,
        accessToken,
        body: serializeMappingDraft(draft),
      })
    },
    retry: false,
    onSuccess: async (mapping) => {
      setSaveError(null)
      dispatch({ type: 'saved', mapping })
      await queryClient.invalidateQueries({
        queryKey: [...importContextQueryKey(context.import.id), generation],
      })
      onSaved()
    },
    onError: async (error) => {
      if (
        isOpenImportApiError(error) &&
        error.code === 'IMPORT.MAPPING_REVISION_CONFLICT'
      ) {
        setSaveError(null)
        const accessToken = readSessionCredential(context.import.id)
        if (!accessToken) {
          return
        }

        const fresh = await queryClient.fetchQuery({
          queryKey: [...importContextQueryKey(context.import.id), generation],
          queryFn: ({ signal }) =>
            fetchImportContext({
              apiBaseUrl,
              importId: context.import.id,
              accessToken,
              signal,
            }),
        })

        dispatch({
          type: 'conflict',
          message: copyForApiError(error).body,
          remote: fresh.mapping,
        })
        return
      }

      if (isOpenImportApiError(error)) {
        setSaveError(copyForApiError(error).body)
      }
    },
  })

  if (context.import.status !== 'uploaded') {
    return null
  }

  const requiredKeys = context.template.fields
    .filter((field) => field.required)
    .map((field) => field.key)
  const associatedRequired = countAssociatedRequiredFields(draft, requiredKeys)
  const blocked = Boolean(draft.remote) || mutation.isPending

  return (
    <section className="oi-workbench oi-workbench-primary" aria-labelledby="oi-mapping-title">
      <div className="oi-workbench-head">
        <h2 id="oi-mapping-title">Mapear colunas</h2>
        <p className="oi-workbench-lead">
          Associe a posição da coluna ao campo do template. O texto do header
          não é usado como identificador.
        </p>
      </div>

      <p className="oi-draft-state" role="status">
        {associatedRequired} de {requiredKeys.length} campos obrigatórios
        associados.
        {draft.dirty
          ? ' Alterações locais ainda não salvas.'
          : ' Mapping alinhado à revisão salva.'}{' '}
        Revisão local esperada: {draft.expectedRevision}.
      </p>

      {draft.remote && draft.conflictMessage ? (
        <div className="oi-conflict" role="alert">
          <p>
            <strong>Conflito de revisão.</strong> {draft.conflictMessage}
          </p>
          <p className="oi-conflict-meta">
            Revisão local: {draft.expectedRevision} · Revisão atual no
            servidor: {draft.remote.revision}
          </p>
          <div className="oi-inline-actions">
            <button
              type="button"
              className="oi-secondary"
              onClick={() => dispatch({ type: 'discardLocalForRemote' })}
            >
              Descartar alterações locais
            </button>
            <button
              type="button"
              className="oi-primary"
              onClick={() => dispatch({ type: 'rebaseLocalOntoRemote' })}
            >
              Reaplicar associações locais
            </button>
          </div>
          <p className="oi-note">
            Reaplicar atualiza a revisão esperada, mas não salva automaticamente.
          </p>
        </div>
      ) : null}

      <div className="oi-mapping-list" role="list">
        {context.import.columns.map((column) => {
          const current = draftFieldForColumn(draft, column.position)
          return (
            <div
              key={column.position}
              className="oi-mapping-row"
              role="listitem"
            >
              <div className="oi-mapping-source">
                <span className="oi-mapping-pos">#{column.position}</span>
                <span className="oi-mapping-name">{column.name}</span>
              </div>
              <span className="oi-mapping-connector" aria-hidden="true">
                →
              </span>
              <label className="oi-mapping-target">
                <span className="oi-mapping-target-label">Destino</span>
                <select
                  aria-label={`Destino da coluna ${column.position}`}
                  value={current}
                  disabled={blocked}
                  onChange={(event) => {
                    dispatch({
                      type: 'setColumnField',
                      columnPosition: column.position,
                      fieldKey: event.target.value || null,
                    })
                    setSaveError(null)
                  }}
                >
                  <option value="">Sem associação</option>
                  {context.template.fields.map((field) => {
                    const taken = fieldUsedByOtherColumn(
                      draft,
                      field.key,
                      column.position,
                    )
                    return (
                      <option
                        key={field.key}
                        value={field.key}
                        disabled={taken}
                      >
                        {field.label} · {fieldTypeLabel(field.type)} ·{' '}
                        {field.required ? 'obrigatório' : 'opcional'}
                        {taken ? ' · em uso' : ''}
                      </option>
                    )
                  })}
                </select>
              </label>
            </div>
          )
        })}
      </div>

      <div className="oi-field-legend" aria-label="Campos do template">
        {context.template.fields.map((field) => {
          const used = draft.pairs.some((pair) => pair.fieldKey === field.key)
          return (
            <span
              key={field.key}
              className={
                used
                  ? 'oi-legend-chip oi-legend-chip-used'
                  : field.required
                    ? 'oi-legend-chip oi-legend-chip-required'
                    : 'oi-legend-chip'
              }
            >
              {field.label}
              <span className="oi-legend-meta">
                {fieldTypeLabel(field.type)} ·{' '}
                {field.required ? 'obrigatório' : 'opcional'}
                {used ? ' · associado' : ''}
              </span>
            </span>
          )
        })}
      </div>

      <div className="oi-inline-actions">
        <button
          type="button"
          className="oi-primary"
          disabled={!draft.dirty || blocked}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? 'Salvando mapping…' : 'Salvar mapping'}
        </button>
      </div>

      {saveError ? (
        <div className="oi-inline-error" role="alert">
          <p>{saveError}</p>
        </div>
      ) : null}

      {mutation.isPending ? (
        <p role="status" aria-label="Salvando mapping">
          Salvando mapping…
        </p>
      ) : null}
    </section>
  )
}
