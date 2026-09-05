import type { Plugin } from 'vite'
import {
  createLabSession,
  LabSessionError,
} from './scripts/create-lab-session.mjs'

export { LabSessionError }

export const LAB_SESSION_PATH = '/__openimport/lab-session'

export type LabSessionIncoming = {
  method?: string
  url?: string
  socket: { remoteAddress?: string }
}

export type LabSessionOutgoing = {
  statusCode: number
  setHeader: (name: string, value: string) => void
  end: (chunk?: string) => unknown
}

export function isLoopbackAddress(address: string | undefined): boolean {
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1'
  )
}

function isLabSessionError(
  error: unknown,
): error is InstanceType<typeof LabSessionError> {
  return error instanceof LabSessionError
}

export function labSessionHttpError(error: unknown): {
  status: number
  message: string
} {
  if (isLabSessionError(error) && error.code === 'seed') {
    return {
      status: 500,
      message: 'Chave de seed não configurada em backend/.env.',
    }
  }
  if (isLabSessionError(error) && error.code === 'network') {
    return {
      status: 503,
      message: 'Backend indisponível em localhost:3000.',
    }
  }
  return {
    status: 502,
    message: 'Não foi possível criar a sessão de laboratório.',
  }
}

export function sanitizeLabLog(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw
    .replace(/oi_live_\S+/g, 'oi_live_…')
    .replace(/oi_import_\S+/g, 'oi_import_…')
}

function sendJson(
  res: LabSessionOutgoing,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {},
) {
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  for (const [name, value] of Object.entries(extraHeaders)) {
    res.setHeader(name, value)
  }
  res.end(payload)
}

type LabSessionDeps = {
  createLabSession?: typeof createLabSession
  log?: (message: string) => void
}

export async function handleLabSessionRequest(
  req: LabSessionIncoming,
  res: LabSessionOutgoing,
  next: () => void,
  deps: LabSessionDeps = {},
): Promise<void> {
  const url = req.url?.split('?')[0]
  if (url !== LAB_SESSION_PATH) {
    next()
    return
  }

  if (req.method !== 'POST') {
    res.statusCode = 404
    res.end()
    return
  }

  if (!isLoopbackAddress(req.socket.remoteAddress)) {
    sendJson(res, 403, {
      message: 'Sessão de laboratório só está disponível em loopback.',
    })
    return
  }

  try {
    const create = deps.createLabSession ?? createLabSession
    const result = await create()
    sendJson(res, 200, result, { 'Cache-Control': 'no-store' })
  } catch (error) {
    const mapped = labSessionHttpError(error)
    ;(deps.log ?? defaultLabLog)(sanitizeLabLog(error))
    sendJson(res, mapped.status, { message: mapped.message })
  }
}

function defaultLabLog(message: string) {
  console.error('[openimport-lab-session]', message)
}

export function labSessionPlugin(): Plugin {
  return {
    name: 'openimport-lab-session',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void handleLabSessionRequest(req, res, next)
      })
    },
  }
}
