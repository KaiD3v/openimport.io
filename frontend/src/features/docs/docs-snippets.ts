/** Copy-paste snippets for the public /docs integration guide (Node + browser). */

export const SNIPPET_ENV = `OPENIMPORT_API_BASE_URL=http://localhost:3000/api/v1
OPENIMPORT_API_KEY=oi_live_<64 hex minúsculos>
OPENIMPORT_UI_ORIGIN=http://localhost:5173
OPENIMPORT_TEMPLATE_ID=<uuid do template>`

export const SNIPPET_CLIENT = `// openimport-client.mjs — só no servidor do host
const API = process.env.OPENIMPORT_API_BASE_URL.replace(/\\/$/, '')
const KEY = process.env.OPENIMPORT_API_KEY

export async function oi(path, { method = 'GET', body, idempotencyKey } = {}) {
  const headers = {
    Authorization: \`Bearer \${KEY}\`,
    Accept: 'application/json',
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey

  const res = await fetch(\`\${API}\${path}\`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    const code = json?.code ? \` \${json.code}\` : ''
    throw new Error(\`\${method} \${path} -> \${res.status}\${code}\`)
  }
  return json
}`

export const SNIPPET_TEMPLATE = `// Passo 1 — só no servidor (uma vez por schema)
const template = await oi('/templates', {
  method: 'POST',
  body: {
    name: 'Produtos',
    fields: [
      { key: 'sku', label: 'SKU', type: 'string', required: true },
      { key: 'stock', label: 'Estoque', type: 'integer', required: false },
      { key: 'priceInCents', label: 'Preço', type: 'currency', required: true },
    ],
  },
})
// Guarde template.id na sua base. Não há listagem de templates.
console.log(template.id)`

export const SNIPPET_SESSION = `// Passo 2 — só no servidor (por importação do usuário)
const session = await oi('/imports', {
  method: 'POST',
  idempotencyKey: 'user-42-products-2026-09-05', // 8–128 chars [A-Za-z0-9._-]
  body: { templateId: process.env.OPENIMPORT_TEMPLATE_ID },
})

const token = await oi(\`/imports/\${session.id}/access-tokens\`, {
  method: 'POST',
  body: { expiresInSeconds: 1800 }, // 60–3600; padrão 1800
})
// accessToken (oi_import_…) aparece SÓ nesta resposta.
const boot = {
  importId: session.id,
  accessToken: token.accessToken,
  expiresAt: token.expiresAt,
  iframeUrl: \`\${process.env.OPENIMPORT_UI_ORIGIN}/imports/\${session.id}\`,
}`

export const SNIPPET_HOST_ROUTE = `// Passo 3 — rota autenticada do SEU backend (Express de exemplo)
import express from 'express'
// ... importe oi() e a lógica de sessão acima

app.post('/api/imports/start', requireAuth, async (req, res) => {
  const session = await oi('/imports', {
    method: 'POST',
    idempotencyKey: \`user-\${req.user.id}-products-\${Date.now()}\`,
    body: { templateId: process.env.OPENIMPORT_TEMPLATE_ID },
  })
  const token = await oi(\`/imports/\${session.id}/access-tokens\`, {
    method: 'POST',
    body: { expiresInSeconds: 1800 },
  })
  res.set('Cache-Control', 'no-store')
  res.json({
    importId: session.id,
    accessToken: token.accessToken,
    iframeUrl: \`\${process.env.OPENIMPORT_UI_ORIGIN}/imports/\${session.id}\`,
  })
})
// Nunca coloque oi_live_ no frontend. Nunca ponha o token na URL.`

export const SNIPPET_IFRAME = `// Passo 4 — só no browser do host (React de exemplo)
import { useEffect, useRef, useState } from 'react'

const OPENIMPORT_ORIGIN = 'http://localhost:5173' // origem do iframe OpenImport

export function ImportWorkbench() {
  const iframeRef = useRef(null)
  const [session, setSession] = useState(null)
  const [status, setStatus] = useState('idle')

  useEffect(() => {
    fetch('/api/imports/start', { method: 'POST' })
      .then((r) => r.json())
      .then(setSession)
  }, [])

  useEffect(() => {
    function onMessage(event) {
      if (event.origin !== OPENIMPORT_ORIGIN) return
      if (event.source !== iframeRef.current?.contentWindow) return
      if (!event.data || typeof event.data !== 'object') return
      const { type, code } = event.data
      if (type === 'openimport.ready') setStatus('token-accepted')
      if (type === 'openimport.loaded') setStatus('workbench-ready')
      if (type === 'openimport.error') setStatus(\`error:\${code ?? 'unknown'}\`)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  function initialize() {
    const frame = iframeRef.current?.contentWindow
    if (!frame || !session) return
    frame.postMessage(
      {
        type: 'openimport.initialize',
        version: 1,
        importId: session.importId,
        accessToken: session.accessToken,
      },
      OPENIMPORT_ORIGIN, // nunca '*'
    )
  }

  if (!session) return <p>Preparando sessão…</p>
  return (
    <iframe
      ref={iframeRef}
      title="OpenImport"
      src={session.iframeUrl}
      style={{ width: '100%', height: '70vh', border: 0 }}
      onLoad={initialize}
    />
  )
}`

export const SNIPPET_CONSUME = `// Passo 6 — só no servidor do host
async function waitUntilReady(importId) {
  for (;;) {
    const s = await oi(\`/imports/\${importId}\`)
    if (s.status === 'ready') return s
    if (s.status === 'processing_failed') throw new Error('processing_failed')
    await new Promise((r) => setTimeout(r, 500))
  }
}

async function pullAndApply(importId, upsertProduct) {
  await waitUntilReady(importId)

  let after = null
  let executionId
  const results = []

  do {
    const q = new URLSearchParams({ limit: '50' })
    if (after) q.set('after', after)
    const page = await oi(\`/imports/\${importId}/valid-rows?\${q}\`)
    executionId = page.executionId

    for (const row of page.data) {
      try {
        const id = await upsertProduct(row.data)
        results.push({
          recordNumber: row.recordNumber,
          outcome: 'accepted',
          clientRecordId: id,
        })
      } catch (err) {
        results.push({
          recordNumber: row.recordNumber,
          outcome: 'rejected',
          error: {
            code: 'HOST.UPSERT_FAILED',
            message: err instanceof Error ? err.message : 'failed',
          },
        })
      }
    }
    after = page.nextCursor
  } while (after)

  if (!executionId || results.length === 0) return

  // Máximo 100 itens por POST; use Idempotency-Key estável por lote
  await oi(\`/imports/\${importId}/results\`, {
    method: 'POST',
    idempotencyKey: \`host-results-\${importId}-\${executionId}\`,
    body: { executionId, results: results.slice(0, 100) },
  })
}`

export const SNIPPET_WEBHOOK = `// Opcional — verificar webhook import.ready (body cru, não re-serializar JSON)
import { createHmac, timingSafeEqual } from 'node:crypto'

export function verifyOpenImportWebhook(rawBody, headers, secret) {
  const timestamp = String(headers['openimport-timestamp'] ?? '')
  const signature = String(headers['openimport-signature'] ?? '')
  const match = /^v1=([0-9a-f]+)$/i.exec(signature)
  if (!match) throw new Error('invalid signature header')

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp))
  if (!Number.isFinite(age) || age > 300) throw new Error('timestamp skew')

  const expected = createHmac('sha256', secret)
    .update(\`\${timestamp}.\${rawBody}\`)
    .digest('hex')
  const a = Buffer.from(expected, 'utf8')
  const b = Buffer.from(match[1].toLowerCase(), 'utf8')
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new Error('bad signature')
  }
  return JSON.parse(rawBody)
}
// Depois: GET .../valid-rows com oi_live_ (o webhook só traz contagens).`
