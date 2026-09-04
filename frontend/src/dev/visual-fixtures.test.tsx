import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { FixtureProviders, FixtureStage } from './FixtureStage.tsx'
import { LoadedImportView } from '../features/import-context/LoadedImportView.tsx'
import { VISUAL_FIXTURES } from './visual-fixtures.ts'

describe('visual fixtures', () => {
  it('exposes the required synthetic states for harness QA', () => {
    expect(VISUAL_FIXTURES.map((fixture) => fixture.id)).toEqual(
      expect.arrayContaining([
        'waiting',
        'loading',
        'created',
        'upload-selected',
        'upload-pending',
        'upload-recoverable-error',
        'upload-failed',
        'uploaded-incomplete',
        'uploaded-complete',
        'mapping-dirty',
        'mapping-conflict',
        'preview-loading',
        'preview-valid',
        'preview-invalid',
        'preview-truncated',
        'preview-unavailable',
        'token-expired',
        'long-labels',
      ]),
    )
  })

  it('renders upload_failed with accessible terminal messaging', () => {
    const fixture = VISUAL_FIXTURES.find((entry) => entry.id === 'upload-failed')
    if (!fixture || fixture.kind !== 'loaded') {
      throw new Error('missing fixture')
    }

    render(
      <FixtureProviders>
        <LoadedImportView
          context={fixture.context}
          apiBaseUrl="http://localhost:3000/api/v1"
          generation={1}
        />
      </FixtureProviders>,
    )

    expect(
      screen.getByRole('status', { name: /falha no envio/i }),
    ).toHaveTextContent(/não aceita novo arquivo/i)
    expect(
      screen.getByRole('navigation', { name: /falha|interromp/i }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /tentar novamente/i }),
    ).not.toBeInTheDocument()
  })

  it('renders long labels and mapping destinations', () => {
    const fixture = VISUAL_FIXTURES.find((entry) => entry.id === 'long-labels')
    if (!fixture || fixture.kind !== 'loaded') {
      throw new Error('missing fixture')
    }

    render(
      <FixtureProviders>
        <LoadedImportView
          context={fixture.context}
          apiBaseUrl="http://localhost:3000/api/v1"
          generation={1}
        />
      </FixtureProviders>,
    )

    expect(
      screen.getAllByText(/planilha-oficial-de-produtos-calcados/i).length,
    ).toBeGreaterThan(0)
    expect(
      screen.getAllByText(/codigo_sku_fornecedor_principal/i).length,
    ).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /salvar mapping/i })).toBeInTheDocument()
    expect(screen.getAllByText(/^Destino$/i).length).toBeGreaterThan(0)
  })

  it('shows upload controls for created sessions', () => {
    const fixture = VISUAL_FIXTURES.find((entry) => entry.id === 'created')
    if (!fixture || fixture.kind !== 'loaded') throw new Error('missing fixture')

    render(
      <FixtureProviders>
        <LoadedImportView
          context={fixture.context}
          apiBaseUrl="http://localhost:3000/api/v1"
          generation={1}
        />
      </FixtureProviders>,
    )

    expect(screen.getByLabelText(/escolher arquivo csv/i)).toBeInTheDocument()
  })

  it('renders shell fixtures for waiting and expired token', () => {
    const waiting = VISUAL_FIXTURES.find((entry) => entry.id === 'waiting')
    const expired = VISUAL_FIXTURES.find((entry) => entry.id === 'token-expired')
    if (!waiting || !expired) throw new Error('missing shell fixtures')

    const { rerender } = render(<FixtureStage fixture={waiting} />)
    expect(
      screen.getByRole('status', { name: /aguardando o sistema de origem/i }),
    ).toBeInTheDocument()

    rerender(<FixtureStage fixture={expired} />)
    expect(screen.getByRole('alert')).toHaveTextContent(/sessão expirou/i)
  })
})
