import { useQuery } from '@tanstack/react-query'
import { fetchImportContext } from '../../api/fetch-import-context.ts'
import { OpenImportApiError } from '../../api/errors.ts'
import { importContextQueryKey } from '../../api/query-key.ts'
import { readSessionCredential } from '../../embed/session-credential.ts'

export function useImportContextQuery(input: {
  apiBaseUrl: string
  importId: string
  generation: number
}) {
  return useQuery({
    queryKey: [...importContextQueryKey(input.importId), input.generation],
    enabled: input.generation > 0,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 0,
    gcTime: 0,
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
