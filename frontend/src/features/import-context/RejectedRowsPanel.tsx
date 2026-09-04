import { useInfiniteQuery } from '@tanstack/react-query'
import { OpenImportApiError, isOpenImportApiError } from '../../api/errors.ts'
import { fetchRejectedRows } from '../../api/fetch-rejected-rows.ts'
import { rejectedRowsQueryKey } from '../../api/query-key.ts'
import { readSessionCredential } from '../../embed/session-credential.ts'
import { copyForApiError } from './copy.ts'
import { isTerminalCredentialError } from './terminal-credential-error.ts'

type RejectedRowsPanelProps = {
  importId: string
  apiBaseUrl: string
  generation: number
  enabled: boolean
}

const PAGE_LIMIT = 50

export function RejectedRowsPanel({
  importId,
  apiBaseUrl,
  generation,
  enabled,
}: RejectedRowsPanelProps) {
  const query = useInfiniteQuery({
    queryKey: [...rejectedRowsQueryKey(importId, generation)],
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    staleTime: 30_000,
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const accessToken = readSessionCredential(importId)
      if (!accessToken) {
        throw new OpenImportApiError({
          status: 401,
          code: 'AUTH.INVALID_IMPORT_TOKEN',
          message: 'Token ausente.',
        })
      }
      return fetchRejectedRows({
        apiBaseUrl,
        importId,
        accessToken,
        limit: PAGE_LIMIT,
        after: pageParam,
        signal,
      })
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  })

  if (!enabled) {
    return null
  }

  const rows = dedupeRows(
    query.data?.pages.flatMap((page) => page.data) ?? [],
  )
  const errorCopy =
    query.isError && isOpenImportApiError(query.error)
      ? copyForApiError(query.error)
      : null
  const terminalAuth =
    query.isError && isTerminalCredentialError(query.error)

  return (
    <section
      className="oi-workbench"
      aria-labelledby="oi-rejected-title"
      data-testid="rejected-rows-panel"
    >
      <div className="oi-workbench-head">
        <h2 id="oi-rejected-title">Linhas rejeitadas</h2>
        <p className="oi-workbench-lead">
          Erros por campo do snapshot. Sem CSV bruto nem payloads normalizados.
        </p>
      </div>

      {query.isPending ? (
        <p role="status">Carregando rejeições…</p>
      ) : null}

      {errorCopy ? (
        <div className="oi-inline-error" role="alert">
          <p>
            <strong>{errorCopy.title}.</strong> {errorCopy.body}
          </p>
          {errorCopy.retry && !terminalAuth ? (
            <button
              type="button"
              className="oi-secondary"
              onClick={() => {
                void query.refetch()
              }}
            >
              Tentar novamente
            </button>
          ) : null}
        </div>
      ) : null}

      {rows.length > 0 ? (
        <ul className="oi-rejected-list">
          {rows.map((row) => (
            <li key={row.recordNumber} className="oi-rejected-item">
              <header className="oi-record-head">
                <span className="oi-mono">#{row.recordNumber}</span>
              </header>
              <ul className="oi-error-list">
                {row.errors.map((error) => (
                  <li key={`${row.recordNumber}-${error.fieldKey}-${error.code}`}>
                    <span className="oi-mono">{error.fieldKey}</span>
                    <span className="oi-error-code">{error.code}</span>
                    <span>{error.message}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      ) : null}

      {query.hasNextPage ? (
        <div className="oi-inline-actions">
          <button
            type="button"
            className="oi-secondary"
            disabled={query.isFetchingNextPage}
            onClick={() => {
              void query.fetchNextPage()
            }}
          >
            {query.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
          </button>
        </div>
      ) : null}
    </section>
  )
}

function dedupeRows<T extends { recordNumber: number }>(rows: T[]): T[] {
  const seen = new Set<number>()
  const result: T[] = []
  for (const row of rows) {
    if (seen.has(row.recordNumber)) continue
    seen.add(row.recordNumber)
    result.push(row)
  }
  return result
}
