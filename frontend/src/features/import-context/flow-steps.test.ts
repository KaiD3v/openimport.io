import { describe, expect, it } from 'vitest'
import {
  createdContext,
  processingFailedContext,
  queuedContext,
  readyContext,
  uploadedContext,
  uploadFailedContext,
} from '../../test/fixtures.ts'
import { resolveFlowPresentation } from './flow-steps.ts'

describe('resolveFlowPresentation', () => {
  it('marks upload as current for a created session ready to receive a file', () => {
    const presentation = resolveFlowPresentation(createdContext)

    expect(presentation.kind).toBe('active')
    expect(presentation.steps).toEqual([
      { id: 'upload', label: 'Enviar arquivo', state: 'current' },
      { id: 'map', label: 'Mapear', state: 'upcoming' },
      { id: 'review', label: 'Revisar', state: 'upcoming' },
      { id: 'process', label: 'Processar', state: 'upcoming' },
    ])
    expect(presentation.navLabel).toMatch(/enviar arquivo/i)
  })

  it('preserves map/review for uploaded incomplete mapping', () => {
    const incomplete = {
      ...uploadedContext,
      mapping: {
        ...uploadedContext.mapping,
        isComplete: false,
        missingRequiredFields: ['stock'],
        mappings: [{ columnPosition: 0, fieldKey: 'sku' }],
      },
    }

    const presentation = resolveFlowPresentation(incomplete)

    expect(presentation.kind).toBe('active')
    expect(presentation.steps.find((step) => step.id === 'map')?.state).toBe(
      'current',
    )
    expect(presentation.steps.find((step) => step.id === 'upload')?.state).toBe(
      'done',
    )
  })

  it('marks review as current when mapping is complete', () => {
    const presentation = resolveFlowPresentation(uploadedContext)

    expect(presentation.kind).toBe('active')
    expect(presentation.steps.find((step) => step.id === 'review')?.state).toBe(
      'current',
    )
  })

  it('marks process as current while queued', () => {
    const presentation = resolveFlowPresentation(queuedContext)
    expect(presentation.steps.find((step) => step.id === 'process')?.state).toBe(
      'current',
    )
  })

  it('marks process as done when ready', () => {
    const presentation = resolveFlowPresentation(readyContext)
    expect(presentation.steps.find((step) => step.id === 'process')?.state).toBe(
      'done',
    )
  })

  it('treats processing_failed as interrupted on the process step', () => {
    const presentation = resolveFlowPresentation(processingFailedContext)
    expect(presentation.kind).toBe('interrupted')
    expect(presentation.steps.find((step) => step.id === 'process')?.state).toBe(
      'failed',
    )
  })

  it('treats upload_failed as a terminal interrupted flow, not a normal upload step', () => {
    const presentation = resolveFlowPresentation(uploadFailedContext)

    expect(presentation.kind).toBe('interrupted')
    expect(presentation.steps.find((step) => step.id === 'upload')?.state).toBe(
      'failed',
    )
    expect(presentation.steps.find((step) => step.id === 'map')?.state).toBe(
      'upcoming',
    )
    expect(presentation.navLabel).toMatch(/falha|interromp/i)
    expect(presentation.navLabel).not.toMatch(/^Etapa atual: Enviar arquivo$/i)
  })
})
