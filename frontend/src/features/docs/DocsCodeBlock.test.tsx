import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocsCodeBlock } from './DocsCodeBlock.tsx'

describe('DocsCodeBlock', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('renders a Typescript terminal legend and highlighted keywords', () => {
    render(<DocsCodeBlock code={'const ready = true\n'} />)
    expect(screen.getByText('Typescript')).toBeInTheDocument()
    expect(
      screen.getByRole('button', {
        name: /copiar para a área de transferência/i,
      }),
    ).toBeInTheDocument()
    const keyword = document.querySelector('.oi-syn-keyword')
    expect(keyword).toHaveTextContent('const')
  })

  it('copies the raw source to the clipboard', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', {
      ...navigator,
      clipboard: { writeText },
    })

    render(<DocsCodeBlock code={'export const n = 1\n'} />)
    await user.click(
      screen.getByRole('button', {
        name: /copiar para a área de transferência/i,
      }),
    )
    expect(writeText).toHaveBeenCalledWith('export const n = 1\n')
    expect(
      await screen.findByRole('button', {
        name: /copiado para a área de transferência/i,
      }),
    ).toBeInTheDocument()
  })
})
