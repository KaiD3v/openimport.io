import { describe, expect, it, vi } from 'vitest'
import { IMPORT_ID, IMPORT_TOKEN } from '../test/fixtures.ts'

describe('lab session Vite plugin', () => {
  it('applies only during vite serve', async () => {
    const { labSessionPlugin } = await import('../../vite-plugin-lab-session.ts')
    expect(labSessionPlugin().apply).toBe('serve')
    expect(labSessionPlugin().name).toBe('openimport-lab-session')
  })

  it('accepts loopback addresses only', async () => {
    const { isLoopbackAddress } = await import(
      '../../vite-plugin-lab-session.ts'
    )
    expect(isLoopbackAddress('127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('::1')).toBe(true)
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('10.0.0.2')).toBe(false)
    expect(isLoopbackAddress(undefined)).toBe(false)
  })

  it('passes through unrelated paths', async () => {
    const { handleLabSessionRequest } = await import(
      '../../vite-plugin-lab-session.ts'
    )
    const next = vi.fn()
    const res = mockResponse()
    await handleLabSessionRequest(
      mockRequest({ method: 'POST', url: '/dev', remoteAddress: '127.0.0.1' }),
      res,
      next,
    )
    expect(next).toHaveBeenCalledOnce()
    expect(res.ended).toBe(false)
  })

  it('returns 404 for non-POST lab-session requests', async () => {
    const { handleLabSessionRequest } = await import(
      '../../vite-plugin-lab-session.ts'
    )
    const next = vi.fn()
    const res = mockResponse()
    await handleLabSessionRequest(
      mockRequest({ method: 'GET', url: '/__openimport/lab-session' }),
      res,
      next,
    )
    expect(next).not.toHaveBeenCalled()
    expect(res.statusCode).toBe(404)
    expect(res.ended).toBe(true)
  })

  it('rejects non-loopback POST', async () => {
    const { handleLabSessionRequest } = await import(
      '../../vite-plugin-lab-session.ts'
    )
    const res = mockResponse()
    await handleLabSessionRequest(
      mockRequest({
        method: 'POST',
        url: '/__openimport/lab-session',
        remoteAddress: '8.8.8.8',
      }),
      res,
      vi.fn(),
    )
    expect(res.statusCode).toBe(403)
    expect(JSON.parse(String(res.body))).toEqual({
      message: 'Sessão de laboratório só está disponível em loopback.',
    })
  })

  it('returns credentials without a live key on success', async () => {
    const { handleLabSessionRequest } = await import(
      '../../vite-plugin-lab-session.ts'
    )
    const res = mockResponse()
    const create = vi.fn(async () => ({
      importId: IMPORT_ID,
      accessToken: IMPORT_TOKEN,
      expiresAt: '2026-09-05T16:00:00.000Z',
      templateId: '33333333-3333-4333-8333-333333333333',
    }))

    await handleLabSessionRequest(
      mockRequest({
        method: 'POST',
        url: '/__openimport/lab-session?x=1',
        remoteAddress: '::1',
      }),
      res,
      vi.fn(),
      { createLabSession: create },
    )

    expect(create).toHaveBeenCalledOnce()
    expect(res.statusCode).toBe(200)
    expect(res.headers['Cache-Control']).toBe('no-store')
    const body = JSON.parse(String(res.body))
    expect(body.importId).toBe(IMPORT_ID)
    expect(body.accessToken).toBe(IMPORT_TOKEN)
    expect(JSON.stringify(body)).not.toContain('oi_live_')
  })

  it('maps seed and network failures without logging secrets', async () => {
    const { handleLabSessionRequest, LabSessionError } = await import(
      '../../vite-plugin-lab-session.ts'
    )
    const log = vi.fn()

    const seedRes = mockResponse()
    await handleLabSessionRequest(
      mockRequest({ method: 'POST', url: '/__openimport/lab-session' }),
      seedRes,
      vi.fn(),
      {
        createLabSession: async () => {
          throw new LabSessionError('seed', `missing ${IMPORT_TOKEN}`)
        },
        log,
      },
    )
    expect(seedRes.statusCode).toBe(500)
    expect(JSON.parse(String(seedRes.body)).message).toMatch(/seed/i)
    expect(JSON.stringify(seedRes.body)).not.toContain(IMPORT_TOKEN)

    const netRes = mockResponse()
    await handleLabSessionRequest(
      mockRequest({ method: 'POST', url: '/__openimport/lab-session' }),
      netRes,
      vi.fn(),
      {
        createLabSession: async () => {
          throw new LabSessionError('network', 'Backend is not reachable.')
        },
        log,
      },
    )
    expect(netRes.statusCode).toBe(503)

    expect(log).toHaveBeenCalled()
    expect(JSON.stringify(log.mock.calls)).not.toContain(IMPORT_TOKEN)
  })
})

function mockRequest({
  method,
  url,
  remoteAddress = '127.0.0.1',
}: {
  method: string
  url: string
  remoteAddress?: string
}) {
  return {
    method,
    url,
    socket: { remoteAddress },
  }
}

function mockResponse() {
  const res: {
    statusCode: number
    headers: Record<string, string>
    body: string
    ended: boolean
    setHeader: (name: string, value: string) => void
    end: (chunk?: string) => void
  } = {
    statusCode: 200,
    headers: {},
    body: '',
    ended: false,
    setHeader(name, value) {
      this.headers[name] = value
    },
    end(chunk?: string) {
      res.body = chunk ?? ''
      res.ended = true
    },
  }
  return res
}
