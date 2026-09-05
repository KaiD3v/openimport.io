import { parseParentOrigins } from '../embed/parent-origins.ts'

export type RuntimeConfig = {
  apiBaseUrl: string
  parentOrigins: string[]
  isProduction: boolean
}

export type RuntimeConfigResult =
  | { ok: true; config: RuntimeConfig }
  | { ok: false; code: string; message: string }

export function readRuntimeConfig(env: ImportMetaEnv): RuntimeConfigResult {
  const isProduction = env.PROD
  const apiBaseUrl = env.VITE_OPENIMPORT_API_BASE_URL?.trim() ?? ''

  if (!apiBaseUrl) {
    return {
      ok: false,
      code: 'OPENIMPORT.MISSING_API_BASE_URL',
      message: 'Configure VITE_OPENIMPORT_API_BASE_URL com a base /api/v1.',
    }
  }

  const isSameOriginPath =
    apiBaseUrl.startsWith('/') && !apiBaseUrl.startsWith('//')

  if (!isSameOriginPath) {
    let parsedUrl: URL
    try {
      parsedUrl = new URL(apiBaseUrl)
    } catch {
      return {
        ok: false,
        code: 'OPENIMPORT.INVALID_API_BASE_URL',
        message:
          'VITE_OPENIMPORT_API_BASE_URL precisa ser uma URL absoluta ou um caminho /api/v1.',
      }
    }

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return {
        ok: false,
        code: 'OPENIMPORT.INVALID_API_BASE_URL',
        message: 'A base da API precisa usar http ou https.',
      }
    }
  }

  const origins = parseParentOrigins(env.VITE_OPENIMPORT_PARENT_ORIGINS ?? '', {
    isProduction,
  })

  if (!origins.ok) {
    return origins
  }

  return {
    ok: true,
    config: {
      apiBaseUrl: apiBaseUrl.replace(/\/+$/, ''),
      parentOrigins: origins.origins,
      isProduction,
    },
  }
}
