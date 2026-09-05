import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'
import { shouldRetryFailedQuery } from './api/query-retry.ts'
import { readRuntimeConfig } from './config/runtime.ts'
import { DocsPage } from './features/docs/DocsPage.tsx'
import { HomePage } from './features/home/HomePage.tsx'
import { InvalidImportPage } from './features/home/InvalidImportPage.tsx'
import { NotFoundPage } from './features/home/NotFoundPage.tsx'
import { ImportApp } from './features/import-context/ImportApp.tsx'
import { SiteChrome } from './features/shared/SiteChrome.tsx'
import { StatePanel } from './features/shared/StatePanel.tsx'
import { parseAppRoute } from './routing/parse-app-route.ts'

export default function App() {
  const route = parseAppRoute(window.location.pathname)

  if (route.kind === 'home') {
    return <HomePage />
  }

  if (route.kind === 'docs') {
    return <DocsPage />
  }

  if (route.kind === 'not-found') {
    return <NotFoundPage />
  }

  if (route.kind === 'invalid-import') {
    return <InvalidImportPage />
  }

  return <ImportRuntime />
}

function ImportRuntime() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: shouldRetryFailedQuery,
            refetchOnWindowFocus: false,
            staleTime: 0,
            gcTime: 0,
          },
        },
      }),
  )

  const runtime = readRuntimeConfig(import.meta.env)

  if (!runtime.ok) {
    return (
      <SiteChrome variant="workbench">
        <main id="conteudo-principal" className="oi-main" tabIndex={-1}>
          <StatePanel
            code={runtime.code}
            tone="fail"
            title="Configuração incompleta"
            body={runtime.message}
            nextAction="Defina VITE_OPENIMPORT_API_BASE_URL e VITE_OPENIMPORT_PARENT_ORIGINS no ambiente do frontend."
            detail="A homepage e as páginas de erro não exigem essa configuração."
            action={{ label: 'Ir para a página inicial', href: '/' }}
          />
        </main>
      </SiteChrome>
    )
  }

  return (
    <QueryClientProvider client={queryClient}>
      <ImportApp pathname={window.location.pathname} config={runtime.config} />
    </QueryClientProvider>
  )
}
