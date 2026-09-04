/**
 * Visual QA covering public pages, harness, fixtures and errors.
 * Run: node scripts/visual-qa.mjs
 */
import { chromium } from 'playwright-core'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = process.env.OPENIMPORT_FRONTEND_URL ?? 'http://localhost:5173'
const VIEWPORTS = [
  { name: '360', width: 360, height: 900 },
  { name: '768', width: 768, height: 1024 },
  { name: '1440', width: 1440, height: 1100 },
]

const ROUTES = [
  { id: 'home', url: '/', kind: 'public' },
  { id: 'dev-harness', url: '/dev', kind: 'harness' },
  { id: 'not-found', url: '/does-not-exist', kind: 'error' },
  { id: 'invalid-import', url: '/imports/not-a-uuid', kind: 'error' },
]

const FIXTURES = [
  'waiting',
  'loading',
  'created',
  'upload-selected',
  'upload-pending',
  'uploaded-incomplete',
  'mapping-dirty',
  'mapping-conflict',
  'preview-valid',
  'preview-invalid',
  'preview-truncated',
  'confirmation-ready',
  'queued',
  'processing-determined',
  'processing-indeterminate',
  'ready-no-rejects',
  'ready-with-rejects',
  'processing-failed',
  'polling-error',
  'polling-session-expired',
  'ready-rejects-expired',
  'upload-failed',
  'token-expired',
  'long-labels',
]

const outDir = join(process.cwd(), 'tmp-visual-qa')
mkdirSync(outDir, { recursive: true })

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
})

const report = []

async function measure(page) {
  return page.evaluate(() => {
    const doc = document.documentElement
    const body = document.body
    const overflowX =
      Math.max(doc.scrollWidth, body.scrollWidth) >
      Math.ceil(window.innerWidth) + 1
    const clippedRight = [
      ...document.querySelectorAll(
        '.oi-file-name, .oi-mapping-name, .oi-session-v, .oi-hero h1, .oi-record-card, .oi-error-code, .oi-map-snippet',
      ),
    ]
      .filter((el) => el instanceof HTMLElement)
      .map((el) => {
        const rect = el.getBoundingClientRect()
        return {
          text: (el.textContent ?? '').slice(0, 48),
          overflowsViewport: rect.right > window.innerWidth + 1,
        }
      })
      .filter((entry) => entry.overflowsViewport)

    return {
      innerWidth: window.innerWidth,
      scrollWidth: Math.max(doc.scrollWidth, body.scrollWidth),
      overflowX,
      clippedRight,
      pageHeight: Math.max(doc.scrollHeight, body.scrollHeight),
      hasLab: Boolean(document.querySelector('[data-testid="openimport-dev-harness"]')),
      hasCanvas: Boolean(document.querySelector('.oi-map-canvas, .oi-lab-canvas, .oi-import-layout')),
      hasState: Boolean(document.querySelector('.oi-state')),
    }
  })
}

for (const viewport of VIEWPORTS) {
  for (const route of ROUTES) {
    const page = await browser.newPage({
      viewport: { width: viewport.width, height: viewport.height },
    })
    await page.goto(`${BASE}${route.url}`, { waitUntil: 'networkidle' })
    if (route.kind === 'harness') {
      await page.waitForSelector('[data-testid="openimport-dev-harness"]')
    }
    const metrics = await measure(page)
    const shot = join(outDir, `${route.id}-${viewport.name}.png`)
    await page.screenshot({ path: shot, fullPage: true })
    report.push({
      id: route.id,
      kind: route.kind,
      url: route.url,
      viewport: viewport.name,
      overflowOk: !metrics.overflowX && metrics.clippedRight.length === 0,
      metrics,
      shot,
    })
    await page.close()
  }

  for (const fixture of FIXTURES) {
    const page = await browser.newPage({
      viewport: { width: viewport.width, height: viewport.height },
    })
    const url = `/dev?fixture=${fixture}`
    await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' })
    await page.waitForSelector('[data-testid="openimport-visual-fixture"]')
    const metrics = await measure(page)
    const shot = join(outDir, `fixture-${fixture}-${viewport.name}.png`)
    await page.screenshot({ path: shot, fullPage: true })
    const previewNeedsCards =
      viewport.name === '360' &&
      (fixture === 'preview-invalid' ||
        fixture === 'preview-valid' ||
        fixture === 'preview-truncated')
    const cardsVisible = await page.evaluate(() => {
      const el = document.querySelector('.oi-preview-cards')
      return el ? getComputedStyle(el).display !== 'none' : false
    })
    report.push({
      id: fixture,
      kind: 'fixture',
      url,
      viewport: viewport.name,
      overflowOk:
        !metrics.overflowX &&
        metrics.clippedRight.length === 0 &&
        (!previewNeedsCards || cardsVisible),
      metrics: { ...metrics, cardsVisible },
      shot,
    })
    await page.close()
  }
}

await browser.close()

const failed = report.filter((row) => !row.overflowOk)
writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
console.log(
  JSON.stringify(
    {
      total: report.length,
      overflowFailures: failed.length,
      byKind: {
        public: report.filter((row) => row.kind === 'public').length,
        harness: report.filter((row) => row.kind === 'harness').length,
        error: report.filter((row) => row.kind === 'error').length,
        fixture: report.filter((row) => row.kind === 'fixture').length,
      },
      failures: failed.map((row) => ({
        id: row.id,
        kind: row.kind,
        viewport: row.viewport,
      })),
      note: 'overflowOk is a gate, not aesthetic approval. Inspect PNGs manually.',
      outDir,
    },
    null,
    2,
  ),
)

if (failed.length > 0) {
  process.exit(1)
}
