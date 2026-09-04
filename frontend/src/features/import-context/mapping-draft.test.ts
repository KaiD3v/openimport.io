import { describe, expect, it } from 'vitest'
import { uploadedContext } from '../../test/fixtures.ts'
import {
  createMappingDraft,
  draftFieldForColumn,
  fieldUsedByOtherColumn,
  mappingDraftReducer,
  serializeMappingDraft,
} from './mapping-draft.ts'

describe('mappingDraftReducer', () => {
  it('hydrates from server mapping', () => {
    const state = createMappingDraft(uploadedContext.mapping)
    expect(state.expectedRevision).toBe(1)
    expect(state.dirty).toBe(false)
    expect(state.pairs).toHaveLength(2)
  })

  it('keeps field uniqueness across columns', () => {
    let state = createMappingDraft({
      ...uploadedContext.mapping,
      mappings: [],
      isComplete: false,
      missingRequiredFields: ['sku', 'priceInCents'],
      revision: 0,
    })

    state = mappingDraftReducer(state, {
      type: 'setColumnField',
      columnPosition: 0,
      fieldKey: 'sku',
    })
    state = mappingDraftReducer(state, {
      type: 'setColumnField',
      columnPosition: 1,
      fieldKey: 'sku',
    })

    expect(state.pairs).toEqual([{ columnPosition: 1, fieldKey: 'sku' }])
    expect(fieldUsedByOtherColumn(state, 'sku', 0)).toBe(true)
    expect(draftFieldForColumn(state, 0)).toBe('')
  })

  it('allows clearing a column association', () => {
    let state = createMappingDraft(uploadedContext.mapping)
    state = mappingDraftReducer(state, {
      type: 'setColumnField',
      columnPosition: 0,
      fieldKey: null,
    })

    expect(draftFieldForColumn(state, 0)).toBe('')
    expect(state.dirty).toBe(true)
  })

  it('serializes pairs by columnPosition without inventing revision', () => {
    const state = createMappingDraft(uploadedContext.mapping)
    expect(serializeMappingDraft(state)).toEqual({
      expectedRevision: 1,
      mappings: uploadedContext.mapping.mappings,
    })
  })

  it('preserves local draft pairs on conflict and stores remote separately', () => {
    let state = createMappingDraft(uploadedContext.mapping)
    state = mappingDraftReducer(state, {
      type: 'setColumnField',
      columnPosition: 1,
      fieldKey: 'stock',
    })
    state = mappingDraftReducer(state, {
      type: 'setColumnField',
      columnPosition: 2,
      fieldKey: 'priceInCents',
    })

    state = mappingDraftReducer(state, {
      type: 'conflict',
      message: 'Outra alteração foi salva.',
      remote: {
        ...uploadedContext.mapping,
        revision: 3,
        mappings: [{ columnPosition: 0, fieldKey: 'sku' }],
      },
    })

    expect(draftFieldForColumn(state, 1)).toBe('stock')
    expect(draftFieldForColumn(state, 2)).toBe('priceInCents')
    expect(state.dirty).toBe(true)
    expect(state.expectedRevision).toBe(1)
    expect(state.remote?.revision).toBe(3)
    expect(state.conflictMessage).toMatch(/outra alteração/i)
  })

  it('discards local draft and adopts remote on explicit discard', () => {
    let state = createMappingDraft(uploadedContext.mapping)
    state = mappingDraftReducer(state, {
      type: 'setColumnField',
      columnPosition: 1,
      fieldKey: 'stock',
    })
    state = mappingDraftReducer(state, {
      type: 'conflict',
      message: 'conflict',
      remote: {
        ...uploadedContext.mapping,
        revision: 4,
        mappings: [{ columnPosition: 0, fieldKey: 'sku' }],
      },
    })

    state = mappingDraftReducer(state, { type: 'discardLocalForRemote' })

    expect(state.expectedRevision).toBe(4)
    expect(state.dirty).toBe(false)
    expect(state.remote).toBeNull()
    expect(state.conflictMessage).toBeNull()
    expect(state.pairs).toEqual([{ columnPosition: 0, fieldKey: 'sku' }])
  })

  it('rebases local associations onto remote revision without saving', () => {
    let state = createMappingDraft(uploadedContext.mapping)
    state = mappingDraftReducer(state, {
      type: 'setColumnField',
      columnPosition: 1,
      fieldKey: 'stock',
    })
    state = mappingDraftReducer(state, {
      type: 'conflict',
      message: 'conflict',
      remote: {
        ...uploadedContext.mapping,
        revision: 5,
        mappings: [{ columnPosition: 0, fieldKey: 'sku' }],
      },
    })

    state = mappingDraftReducer(state, { type: 'rebaseLocalOntoRemote' })

    expect(state.expectedRevision).toBe(5)
    expect(state.dirty).toBe(true)
    expect(state.remote).toBeNull()
    expect(state.conflictMessage).toBeNull()
    expect(draftFieldForColumn(state, 1)).toBe('stock')
    expect(serializeMappingDraft(state).expectedRevision).toBe(5)
  })

  it('does not hydrate over a dirty draft while conflict is unresolved', () => {
    let state = createMappingDraft(uploadedContext.mapping)
    state = mappingDraftReducer(state, {
      type: 'setColumnField',
      columnPosition: 2,
      fieldKey: 'priceInCents',
    })
    state = mappingDraftReducer(state, {
      type: 'conflict',
      message: 'conflict',
      remote: {
        ...uploadedContext.mapping,
        revision: 9,
        mappings: [],
      },
    })

    state = mappingDraftReducer(state, {
      type: 'hydrate',
      mapping: {
        ...uploadedContext.mapping,
        revision: 9,
        mappings: [{ columnPosition: 0, fieldKey: 'sku' }],
      },
    })

    expect(draftFieldForColumn(state, 2)).toBe('priceInCents')
    expect(state.expectedRevision).toBe(1)
    expect(state.remote?.revision).toBe(9)
  })
})
