import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GitHubLink } from './GitHubLink.tsx'

describe('GitHubLink', () => {
  it('renders nothing when the repository URL is not configured', () => {
    const { container } = render(<GitHubLink href={null} />)

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(container).not.toHaveTextContent(/repositório/i)
  })

  it('renders an external GitHub control when a valid URL is provided', () => {
    render(
      <GitHubLink href="https://github.com/acme/openimport">GitHub</GitHubLink>,
    )

    const link = screen.getByRole('link', {
      name: /repositório openimport no github/i,
    })
    expect(link).toHaveAttribute('href', 'https://github.com/acme/openimport')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
  })
})
