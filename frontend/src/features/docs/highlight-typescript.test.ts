import { describe, expect, it } from 'vitest'
import { highlightTypescriptCode } from './highlight-typescript.ts'

describe('highlightTypescriptCode', () => {
  it('marks keywords, strings, comments and numbers', () => {
    const tokens = highlightTypescriptCode(
      `// host only\nconst x = 42\nexport async function oi(path) {\n  return "ok"\n}`,
    )
    const joined = tokens.map((t) => `${t.kind}:${t.text}`).join('|')
    expect(joined).toContain('comment:// host only')
    expect(joined).toContain('keyword:const')
    expect(joined).toContain('number:42')
    expect(joined).toContain('keyword:export')
    expect(joined).toContain('keyword:async')
    expect(joined).toContain('keyword:function')
    expect(joined).toContain('function:oi')
    expect(joined).toContain('string:"ok"')
  })

  it('keeps template literals as strings', () => {
    const tokens = highlightTypescriptCode('`Bearer ${KEY}`')
    expect(tokens.some((t) => t.kind === 'string' && t.text.includes('Bearer'))).toBe(
      true,
    )
  })
})
