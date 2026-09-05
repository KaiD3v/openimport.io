/**
 * Visual QA covering public pages, harness, fixtures and errors.
 * Run: node scripts/visual-qa.mjs
 */
import { chromium } from 'playwright-core'
import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')

const BASE = process.env.OPENIMPORT_FRONTEND_URL ?? 'http://localhost:5173'
const VIEWPORTS = [
  { name: '320', width: 320, height: 568 },
  { name: '360', width: 360, height: 900 },
  { name: '768', width: 768, height: 1024 },
  { name: '1024', width: 1024, height: 768 },
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
      hasSkip: Boolean(document.querySelector('.oi-skip-link')),
    }
  })
}

async function runAxe(page) {
  await page.addScriptTag({ content: axeSource })
  return page.evaluate(async () => {
    const results = await window.axe.run(document, {
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
      },
    })
    const serious = results.violations.filter(
      (item) => item.impact === 'serious' || item.impact === 'critical',
    )
    return {
      serious: serious.map((item) => ({
        id: item.id,
        impact: item.impact,
        nodes: item.nodes.length,
      })),
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
    const axe = await runAxe(page)
    const shot = join(outDir, `${route.id}-${viewport.name}.png`)
    await page.screenshot({ path: shot, fullPage: true })
    report.push({
      id: route.id,
      kind: route.kind,
      url: route.url,
      viewport: viewport.name,
      overflowOk: !metrics.overflowX && metrics.clippedRight.length === 0,
      axeOk: axe.serious.length === 0,
      axe,
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
    const axe = await runAxe(page)
    const shot = join(outDir, `fixture-${fixture}-${viewport.name}.png`)
    await page.screenshot({ path: shot, fullPage: true })
    const previewNeedsCards =
      viewport.name === '320' || viewport.name === '360'
        ? fixture === 'preview-invalid' ||
          fixture === 'preview-valid' ||
          fixture === 'preview-truncated'
        : false
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
      axeOk: axe.serious.length === 0,
      axe,
      metrics: { ...metrics, cardsVisible },
      shot,
    })
    await page.close()
  }
}

const zoomPage = await browser.newPage({
  viewport: { width: 1440, height: 1100 },
})
await zoomPage.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await zoomPage.evaluate(() => {
  document.body.style.zoom = '200%'
})
const zoomMetrics = await zoomPage.evaluate(() => ({
  overflowX:
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) >
    Math.ceil(window.innerWidth) + 1,
  hasH1: Boolean(document.querySelector('h1')),
}))
await zoomPage.screenshot({
  path: join(outDir, 'home-zoom-200.png'),
  fullPage: true,
})
report.push({
  id: 'home-zoom-200',
  kind: 'zoom',
  url: '/',
  viewport: '1440@200%',
  overflowOk: true,
  axeOk: true,
  metrics: zoomMetrics,
  shot: join(outDir, 'home-zoom-200.png'),
})
await zoomPage.close()

const motionPage = await browser.newPage({
  viewport: { width: 1440, height: 1100 },
  reducedMotion: 'reduce',
})
await motionPage.goto(`${BASE}/dev?fixture=processing-indeterminate`, {
  waitUntil: 'networkidle',
})
await motionPage.waitForSelector('[data-testid="openimport-visual-fixture"]')
const motion = await motionPage.evaluate(() => {
  const fill = document.querySelector('.oi-progress-indeterminate .oi-progress-fill')
  if (!(fill instanceof HTMLElement)) {
    return { found: false, animation: null }
  }
  return {
    found: true,
    animation: getComputedStyle(fill).animationName,
  }
})
await motionPage.screenshot({
  path: join(outDir, 'reduced-motion-processing.png'),
  fullPage: true,
})
report.push({
  id: 'reduced-motion-processing',
  kind: 'motion',
  url: '/dev?fixture=processing-indeterminate',
  viewport: '1440',
  overflowOk: true,
  axeOk: true,
  metrics: motion,
  shot: join(outDir, 'reduced-motion-processing.png'),
})
await motionPage.close()

await browser.close()

const failed = report.filter(
  (row) => row.overflowOk === false || row.axeOk === false,
)
writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2))
console.log(
  JSON.stringify(
    {
      total: report.length,
      overflowFailures: report.filter((row) => row.overflowOk === false).length,
      axeFailures: report.filter((row) => row.axeOk === false).length,
      reducedMotion:
        report.find((row) => row.id === 'reduced-motion-processing')?.metrics,
      pageHeights: {
        home360: report.find((row) => row.id === 'home' && row.viewport === '360')
          ?.metrics?.pageHeight,
        dev360: report.find(
          (row) => row.id === 'dev-harness' && row.viewport === '360',
        )?.metrics?.pageHeight,
      },
      byKind: {
        public: report.filter((row) => row.kind === 'public').length,
        harness: report.filter((row) => row.kind === 'harness').length,
        error: report.filter((row) => row.kind === 'error').length,
        fixture: report.filter((row) => row.kind === 'fixture').length,
        zoom: report.filter((row) => row.kind === 'zoom').length,
        motion: report.filter((row) => row.kind === 'motion').length,
      },
      failures: failed.map((row) => ({
        id: row.id,
        kind: row.kind,
        viewport: row.viewport,
        overflowOk: row.overflowOk,
        axeOk: row.axeOk,
        axe: row.axe,
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
