export type ParentOriginsResult =
  | { ok: true; origins: string[] }
  | { ok: false; code: string; message: string }

export function parseParentOrigins(
  raw: string,
  options: { isProduction: boolean },
): ParentOriginsResult {
  const parts = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.length === 0) {
    return {
      ok: false,
      code: 'OPENIMPORT.MISSING_PARENT_ORIGINS',
      message: options.isProduction
        ? 'A lista de origens do sistema hospedeiro é obrigatória em produção.'
        : 'Configure VITE_OPENIMPORT_PARENT_ORIGINS com origens explícitas.',
    }
  }

  const origins: string[] = []

  for (const part of parts) {
    if (part.includes('*')) {
      return {
        ok: false,
        code: 'OPENIMPORT.INVALID_PARENT_ORIGINS',
        message: 'Origens com curinga não são permitidas.',
      }
    }

    let url: URL
    try {
      url = new URL(part)
    } catch {
      return {
        ok: false,
        code: 'OPENIMPORT.INVALID_PARENT_ORIGINS',
        message: 'Cada origem precisa ser uma URL absoluta.',
      }
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return {
        ok: false,
        code: 'OPENIMPORT.INVALID_PARENT_ORIGINS',
        message: 'Use somente origens http ou https.',
      }
    }

    if (part !== url.origin) {
      return {
        ok: false,
        code: 'OPENIMPORT.INVALID_PARENT_ORIGINS',
        message: 'Informe somente a origem, sem caminho.',
      }
    }

    origins.push(url.origin)
  }

  return { ok: true, origins }
}
