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
 * - up to 2 templates
 * - up to 2 import sessions (+ uploaded objects)
 * - multiple access token records
 *
 * Usage: OPENIMPORT_E2E_ALLOW_PERSIST=1 node scripts/e2e-walkthrough.mjs
 */
import { chromium } from 'playwright-core'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  auditSecretsLeak,
  createSessionArtifactSlot,
  isConfirmPostUrl,
  isContextGetUrl,
  isForbiddenBrowserUrl,
  noteAccessTokenIssued,
  noteImportSessionCreated,
  noteReplacementTokenIssued,
  noteTemplateCreated,
  pollingStopped,
  shouldReportProcessingFromConfirmCache,
  snapshotSessionArtifacts,
} from './e2e-walkthrough-helpers.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '../..')
const backendEnvPath = join(root, 'backend/.env')
const api = process.env.OPENIMPORT_API_BASE_URL ?? 'http://localhost:3000/api/v1'
const frontend = process.env.OPENIMPORT_FRONTEND_URL ?? 'http://localhost:5173'
const outDir = join(__dirname, '../tmp-e2e')
mkdirSync(outDir, { recursive: true })

const POLL_STOP_OBSERVE_MS = 2500
const POLL_STOP_MIN_MS = 2000
const CONTEXT_ROUTE = '**/api/v1/imports/*/context'

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

function buildCsvWithManyRejects() {
  const lines = ['sku;stock;price']
  lines.push('ABC-1;7;299,90')
  lines.push('ABC-2;3;10,50')
  for (let i = 0; i < 55; i += 1) {
    lines.push(`;${i};bad`)
  }
  return Buffer.from(`${lines.join('\n')}\n`, 'utf8')
}

async function createSession(apiKey, templateBody, label, artifactSlot) {
  const body = {
    ...templateBody,
    name: `${templateBody.name} ${label} ${Date.now()}`,
  }
  const template = await apiJson('/templates', {
    method: 'POST',
    token: apiKey,
    body,
  })
  noteTemplateCreated(artifactSlot, template.id)

  const session = await apiJson('/imports', {
    method: 'POST',
    token: apiKey,
    body: { templateId: template.id },
    headers: { 'Idempotency-Key': `fe-walk-${label}-${Date.now()}` },
  })
  noteImportSessionCreated(artifactSlot, session.id)

  const tokenPayload = await apiJson(`/imports/${session.id}/access-tokens`, {
    method: 'POST',
    token: apiKey,
    body: { expiresInSeconds: 900 },
  })
  const accessToken = tokenPayload.accessToken
  if (!accessToken?.startsWith('oi_import_')) {
    throw new Error('access token missing oi_import_ prefix')
  }
  noteAccessTokenIssued(artifactSlot, accessToken)
  return { template, session, accessToken }
}

async function mintToken(apiKey, importId) {
  const tokenPayload = await apiJson(`/imports/${importId}/access-tokens`, {
    method: 'POST',
    token: apiKey,
    body: { expiresInSeconds: 900 },
  })
  if (!tokenPayload.accessToken?.startsWith('oi_import_')) {
    throw new Error('replacement access token missing oi_import_ prefix')
  }
  return tokenPayload.accessToken
}

async function driveToPreview(frame, csvBytes) {
  await frame.getByRole('heading', { name: 'Enviar CSV' }).waitFor({
    timeout: 15000,
  })
  await frame.locator('input[type="file"]').setInputFiles({
    name: 'products-walkthrough.csv',
    mimeType: 'text/csv',
    buffer: csvBytes,
  })
  await frame.getByRole('button', { name: 'Enviar arquivo' }).click()
  await frame.getByRole('heading', { name: 'Mapear colunas' }).waitFor({
    timeout: 20000,
  })

  const selects = frame.getByLabel(/Destino da coluna/)
  await selects.nth(0).selectOption('sku')
  await selects.nth(1).selectOption('stock')
  await selects.nth(2).selectOption('priceInCents')
  await frame.getByRole('button', { name: 'Salvar mapping' }).click()
  await frame
    .getByText(/Mapping completo — revisão/i)
    .waitFor({ timeout: 15000 })

  await frame.getByRole('button', { name: 'Gerar preview' }).click()
  await frame.getByRole('heading', { name: 'Resumo' }).waitFor({ timeout: 20000 })
  await frame.getByTestId('confirm-panel').waitFor({ timeout: 10000 })
}

async function loadAndInit(page, importId, accessToken) {
  await page.goto(`${frontend}/dev`, { waitUntil: 'networkidle' })
  await page.getByLabel('importId').fill(importId)
  await page.getByLabel('token temporário').fill(accessToken)
  await page.getByRole('button', { name: 'Carregar iframe' }).click()
  await page.waitForSelector('iframe.oi-harness-frame')
  await page.getByRole('button', { name: 'Inicializar sessão' }).click()
  return page.frameLocator('iframe.oi-harness-frame')
}

const apiKey = readSeedKey()
const templateBody = JSON.parse(
  readFileSync(join(root, 'backend/docs/examples/products-template.json'), 'utf8'),
)
const csvBytes = buildCsvWithManyRejects()

const artifacts = {
  primary: createSessionArtifactSlot(),
  authProbe: createSessionArtifactSlot(),
}

let primary = null
let authProbe = null
let replacementToken = null
let browser = null
let page = null
let summary = {
  ok: false,
  failedStep: 'setup',
  artifacts: {
    primary: snapshotSessionArtifacts(artifacts.primary),
    authProbe: snapshotSessionArtifacts(artifacts.authProbe),
  },
}

const consoleMessages = []
const networkLog = []
let primaryConfirmPosts = 0
let totalConfirmPosts = 0
let phase = 'primary'
let confirmAcceptedPrimary = false
let blockContextAfterPrimaryConfirm = false
let allowContextReconcile = false
let successfulContextGetsAfterConfirm = 0
let blockedContextGetsAfterConfirm = 0
let injectAuth401 = false
let authPoll401Hits = 0
let routeErrors = []

async function safeUnrouteAll(activePage) {
  if (!activePage) return
  try {
    await activePage.unrouteAll({ behavior: 'ignoreErrors' })
  } catch (error) {
    routeErrors.push(
      error instanceof Error ? error.message : String(error),
    )
  }
}

function refreshArtifactSummary() {
  summary.artifacts = {
    primary: snapshotSessionArtifacts(artifacts.primary),
    authProbe: snapshotSessionArtifacts(artifacts.authProbe),
  }
}

try {
  primary = await createSession(
    apiKey,
    templateBody,
    'primary',
    artifacts.primary,
  )
  refreshArtifactSummary()

  authProbe = await createSession(
    apiKey,
    templateBody,
    'auth-probe',
    artifacts.authProbe,
  )
  refreshArtifactSummary()

  browser = await chromium.launch({ channel: 'chrome', headless: true })
  page = await browser.newPage()

  page.on('console', (msg) => {
    consoleMessages.push(msg.text())
  })

  page.on('request', (request) => {
    const url = request.url()
    if (!url.includes('/api/v1/')) return
    const path = url.replace(api, '')
    networkLog.push({ method: request.method(), url: path, phase: 'request' })
    if (isForbiddenBrowserUrl(url)) {
      networkLog.push({ forbidden: true, url: path })
    }
    if (isConfirmPostUrl(request.method(), url)) {
      totalConfirmPosts += 1
      if (phase === 'primary') {
        primaryConfirmPosts += 1
        // Block reconcile GETs as soon as confirm is in flight so the panel
        // cannot be explained by a racing successful /context response.
        blockContextAfterPrimaryConfirm = true
      }
    }
  })

  page.on('response', (response) => {
    const url = response.url()
    if (!url.includes('/api/v1/')) return
    const path = url.replace(api, '')
    const method = response.request().method()
    networkLog.push({
      method,
      url: path,
      status: response.status(),
      phase: 'response',
    })

    if (
      phase === 'primary' &&
      isConfirmPostUrl(method, url) &&
      response.status() === 202
    ) {
      confirmAcceptedPrimary = true
    }

    if (
      phase === 'primary' &&
      confirmAcceptedPrimary &&
      isContextGetUrl(method, url) &&
      response.status() >= 200 &&
      response.status() < 300
    ) {
      successfulContextGetsAfterConfirm += 1
    }
  })

  await page.route(CONTEXT_ROUTE, async (route) => {
    const request = route.request()
    if (request.method() !== 'GET') {
      await route.continue()
      return
    }

    if (injectAuth401) {
      authPoll401Hits += 1
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'AUTH.INVALID_IMPORT_TOKEN',
          message: 'Import token is not valid.',
          traceId: 'e2e_poll_401',
        }),
      })
      return
    }

    if (
      phase === 'primary' &&
      blockContextAfterPrimaryConfirm &&
      !allowContextReconcile
    ) {
      blockedContextGetsAfterConfirm += 1
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          code: 'OPENIMPORT.NETWORK',
          message: 'e2e blocked first reconcile',
          traceId: 'e2e_block_context',
        }),
      })
      return
    }

    await route.continue()
  })

  // --- Happy path ---
  summary.failedStep = 'primary-load'
  const frame = await loadAndInit(page, primary.session.id, primary.accessToken)
  summary.failedStep = 'primary-preview'
  await driveToPreview(frame, csvBytes)

  const previewText = await frame.locator('.oi-preview-result').innerText()
  const hasCents = /29990/.test(previewText)
  const hasInvalid = /Inválido/i.test(previewText)

  summary.failedStep = 'primary-confirm-cache'
  await frame.getByRole('button', { name: 'Confirmar importação' }).click()
  await frame.getByTestId('processing-panel').waitFor({ timeout: 10000 })

  const panelVisible =
    (await frame.getByTestId('processing-panel').count()) > 0
  const successfulContextAtPanelAssert = successfulContextGetsAfterConfirm
  const processingBeforeSuccessfulContextRefetch =
    shouldReportProcessingFromConfirmCache({
      panelVisible,
      successfulContextGetsAfterConfirm: successfulContextAtPanelAssert,
    })

  if (!processingBeforeSuccessfulContextRefetch) {
    throw new Error(
      `processing panel not proven from 202 cache (successfulContextGetsAfterConfirm=${successfulContextAtPanelAssert}, blocked=${blockedContextGetsAfterConfirm})`,
    )
  }
  if (!confirmAcceptedPrimary) {
    throw new Error('confirm 202 was not observed for primary flow')
  }
  if (blockedContextGetsAfterConfirm < 1) {
    throw new Error(
      'expected at least one blocked/503 context GET after confirm before reconcile',
    )
  }
  if (primaryConfirmPosts !== 1) {
    throw new Error(
      `expected exactly 1 primary confirm request, got ${primaryConfirmPosts}`,
    )
  }

  summary.failedStep = 'primary-reconcile-ready'
  allowContextReconcile = true
  blockContextAfterPrimaryConfirm = false

  await frame.getByTestId('ready-panel').waitFor({ timeout: 120000 })
  await frame.getByTestId('rejected-rows-panel').waitFor({ timeout: 20000 })
  await frame.getByText('#3', { exact: true }).waitFor({ timeout: 15000 })

  let loadedMore = false
  const loadMore = frame.getByRole('button', { name: 'Carregar mais' })
  if (await loadMore.count()) {
    await loadMore.click()
    await frame.getByText('#53', { exact: true }).waitFor({ timeout: 15000 })
    loadedMore = true
  }

  await page.screenshot({
    path: join(outDir, 'walkthrough-ready.png'),
    fullPage: true,
  })

  // --- Auth probe ---
  summary.failedStep = 'auth-probe-setup'
  phase = 'auth-probe'
  injectAuth401 = false
  authPoll401Hits = 0

  const authFrame = await loadAndInit(
    page,
    authProbe.session.id,
    authProbe.accessToken,
  )
  summary.failedStep = 'auth-probe-preview'
  await driveToPreview(authFrame, csvBytes)

  summary.failedStep = 'auth-probe-confirm'
  await authFrame.getByRole('button', { name: 'Confirmar importação' }).click()
  await authFrame.getByTestId('processing-panel').waitFor({ timeout: 10000 })

  summary.failedStep = 'auth-probe-401'
  injectAuth401 = true
  await authFrame
    .getByRole('alert')
    .filter({ hasText: /expirou/i })
    .waitFor({ timeout: 20000 })

  const terminalVisible = true
  const processingGone =
    (await authFrame.getByTestId('processing-panel').count()) === 0
  const noRetry =
    (await authFrame
      .getByRole('button', { name: /tentar atualizar|tentar novamente/i })
      .count()) === 0

  const hitsAtTerminal = authPoll401Hits
  await page.waitForTimeout(POLL_STOP_OBSERVE_MS)
  const noFurtherPolls = pollingStopped({
    hitsAtTerminal,
    hitsAfterWait: authPoll401Hits,
    waitedMs: POLL_STOP_OBSERVE_MS,
    minWaitMs: POLL_STOP_MIN_MS,
  })

  if (!noFurtherPolls) {
    throw new Error(
      `polling continued after 401 (hits ${hitsAtTerminal} → ${authPoll401Hits} over ${POLL_STOP_OBSERVE_MS}ms)`,
    )
  }

  summary.failedStep = 'auth-probe-reinit'
  injectAuth401 = false
  replacementToken = await mintToken(apiKey, authProbe.session.id)
  noteReplacementTokenIssued(artifacts.authProbe, replacementToken)
  refreshArtifactSummary()

  await page.getByLabel('token temporário').fill(replacementToken)
  await page.getByRole('button', { name: 'Inicializar sessão' }).click()
  await authFrame
    .getByTestId(/processing-panel|ready-panel/)
    .waitFor({ timeout: 30000 })
  const recoveredAfterReinit = true

  await page.screenshot({
    path: join(outDir, 'walkthrough-auth-recovered.png'),
    fullPage: true,
  })

  summary.failedStep = 'final-audit'
  const forbiddenCalls = networkLog.filter((entry) => entry.forbidden)
  const iframeUrl = await page
    .locator('iframe.oi-harness-frame')
    .getAttribute('src')
  const pageUrl = page.url()
  const storage = await page.evaluate(() => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
  }))
  const cookies = await page.context().cookies()
  const leak = auditSecretsLeak({
    secrets: [
      apiKey,
      primary.accessToken,
      authProbe.accessToken,
      replacementToken,
    ],
    consoleMessages,
    iframeUrl,
    pageUrl,
    storage,
    cookies,
  })

  summary = {
    ok:
      hasCents &&
      hasInvalid &&
      processingBeforeSuccessfulContextRefetch &&
      primaryConfirmPosts === 1 &&
      loadedMore &&
      forbiddenCalls.length === 0 &&
      !leak.leaked &&
      terminalVisible &&
      processingGone &&
      noRetry &&
      noFurtherPolls &&
      recoveredAfterReinit &&
      routeErrors.length === 0,
    failedStep: null,
    checks: {
      hasCents,
      hasInvalid,
      processingBeforeSuccessfulContextRefetch,
      successfulContextGetsAfterConfirmAtPanelAssert:
        successfulContextAtPanelAssert,
      blockedContextGetsAfterConfirm,
      primaryConfirmPosts,
      totalConfirmPosts,
      loadedMore,
      forbiddenCalls: forbiddenCalls.length,
      leaked: leak.leaked,
      leakSurfaces: leak.surfaces,
      terminalVisible,
      processingGone,
      noRetry,
      noFurtherPolls,
      pollStopObserveMs: POLL_STOP_OBSERVE_MS,
      authPoll401HitsAtTerminal: hitsAtTerminal,
      authPoll401HitsAfterWait: authPoll401Hits,
      recoveredAfterReinit,
    },
    evidence: {
      order:
        'POST /confirm 202 → processing-panel with context GET blocked (503) → unblock → ready',
      processingBeforeSuccessfulContextRefetch,
      blockedContextGetsAfterConfirm,
    },
    artifacts: {
      primary: snapshotSessionArtifacts(artifacts.primary),
      authProbe: snapshotSessionArtifacts(artifacts.authProbe),
    },
    persistedArtifacts: [
      '2 templates',
      '2 import sessions',
      '2 uploaded objects',
      '3+ access token records',
    ],
    cleanup: 'none — backend has no delete endpoint in scope',
    iframeUrl,
    pageUrl,
    storageKeys: {
      local: Object.keys(storage.local),
      session: Object.keys(storage.session),
    },
    cookieNames: cookies.map((cookie) => cookie.name),
    consoleCount: consoleMessages.length,
    services: {
      api,
      frontend,
      postgres: 'localhost:5434',
      minio: 'localhost:9000',
      redis: 'localhost:6379/0',
    },
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  if (page) {
    await page
      .screenshot({ path: join(outDir, 'walkthrough-error.png'), fullPage: true })
      .catch(() => {})
  }
  summary = {
    ok: false,
    failedStep: summary.failedStep ?? 'unknown',
    error: message,
    artifacts: {
      primary: snapshotSessionArtifacts(artifacts.primary),
      authProbe: snapshotSessionArtifacts(artifacts.authProbe),
    },
    checks: {
      primaryConfirmPosts,
      totalConfirmPosts,
      successfulContextGetsAfterConfirm,
      blockedContextGetsAfterConfirm,
      authPoll401Hits,
    },
    networkSample: networkLog.slice(-40),
    routeErrors,
  }
} finally {
  try {
    await safeUnrouteAll(page)
  } catch (error) {
    routeErrors.push(
      error instanceof Error ? error.message : String(error),
    )
  }
  if (browser) {
    await browser.close().catch(() => {})
  }
  if (routeErrors.length > 0 && summary) {
    summary.routeErrors = routeErrors
    if (summary.ok) {
      summary.ok = false
      summary.error = [
        summary.error,
        `route cleanup: ${routeErrors.join(' | ')}`,
      ]
        .filter(Boolean)
        .join(' · ')
    }
  }
}

writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary, null, 2))
if (!summary?.ok) process.exit(1)
