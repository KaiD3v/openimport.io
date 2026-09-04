import { useQuery } from '@tanstack/react-query'
import type { ImportContext } from '../../api/import-context.schema.ts'
import { fetchImportContext } from '../../api/fetch-import-context.ts'
import { OpenImportApiError } from '../../api/errors.ts'
import { importContextQueryKey } from '../../api/query-key.ts'
import { readSessionCredential } from '../../embed/session-credential.ts'
import { isPollingStatus } from './flow-steps.ts'
import { isTerminalCredentialError } from './terminal-credential-error.ts'

const POLL_INTERVAL_MS = import.meta.env.MODE === 'test' ? 50 : 1500

export function useImportContextQuery(input: {
  apiBaseUrl: string
  importId: string
  generation: number
}) {
  return useQuery<ImportContext, Error>({
    queryKey: [...importContextQueryKey(input.importId), input.generation],
    enabled: input.generation > 0,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 0,
    gcTime: 0,
    refetchInterval: (query) => {
      if (query.state.error && isTerminalCredentialError(query.state.error)) {
        return false
      }
      const status = query.state.data?.import.status
      if (status && isPollingStatus(status)) {
        return POLL_INTERVAL_MS
      }
      return false
    },
    queryFn: ({ signal }) => {
      const accessToken = readSessionCredential(input.importId)
      if (!accessToken) {
        throw new OpenImportApiError({
          status: 0,
          code: 'OPENIMPORT.MISSING_CREDENTIAL',
          message: 'A sessão ainda não recebeu uma credencial temporária.',
        })
      }

      return fetchImportContext({
        apiBaseUrl: input.apiBaseUrl,
        importId: input.importId,
        accessToken,
        signal,
      })
    },
  })
}
