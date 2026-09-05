import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readSeedApiKey } from './read-seed-api-key.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, '../..')
const defaultEnvPath = join(repoRoot, 'backend/.env')
const defaultTemplatePath = join(
  repoRoot,
  'backend/docs/examples/products-template.json',
)
const defaultApiBaseUrl = 'http://localhost:3000/api/v1'

export class LabSessionError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined)
    this.name = 'LabSessionError'
    this.code = code
  }
}

export function resolveLabApiBaseUrl({
  apiBaseUrl,
  env = process.env,
} = {}) {
  const raw =
    apiBaseUrl ??
    env.OPENIMPORT_API_BASE_URL ??
    env.VITE_OPENIMPORT_API_BASE_URL ??
    defaultApiBaseUrl
  return String(raw).replace(/\/$/, '')
}

async function apiJson(fetchImpl, apiBaseUrl, apiKey, path, { body, headers = {} }) {
  let response
  try {
    response = await fetchImpl(`${apiBaseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
    })
  } catch (error) {
    throw new LabSessionError(
      'network',
      'Backend is not reachable.',
      error,
    )
  }

  const text = await response.text()
  let json
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }

  if (!response.ok) {
    const code =
      json && typeof json.code === 'string' ? ` ${json.code}` : ''
    throw new LabSessionError(
      'upstream',
      `POST ${path} -> ${response.status}${code}`.trim(),
    )
  }

  return json
}

export async function createLabSession({
  apiBaseUrl,
  apiKey,
  envPath = defaultEnvPath,
  templateBody,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  randomUUID = () => crypto.randomUUID(),
  env = process.env,
} = {}) {
  let key = apiKey
  try {
    key = key ?? readSeedApiKey(envPath)
  } catch (error) {
    throw new LabSessionError(
      'seed',
      'Seed API key is not configured.',
      error,
    )
  }

  const template =
    templateBody ??
    JSON.parse(readFileSync(defaultTemplatePath, 'utf8'))
  const base = resolveLabApiBaseUrl({ apiBaseUrl, env })
  const createdTemplate = await apiJson(fetchImpl, base, key, '/templates', {
    body: {
      ...template,
      name: `${template.name} lab ${now()}`,
    },
  })
  const session = await apiJson(fetchImpl, base, key, '/imports', {
    body: { templateId: createdTemplate.id },
    headers: { 'Idempotency-Key': `lab-${randomUUID()}` },
  })
  const tokenPayload = await apiJson(
    fetchImpl,
    base,
    key,
    `/imports/${session.id}/access-tokens`,
    { body: { expiresInSeconds: 1800 } },
  )

  if (!tokenPayload?.accessToken?.startsWith('oi_import_')) {
    throw new LabSessionError(
      'invalid_token',
      'Lab session did not return an import token.',
    )
  }

  return {
    importId: session.id,
    accessToken: tokenPayload.accessToken,
    expiresAt: tokenPayload.expiresAt,
    templateId: createdTemplate.id,
  }
}
