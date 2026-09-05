import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-sans-condensed/500.css'
import '@fontsource/ibm-plex-sans-condensed/600.css'
import '@fontsource/ibm-plex-sans-condensed/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import './index.css'
import App from './App.tsx'

async function bootstrap() {
  const rootElement = document.getElementById('root')
  if (!rootElement) {
    throw new Error('Elemento raiz não encontrado.')
  }

  const path = window.location.pathname.replace(/\/+$/, '') || '/'

  if (import.meta.env.DEV && path === '/dev') {
    const { DevHarness } = await import('./dev/DevHarness.tsx')
    createRoot(rootElement).render(
      <StrictMode>
        <DevHarness />
      </StrictMode>,
    )
    return
  }

  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()
