/**
 * Real walkthrough against local backend + frontend /dev.
 *
 * SAFETY: creates persistent templates/sessions/tokens/objects in the target
 * backend. There is no delete API in scope. Refuse to run unless opt-in is set.
 *
 * Opt-in (either):
 *   OPENIMPORT_E2E_ALLOW_PERSIST=1
 *   --allow-persist
 *
 * Prefer a disposable/test database. Artifacts left behind on each run:
 * - 1 template
 * - 1 import session (+ uploaded object in storage)
 * - 1 import access token record
 *
 * Usage: OPENIMPORT_E2E_ALLOW_PERSIST=1 node scripts/e2e-walkthrough.mjs
 */
import { chromium } from 'playwright-core'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '../..')
const backendEnvPath = join(root, 'backend/.env')
const api = process.env.OPENIMPORT_API_BASE_URL ?? 'http://localhost:3000/api/v1'
const frontend = process.env.OPENIMPORT_FRONTEND_URL ?? 'http://localhost:5173'
const outDir = join(__dirname, '../tmp-e2e')
mkdirSync(outDir, { recursive: true })

const allowPersist =
  process.env.OPENIMPORT_E2E_ALLOW_PERSIST === '1' ||
  process.argv.includes('--allow-persist')

if (!allowPersist) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        refused: true,
        reason:
          'qa:e2e cria template, sessão, token e objeto persistentes sem cleanup. Use OPENIMPORT_E2E_ALLOW_PERSIST=1 ou --allow-persist em ambiente descartável.',
      },
      null,
      2,
    ),
  )
  process.exit(2)
}

function readSeedKey() {
  const text = readFileSync(backendEnvPath, 'utf8')
  const match = text.match(/^SEED_API_KEY=(.+)$/m)
  if (!match) {
    throw new Error('SEED_API_KEY missing in backend/.env')
  }
  const key = match[1].trim().replace(/^["']|["']$/g, '')
  if (!key.startsWith('oi_live_')) {
    throw new Error('SEED_API_KEY must be oi_live_')
  }
  return key
}

async function apiJson(path, { method = 'GET', token, body, headers = {} } = {}) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  let json
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text.slice(0, 200) }
  }
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status} ${json?.code ?? ''}`)
  }
  return json
}

const apiKey = readSeedKey()
const templateBody = JSON.parse(
  readFileSync(join(root, 'backend/docs/examples/products-template.json'), 'utf8'),
)
templateBody.name = `${templateBody.name} ${Date.now()}`
const csvPath = join(root, 'backend/docs/examples/products-invalid.csv')
const csvBytes = readFileSync(csvPath)

const template = await apiJson('/templates', {
  method: 'POST',
  token: apiKey,
  body: templateBody,
})
const session = await apiJson('/imports', {
  method: 'POST',
  token: apiKey,
  body: { templateId: template.id },
  headers: { 'Idempotency-Key': `fe-walk-${Date.now()}` },
})
const tokenPayload = await apiJson(`/imports/${session.id}/access-tokens`, {
  method: 'POST',
  token: apiKey,
  body: { expiresInSeconds: 900 },
})

const importToken = tokenPayload.accessToken
if (!importToken?.startsWith('oi_import_')) {
  throw new Error('access token missing oi_import_ prefix')
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage()
const consoleMessages = []
page.on('console', (msg) => {
  consoleMessages.push(msg.text())
})

let summary

try {
  await page.goto(`${frontend}/dev`, { waitUntil: 'networkidle' })
  await page.getByLabel('importId').fill(session.id)
  await page.getByLabel('token temporário').fill(importToken)
  await page.getByRole('button', { name: 'Carregar iframe' }).click()
  await page.waitForSelector('iframe.oi-harness-frame')
  await page.getByRole('button', { name: 'Inicializar sessão' }).click()

  const frame = page.frameLocator('iframe.oi-harness-frame')
  await frame.getByText('Enviar CSV').waitFor({ timeout: 15000 })

  const fileInput = frame.locator('input[type="file"]')
  await fileInput.setInputFiles({
    name: 'products-invalid.csv',
    mimeType: 'text/csv',
    buffer: csvBytes,
  })
  await frame.getByRole('button', { name: 'Enviar arquivo' }).click()
  await frame.getByText('Mapear colunas').waitFor({ timeout: 20000 })

  const selects = frame.getByLabel(/Destino da coluna/)
  await selects.nth(0).selectOption('sku')
  await selects.nth(1).selectOption('stock')
  await selects.nth(2).selectOption('priceInCents')
  await frame.getByRole('button', { name: 'Salvar mapping' }).click()
  await frame.getByText(/Mapping alinhado|Mapping completo/i).waitFor({
    timeout: 15000,
  })
  await frame.getByRole('button', { name: 'Gerar preview' }).click()
  await frame.getByText(/Preview concluído/i).waitFor({ timeout: 20000 })

  const previewText = await frame.locator('.oi-preview-result').innerText()
  const hasCents = /29990/.test(previewText)
  const hasInvalid = /Inválido/i.test(previewText)

  const iframeUrl = await page.locator('iframe.oi-harness-frame').getAttribute('src')
  const storage = await page.evaluate(() => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
  }))
  const cookies = await page.context().cookies()

  const leaked =
    consoleMessages.some((line) => line.includes(importToken) || line.includes(apiKey)) ||
    iframeUrl?.includes('oi_import_') ||
    iframeUrl?.includes('oi_live_') ||
    JSON.stringify(storage).includes('oi_import_') ||
    JSON.stringify(storage).includes('oi_live_') ||
    cookies.some(
      (cookie) =>
        cookie.value.includes('oi_import_') || cookie.value.includes('oi_live_'),
    )

  await page.screenshot({ path: join(outDir, 'walkthrough.png'), fullPage: true })

  summary = {
    ok: hasCents && hasInvalid && !leaked,
    importId: session.id,
    templateId: template.id,
    persistedArtifacts: [
      'template',
      'import session',
      'uploaded object',
      'access token record',
    ],
    cleanup: 'none — backend has no delete endpoint in scope',
    hasCents,
    hasInvalid,
    leaked,
    iframeUrl,
    storageKeys: {
      local: Object.keys(storage.local),
      session: Object.keys(storage.session),
    },
    cookieNames: cookies.map((cookie) => cookie.name),
    consoleCount: consoleMessages.length,
  }
} finally {
  await browser.close()
}

writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary, null, 2))
if (!summary?.ok) process.exit(1)
