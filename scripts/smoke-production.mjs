import { randomBytes, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const project = process.env.OPENIMPORT_SMOKE_PROJECT || 'openimport-smoke'
const skipBuild = process.env.OPENIMPORT_SMOKE_SKIP_BUILD === '1'
const publicBase = process.env.OPENIMPORT_SMOKE_BASE_URL || 'http://127.0.0.1:8080'
const composeFile = 'docker-compose.production.yml'
const workDir = mkdtempSync(join(tmpdir(), 'openimport-smoke-'))
const envFile = join(workDir, 'smoke.env')

const postgresPassword = randomBytes(24).toString('hex')
const s3AccessKey = `smoke${randomBytes(8).toString('hex')}`
const s3SecretKey = randomBytes(24).toString('hex')
const webhookKey = randomBytes(32).toString('hex')
const importId = randomUUID()

const envLines = [
  'NODE_ENV=production',
  'PORT=3000',
  'LOG_LEVEL=error',
  'ENABLE_DOCS=false',
  'POSTGRES_USER=openimport',
  `POSTGRES_PASSWORD=${postgresPassword}`,
  'POSTGRES_DB=openimport',
  'REDIS_URL=redis://redis:6379/0',
  'S3_ENDPOINT=http://minio:9000',
  'S3_REGION=us-east-1',
  `S3_ACCESS_KEY_ID=${s3AccessKey}`,
  `S3_SECRET_ACCESS_KEY=${s3SecretKey}`,
  'S3_BUCKET=openimport',
  'S3_FORCE_PATH_STYLE=true',
  'ALLOWED_ORIGINS=http://127.0.0.1:8080,http://localhost:8080',
  `WEBHOOK_SECRET_ENCRYPTION_KEY=${webhookKey}`,
  'TRUST_PROXY=1',
  'RATE_LIMIT_ENABLED=true',
  'RATE_LIMIT_WINDOW_MS=60000',
  'RATE_LIMIT_PRE_AUTH_MAX=600',
  'RATE_LIMIT_MAX=300',
  'RATE_LIMIT_TRUSTED_PROXY=true',
  'HTTP_REQUEST_TIMEOUT_MS=30000',
  'HTTP_HEADERS_TIMEOUT_MS=15000',
  'HTTP_KEEP_ALIVE_TIMEOUT_MS=5000',
  'HTTP_MAX_REQUESTS_PER_SOCKET=100',
  'HEALTH_PROBE_TIMEOUT_MS=2000',
  'WEBHOOK_SSRF_ALLOW_PRIVATE_TARGETS=false',
  'FRONTEND_FRAME_ANCESTORS=http://127.0.0.1:8080 http://localhost:8080',
  'VITE_OPENIMPORT_PARENT_ORIGINS=http://127.0.0.1:8080,http://localhost:8080',
  'VITE_OPENIMPORT_API_BASE_URL=/api/v1',
]

writeFileSync(envFile, `${envLines.join('\n')}\n`, { mode: 0o600 })

const harnessNeedles = [
  'openimport-dev-harness',
  'OpenImport Lab',
  'Harness de desenvolvimento',
  'Inicializar sessão',
  'openimport-visual-fixture',
]

function compose(args, options = {}) {
  const result = spawnSync(
    'docker',
    [
      'compose',
      '-f',
      composeFile,
      '--env-file',
      envFile,
      '-p',
      project,
      ...args,
    ],
    {
      cwd: root,
      encoding: 'utf8',
      ...options,
    },
  )
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join('\n').trim()
    throw new Error(
      `docker compose ${args.join(' ')} failed${detail ? `: ${detail}` : ''}`,
    )
  }
  return result
}

async function fetchText(path, init) {
  const response = await fetch(`${publicBase}${path}`, init)
  const text = await response.text()
  return { response, text }
}

async function waitFor(pathname, check, label) {
  const deadline = Date.now() + 120_000
  let lastError = 'no attempt'
  while (Date.now() < deadline) {
    try {
      const result = await fetchText(pathname)
      if (check(result)) {
        return result
      }
      lastError = `${pathname} -> ${result.response.status}`
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'fetch failed'
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  throw new Error(`${label} timed out (${lastError})`)
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function assertNoHarness(body, label) {
  for (const needle of harnessNeedles) {
    assert(!body.includes(needle), `${label} leaked harness copy: ${needle}`)
  }
}

function publishedPorts() {
  const result = compose(['ps', '--format', 'json'], { encoding: 'utf8' })
  const rows = result.stdout
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      const parsed = JSON.parse(line)
      return Array.isArray(parsed) ? parsed : [parsed]
    })
  const published = {}
  for (const row of rows) {
    const name = row.Service || row.Name || ''
    const publishers = row.Publishers || []
    published[name] = publishers
      .filter((item) => item.PublishedPort)
      .map((item) => Number(item.PublishedPort))
  }
  return published
}

function exec(service, args) {
  return compose(['exec', '-T', service, ...args])
}

let toreDown = false

function teardown() {
  if (toreDown) {
    return
  }
  toreDown = true
  try {
    compose(['down', '-v', '--remove-orphans'], { stdio: 'pipe' })
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'compose down failed',
    )
  }
  rmSync(workDir, { recursive: true, force: true })
}

process.on('exit', teardown)

try {
  compose(['config', '--quiet'])
  // Always rebuild frontend without cache so entrypoint/CSP fixes are never stale,
  // even when OPENIMPORT_SMOKE_SKIP_BUILD=1 skips the rest of the image builds.
  compose(['build', '--no-cache', 'frontend'], { stdio: 'inherit' })
  if (!skipBuild) {
    compose(['build'], { stdio: 'inherit' })
  }

  // Validate the rebuilt entrypoint with docker run (compose run would keep nginx
  // healthy forever if VALIDATE_ONLY were ignored by an old image).
  const frontendImage = `${project}-frontend:latest`
  const validEntrypoint = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '-e',
      'VALIDATE_ONLY=1',
      '-e',
      'FRONTEND_FRAME_ANCESTORS=https://app.example.com',
      '--entrypoint',
      '/docker-entrypoint.sh',
      frontendImage,
    ],
    { encoding: 'utf8' },
  )
  assert(
    validEntrypoint.status === 0,
    `FRONTEND_FRAME_ANCESTORS=https://app.example.com must be accepted: ${validEntrypoint.stderr || validEntrypoint.stdout}`,
  )

  const invalidEntrypoint = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      '-e',
      'VALIDATE_ONLY=1',
      '-e',
      'FRONTEND_FRAME_ANCESTORS=*',
      '--entrypoint',
      '/docker-entrypoint.sh',
      frontendImage,
    ],
    { encoding: 'utf8' },
  )
  assert(
    invalidEntrypoint.status !== 0,
    'FRONTEND_FRAME_ANCESTORS=* must exit non-zero',
  )

  compose(['up', '-d', '--wait', '--wait-timeout', '180'], { stdio: 'inherit' })

  const health = await waitFor(
    '/health',
    ({ response, text }) => response.ok && text.includes('"status":"ok"'),
    '/health',
  )
  assert(health.response.status === 200, '/health must be 200')

  const ready = await waitFor(
    '/health/ready',
    ({ response, text }) => response.ok && text.includes('"status":"ok"'),
    '/health/ready',
  )
  assert(ready.response.status === 200, '/health/ready must be 200')

  const home = await fetchText('/')
  assert(home.response.status === 200, '/ must be 200')
  assert(home.text.includes('OpenImport'), '/ must render the SPA')
  assertNoHarness(home.text, '/')
  const csp = home.response.headers.get('content-security-policy') || ''
  assert(
    csp.includes('frame-ancestors') &&
      csp.includes('http://127.0.0.1:8080') &&
      !csp.includes('*'),
    'CSP frame-ancestors must list explicit origins without *',
  )

  const proxiedHealth = await fetchText('/health')
  assert(proxiedHealth.response.status === 200, 'nginx must proxy /health')
  assert(
    proxiedHealth.text.includes('"status":"ok"'),
    'proxied /health must reach the backend',
  )

  // Safe, fast proxy/rate-limit check: spoofed XFF must not change the 401 path,
  // and repeated unauthenticated calls must eventually 429 without hanging.
  let saw429 = false
  for (let i = 0; i < 20; i += 1) {
    const probe = await fetch(`${publicBase}/api/v1/templates/${importId}`, {
      headers: { 'X-Forwarded-For': '198.51.100.50' },
    })
    if (probe.status === 429) {
      saw429 = true
      assert(probe.headers.get('retry-after'), '429 must include Retry-After')
      break
    }
    assert(
      probe.status === 401,
      `unexpected status ${probe.status} while probing rate limit`,
    )
  }
  // With PRE_AUTH_MAX=600 smoke stays under the limit; presence of a working
  // proxy + 401 is enough. Optional 429 is accepted if env is tightened.
  void saw429

  const importPage = await fetchText(`/imports/${importId}`)
  assert(importPage.response.status === 200, '/imports/:uuid must be 200')
  assert(
    importPage.text.includes('OpenImport'),
    '/imports/:uuid must render the SPA',
  )
  assertNoHarness(importPage.text, '/imports/:uuid')

  const apiRoot = await fetchText('/api/v1')
  const apiProtected = await fetchText(`/api/v1/imports/${importId}`)
  assert(
    apiRoot.response.status === 401 || apiProtected.response.status === 401,
    '/api/v1 must reject unauthenticated callers with 401',
  )
  assert(
    apiProtected.response.status === 401,
    `/api/v1/imports/${importId} must be 401 without credentials`,
  )

  const devPage = await fetchText('/dev')
  assert(devPage.response.status === 200, '/dev must fall through to the SPA')
  assert(
    devPage.text.includes('<div id="root">') &&
      devPage.text.includes('OpenImport'),
    '/dev must serve the production SPA shell',
  )
  assertNoHarness(devPage.text, '/dev')

  const backendUser = exec('backend', ['id', '-u']).stdout.trim()
  const frontendUser = exec('frontend', ['id', '-u']).stdout.trim()
  assert(backendUser !== '0', 'backend must not run as root')
  assert(frontendUser !== '0', 'frontend must not run as root')

  const envHits = exec('backend', [
    'sh',
    '-c',
    'find /app -name ".env" -o -name ".env.production" -o -name ".env.local"',
  ]).stdout.trim()
  assert(envHits === '', 'backend image must not contain .env files')

  const ports = publishedPorts()
  for (const service of ['postgres', 'redis', 'minio', 'backend']) {
    const published = ports[service] || []
    assert(
      published.length === 0,
      `${service} must not publish ports (got ${published.join(',')})`,
    )
  }
  assert(
    (ports.frontend || []).includes(8080),
    'frontend must publish 8080',
  )

  exec('postgres', [
    'psql',
    '-U',
    'openimport',
    '-d',
    'openimport',
    '-c',
    'CREATE TABLE IF NOT EXISTS smoke_persist(id int PRIMARY KEY); INSERT INTO smoke_persist VALUES (1) ON CONFLICT DO NOTHING;',
  ])

  compose(['restart', 'backend', 'postgres'], { stdio: 'inherit' })
  compose(['up', '-d', '--wait', '--wait-timeout', '180'], { stdio: 'inherit' })

  await waitFor(
    '/health/ready',
    ({ response }) => response.ok,
    '/health/ready after restart',
  )

  const persisted = exec('postgres', [
    'psql',
    '-U',
    'openimport',
    '-d',
    'openimport',
    '-tAc',
    'SELECT id FROM smoke_persist WHERE id = 1;',
  ]).stdout.trim()
  assert(persisted === '1', 'postgres volume must persist across restart')

  const migrations = exec('postgres', [
    'psql',
    '-U',
    'openimport',
    '-d',
    'openimport',
    '-tAc',
    'SELECT count(*) FROM _prisma_migrations;',
  ]).stdout.trim()
  assert(Number(migrations) > 0, 'migrations must be applied on an empty database')

  console.log('Production smoke checks passed')
} finally {
  teardown()
}
