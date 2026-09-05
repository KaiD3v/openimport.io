import { useEffect, type ReactNode } from 'react'
import { isOpenImportApiError, OpenImportApiError } from '../../api/errors.ts'
import type { RuntimeConfig } from '../../config/runtime.ts'
import { postToParent } from '../../embed/initialize-message.ts'
import {
  clearSessionCredential,
  readSessionCredential,
} from '../../embed/session-credential.ts'
import { useHostSession } from '../../embed/use-host-session.ts'
import { parseImportIdFromPath } from '../../routing/parse-import-path.ts'
import { SiteChrome } from '../shared/SiteChrome.tsx'
import { StatePanel } from '../shared/StatePanel.tsx'
import { copyForApiError, copyForInitError } from './copy.ts'
import { LoadedImportView } from './LoadedImportView.tsx'
import { isTerminalCredentialError } from './terminal-credential-error.ts'
import { useImportContextQuery } from './use-import-context-query.ts'

type ImportAppProps = {
  pathname: string
  config: RuntimeConfig
}

export function ImportApp({ pathname, config }: ImportAppProps) {
  const path = parseImportIdFromPath(pathname)

  if (!path.ok) {
    return (
      <ImportShell importId={null}>
        <StatePanel
          code={
            path.reason === 'invalid'
              ? 'IMPORT.INVALID_ID'
              : 'IMPORT.PATH_REQUIRED'
          }
          tone="fail"
          title="Endereço inválido"
          body={
            path.reason === 'invalid'
              ? 'O identificador da importação na URL não é um UUID válido.'
              : 'Abra esta interface em /imports/:importId a partir do sistema de origem.'
          }
          nextAction="Corrija a URL no sistema hospedeiro e recarregue o iframe."
          action={{ label: 'Ir para a página inicial', href: '/' }}
        />
      </ImportShell>
    )
  }

  return <InitializedImport importId={path.importId} config={config} />
}

function InitializedImport({
  importId,
  config,
}: {
  importId: string
  config: RuntimeConfig
}) {
  const { generation, initError, parentOriginRef } = useHostSession({
    importId,
    allowedOrigins: config.parentOrigins,
  })
  const query = useImportContextQuery({
    apiBaseUrl: config.apiBaseUrl,
    importId,
    generation,
  })

  useEffect(() => {
    if (query.isError && isTerminalCredentialError(query.error)) {
      if (readSessionCredential(importId)) {
        clearSessionCredential()
      }
    }
  }, [importId, query.error, query.isError])

  useEffect(() => {
    const origin = parentOriginRef.current
    if (!origin) {
      return
    }

    if (query.isSuccess) {
      postToParent(window.parent, origin, {
        type: 'openimport.loaded',
        version: 1,
        importId,
      })
    }

    if (query.isError && isOpenImportApiError(query.error)) {
      postToParent(window.parent, origin, {
        type: 'openimport.error',
        version: 1,
        importId,
        code: query.error.code,
        traceId: query.error.traceId,
      })
    }
  }, [
    importId,
    parentOriginRef,
    query.dataUpdatedAt,
    query.error,
    query.errorUpdatedAt,
    query.isError,
    query.isSuccess,
  ])

  let body: ReactNode
  if (initError) {
    const copy = copyForInitError(initError)
    body = (
      <StatePanel
        code={copy.code ?? 'OPENIMPORT.INIT_FAILED'}
        tone="fail"
        title={copy.title}
        body={copy.body}
        nextAction="Reabra a sessão pelo sistema de origem com um token válido."
        detail={copy.traceId}
      />
    )
  } else if (generation === 0) {
    body = (
      <StatePanel
        code="EMBED.WAITING"
        tone="wait"
        title="Aguardando o sistema de origem"
        body="A importação ainda não foi inicializada. O token temporário deve chegar por postMessage, nunca pela URL."
        nextAction="No host, emita openimport.initialize com importId e oi_import_."
      />
    )
  } else if (query.isPending) {
    body = (
      <StatePanel
        code="CONTEXT.LOADING"
        tone="wait"
        title="Carregando o contexto da importação"
        body="Consultando a sessão, o template e o mapping."
        nextAction="Aguarde a resposta do backend."
      />
    )
  } else if (query.isError && isTerminalCredentialError(query.error)) {
    const apiError = isOpenImportApiError(query.error)
      ? query.error
      : new OpenImportApiError({
          status: 401,
          code: 'AUTH.INVALID_IMPORT_TOKEN',
          message: 'Token inválido.',
        })
    const copy = copyForApiError(apiError)
    body = (
      <StatePanel
        code={copy.code ?? apiError.code}
        tone="fail"
        title={copy.title}
        body={copy.body}
        nextAction="Reabra a sessão pelo sistema de origem com um token válido."
        detail={[copy.code, copy.traceId].filter(Boolean).join(' · ') || undefined}
      />
    )
  } else if (query.isError && !query.data) {
    const apiError = isOpenImportApiError(query.error)
      ? query.error
      : new OpenImportApiError({
          status: 0,
          code: 'OPENIMPORT.UNKNOWN',
          message: 'Erro inesperado.',
        })
    const copy = copyForApiError(apiError)
    body = (
      <StatePanel
        code={copy.code ?? apiError.code}
        tone={copy.retry ? 'warn' : 'fail'}
        title={copy.title}
        body={copy.body}
        nextAction={
          copy.retry
            ? 'Tente novamente quando a rede ou o serviço estiver disponível.'
            : 'Reabra a sessão pelo sistema de origem se o token expirou ou o recurso não existe.'
        }
        detail={[copy.code, copy.traceId].filter(Boolean).join(' · ') || undefined}
        action={
          copy.retry
            ? {
                label: 'Tentar novamente',
                onClick: () => {
                  void query.refetch()
                },
              }
            : undefined
        }
      />
    )
  } else if (query.data) {
    const pollCopy =
      query.isError && isOpenImportApiError(query.error)
        ? copyForApiError(query.error)
        : null
    body = (
      <LoadedImportView
        context={query.data}
        apiBaseUrl={config.apiBaseUrl}
        generation={generation}
        pollError={
          pollCopy && pollCopy.retry
            ? `${pollCopy.title}. ${pollCopy.body}`
            : null
        }
        onRetryPoll={() => {
          void query.refetch()
        }}
      />
    )
  } else {
    body = (
      <StatePanel
        code="CONTEXT.LOADING"
        tone="wait"
        title="Carregando o contexto da importação"
        body="Consultando a sessão, o template e o mapping."
        nextAction="Aguarde a resposta do backend."
      />
    )
  }

  return <ImportShell importId={importId}>{body}</ImportShell>
}

function ImportShell({
  importId,
  children,
}: {
  importId: string | null
  children: ReactNode
}) {
  return (
    <SiteChrome
      variant="workbench"
      importId={importId}
      statusLabel="CSV → mapping → JSON"
    >
      <main id="conteudo-principal" className="oi-main" tabIndex={-1}>
        {children}
      </main>
    </SiteChrome>
  )
}
