import { describe, expect, it, vi } from 'vitest'
import { readHashId, scrollToHashTarget } from './scroll-to-hash.ts'

describe('scrollToHashTarget', () => {
  it('reads a bare id from location.hash forms', () => {
    expect(readHashId('#passo-4-iframe')).toBe('passo-4-iframe')
    expect(readHashId('passo-4-iframe')).toBe('passo-4-iframe')
    expect(readHashId('#')).toBeNull()
    expect(readHashId('')).toBeNull()
  })

  it('scrolls when the target exists and returns false otherwise', () => {
    const scrollIntoView = vi.fn()
    const el = { scrollIntoView } as unknown as HTMLElement
    const doc = {
      getElementById: (id: string) => (id === 'passo-4-iframe' ? el : null),
    }

    expect(scrollToHashTarget('#passo-4-iframe', doc)).toBe(true)
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'auto',
      block: 'start',
    })
    expect(scrollToHashTarget('#missing', doc)).toBe(false)
    expect(scrollToHashTarget('', doc)).toBe(false)
  })
})
