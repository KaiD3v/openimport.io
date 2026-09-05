import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { validateFrameAncestors } from '../../scripts/validate-frame-ancestors.mjs'

const entrypointPath = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../docker-entrypoint.sh',
)

function resolveSh(): string {
  const fromPath = spawnSync('sh', ['-c', 'exit 0'], { encoding: 'utf8' })
  if (!fromPath.error) {
    return 'sh'
  }
  const candidates = [
    'C:\\Program Files\\Git\\bin\\sh.exe',
    'C:\\Program Files\\Git\\usr\\bin\\sh.exe',
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }
  throw new Error(
    'sh is required to execute docker-entrypoint.sh (install Git Bash or run on Linux/CI)',
  )
}

function runEntrypoint(value: string | undefined) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    VALIDATE_ONLY: '1',
  }
  if (value === undefined) {
    delete env.FRONTEND_FRAME_ANCESTORS
  } else {
    env.FRONTEND_FRAME_ANCESTORS = value
  }
  return spawnSync(resolveSh(), [entrypointPath], {
    env,
    encoding: 'utf8',
  })
}

describe('validateFrameAncestors', () => {
  it('accepts self, absolute origins, ports, and lone none', () => {
    expect(validateFrameAncestors('https://app.example.com')).toEqual({
      ok: true,
      tokens: ['https://app.example.com'],
    })
    expect(validateFrameAncestors('https://app.example.com:8443')).toEqual({
      ok: true,
      tokens: ['https://app.example.com:8443'],
    })
    expect(validateFrameAncestors("'self' https://app.example.com")).toEqual({
      ok: true,
      tokens: ["'self'", 'https://app.example.com'],
    })
    expect(validateFrameAncestors("'none'")).toEqual({
      ok: true,
      tokens: ["'none'"],
    })
  })

  it('rejects wildcards, separators, schemes, path, credentials, and none mixes', () => {
    expect(validateFrameAncestors('')).toMatchObject({ ok: false, reason: 'empty' })
    expect(validateFrameAncestors('*')).toMatchObject({ ok: false, reason: 'wildcard' })
    expect(validateFrameAncestors('https://*.example.com')).toMatchObject({
      ok: false,
      reason: 'wildcard',
    })
    expect(validateFrameAncestors("https://a.com; default-src 'none'")).toMatchObject({
      ok: false,
      reason: 'forbidden_chars',
    })
    expect(validateFrameAncestors('https://a.com\nhttps://b.com')).toMatchObject({
      ok: false,
      reason: 'forbidden_chars',
    })
    expect(validateFrameAncestors('https:')).toMatchObject({
      ok: false,
      reason: 'broad_scheme',
    })
    expect(validateFrameAncestors('https://app.example.com/path')).toMatchObject({
      ok: false,
      reason: 'not_origin',
    })
    expect(validateFrameAncestors('https://app.example.com?x=1')).toMatchObject({
      ok: false,
      reason: 'not_origin',
    })
    expect(validateFrameAncestors('https://app.example.com#frag')).toMatchObject({
      ok: false,
      reason: 'not_origin',
    })
    expect(
      validateFrameAncestors('https://user:pass@app.example.com'),
    ).toMatchObject({ ok: false, reason: 'not_origin' })
    expect(validateFrameAncestors("'none' https://app.example.com")).toMatchObject({
      ok: false,
      reason: 'none_must_be_alone',
    })
  })
})

describe('docker-entrypoint.sh frame-ancestors validation', () => {
  it('accepts https://app.example.com via the real entrypoint', () => {
    const result = runEntrypoint('https://app.example.com')
    expect(result.error, result.stderr || result.error?.message).toBeUndefined()
    expect(result.status).toBe(0)
  })

  it('accepts the same cases as the JS validator', () => {
    for (const value of [
      'https://app.example.com:8443',
      "'self' https://app.example.com",
      "'none'",
    ]) {
      const result = runEntrypoint(value)
      expect(result.status, `${value} stderr=${result.stderr}`).toBe(0)
    }
  })

  it('rejects invalid values with non-zero exit', () => {
    for (const value of [
      '',
      '*',
      'https://*.example.com',
      "https://a.com; default-src 'none'",
      'https:',
      'https://app.example.com/path',
      'https://app.example.com?x=1',
      'https://app.example.com#frag',
      'https://user:pass@app.example.com',
      "'none' https://app.example.com",
    ]) {
      const result = runEntrypoint(value)
      expect(result.status, `expected fail for ${JSON.stringify(value)}`).not.toBe(0)
    }
  })

  it('rejects real LF, CR, and CRLF via the real entrypoint', () => {
    for (const value of [
      'https://a.example\nhttps://b.example',
      'https://a.example\rhttps://b.example',
      'https://a.example\r\nhttps://b.example',
    ]) {
      const result = runEntrypoint(value)
      expect(
        result.status,
        `expected fail for ${JSON.stringify(value)} stderr=${result.stderr}`,
      ).not.toBe(0)
    }
  })
})
