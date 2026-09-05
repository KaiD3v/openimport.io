import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LIVE_API_KEY, IMPORT_ID, IMPORT_TOKEN } from '../test/fixtures.ts'

const TEMPLATE_ID = '33333333-3333-4333-8333-333333333333'
const EXPIRES_AT = '2026-09-05T16:00:00.000Z'

const templateBody = JSON.parse(
  readFileSync(
    join(
      dirname(fileURLToPath(import.meta.url)),
      '../../../backend/docs/examples/products-template.json',
    ),
    'utf8',
  ),
) as { name: string; fields: unknown }

describe('createLabSession', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.resetModules()
  })

  it('posts template, import, and access-token without returning the live key', async () => {
    const calls: Array<{
      url: string
      method: string | undefined
      authorization: string | undefined
      contentType: string | undefined
      idempotency: string | undefined
      body: unknown
    }> = []
    const fetchImpl = async (url: string, init?: {
      method?: string
      headers?: Record<string, string>
      body?: string
    }) => {
      calls.push({
        url: String(url),
        method: init?.method,
        authorization: init?.headers?.Authorization,
        contentType: init?.headers?.['Content-Type'],
        idempotency: init?.headers?.['Idempotency-Key'],
        body: init?.body ? JSON.parse(init.body) : null,
      })
      if (String(url).endsWith('/templates')) {
        return jsonResponse({ id: TEMPLATE_ID })
      }
      if (String(url).endsWith('/imports')) {
        return jsonResponse({ id: IMPORT_ID })
      }
      if (String(url).endsWith(`/imports/${IMPORT_ID}/access-tokens`)) {
        return jsonResponse({
          accessToken: IMPORT_TOKEN,
          tokenType: 'Bearer',
          importId: IMPORT_ID,
          expiresAt: EXPIRES_AT,
        })
      }
      throw new Error(`unexpected ${url}`)
    }

    const { createLabSession } = await import(
      '../../scripts/create-lab-session.mjs'
    )
    const result = await createLabSession({
      apiKey: LIVE_API_KEY,
      templateBody,
      fetchImpl,
      now: () => 1_704_000_000_000,
      randomUUID: () => '11111111-1111-4111-8111-111111111111',
    })

    expect(calls).toHaveLength(3)
    expect(calls[0]).toMatchObject({
      url: 'http://localhost:3000/api/v1/templates',
      method: 'POST',
      authorization: `Bearer ${LIVE_API_KEY}`,
      body: {
        name: `${templateBody.name} lab 1704000000000`,
        fields: templateBody.fields,
      },
    })
    expect(calls[1]).toMatchObject({
      url: 'http://localhost:3000/api/v1/imports',
      method: 'POST',
      idempotency: 'lab-11111111-1111-4111-8111-111111111111',
      body: { templateId: TEMPLATE_ID },
    })
    expect(calls[2]).toMatchObject({
      url: `http://localhost:3000/api/v1/imports/${IMPORT_ID}/access-tokens`,
      method: 'POST',
      body: { expiresInSeconds: 1800 },
    })
    expect(result).toEqual({
      importId: IMPORT_ID,
      accessToken: IMPORT_TOKEN,
      expiresAt: EXPIRES_AT,
      templateId: TEMPLATE_ID,
    })
    expect(JSON.stringify(result)).not.toContain('oi_live_')
    expect(JSON.stringify(result)).not.toContain(LIVE_API_KEY)
  })

  it('uses a fresh template name and idempotency key on each call', async () => {
    const names: string[] = []
    const keys: Array<string | undefined> = []
    const fetchImpl = async (
      url: string,
      init?: { headers?: Record<string, string>; body?: string },
    ) => {
      const body = init?.body ? JSON.parse(init.body) : null
      if (String(url).endsWith('/templates')) {
        names.push(body.name)
        return jsonResponse({ id: TEMPLATE_ID })
      }
      if (String(url).endsWith('/imports')) {
        keys.push(init?.headers?.['Idempotency-Key'])
        return jsonResponse({ id: IMPORT_ID })
      }
      return jsonResponse({
        accessToken: IMPORT_TOKEN,
        expiresAt: EXPIRES_AT,
      })
    }

    const { createLabSession } = await import(
      '../../scripts/create-lab-session.mjs'
    )
    await createLabSession({
      apiKey: LIVE_API_KEY,
      templateBody,
      fetchImpl,
      now: () => 1,
      randomUUID: () => 'aaa',
    })
    await createLabSession({
      apiKey: LIVE_API_KEY,
      templateBody,
      fetchImpl,
      now: () => 2,
      randomUUID: () => 'bbb',
    })

    expect(names).toEqual([
      `${templateBody.name} lab 1`,
      `${templateBody.name} lab 2`,
    ])
    expect(keys).toEqual(['lab-aaa', 'lab-bbb'])
  })

  it('rejects a live key returned as an access token', async () => {
    const fetchImpl = async (url: string) => {
      if (String(url).endsWith('/templates')) {
        return jsonResponse({ id: TEMPLATE_ID })
      }
      if (String(url).endsWith('/imports')) {
        return jsonResponse({ id: IMPORT_ID })
      }
      return jsonResponse({
        accessToken: LIVE_API_KEY,
        expiresAt: EXPIRES_AT,
      })
    }

    const { createLabSession, LabSessionError } = await import(
      '../../scripts/create-lab-session.mjs'
    )
    await expect(
      createLabSession({
        apiKey: LIVE_API_KEY,
        templateBody,
        fetchImpl,
      }),
    ).rejects.toMatchObject({
      name: LabSessionError.name,
      code: 'invalid_token',
    })
  })
})

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  }
}
