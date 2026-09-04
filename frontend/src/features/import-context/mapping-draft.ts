import type { ImportMapping } from '../../api/operation-schemas.ts'

export type MappingPair = {
  columnPosition: number
  fieldKey: string
}

export type MappingDraftState = {
  expectedRevision: number
  pairs: MappingPair[]
  dirty: boolean
  conflictMessage: string | null
  remote: ImportMapping | null
}

export type MappingDraftAction =
  | { type: 'hydrate'; mapping: ImportMapping }
  | { type: 'setColumnField'; columnPosition: number; fieldKey: string | null }
  | { type: 'saved'; mapping: ImportMapping }
  | {
      type: 'conflict'
      message: string
      remote: ImportMapping
    }
  | { type: 'discardLocalForRemote' }
  | { type: 'rebaseLocalOntoRemote' }
  | { type: 'clearConflict' }

export function createMappingDraft(mapping: ImportMapping): MappingDraftState {
  return {
    expectedRevision: mapping.revision,
    pairs: mapping.mappings.map((pair) => ({ ...pair })),
    dirty: false,
    conflictMessage: null,
    remote: null,
  }
}

export function mappingDraftReducer(
  state: MappingDraftState,
  action: MappingDraftAction,
): MappingDraftState {
  switch (action.type) {
    case 'hydrate':
      if (state.dirty || state.remote) {
        return {
          ...state,
          remote: state.remote
            ? { ...action.mapping }
            : state.remote,
        }
      }
      return createMappingDraft(action.mapping)
    case 'saved':
      return createMappingDraft(action.mapping)
    case 'conflict':
      return {
        ...state,
        conflictMessage: action.message,
        remote: { ...action.remote },
      }
    case 'discardLocalForRemote': {
      if (!state.remote) {
        return state
      }
      return createMappingDraft(state.remote)
    }
    case 'rebaseLocalOntoRemote': {
      if (!state.remote) {
        return state
      }
      return {
        ...state,
        expectedRevision: state.remote.revision,
        dirty: true,
        conflictMessage: null,
        remote: null,
      }
    }
    case 'clearConflict':
      return { ...state, conflictMessage: null, remote: null }
    case 'setColumnField': {
      const withoutColumn = state.pairs.filter(
        (pair) => pair.columnPosition !== action.columnPosition,
      )
      const withoutField =
        action.fieldKey === null
          ? withoutColumn
          : withoutColumn.filter((pair) => pair.fieldKey !== action.fieldKey)

      const nextPairs =
        action.fieldKey === null
          ? withoutField
          : [
              ...withoutField,
              {
                columnPosition: action.columnPosition,
                fieldKey: action.fieldKey,
              },
            ].sort((a, b) => a.columnPosition - b.columnPosition)

      return {
        ...state,
        pairs: nextPairs,
        dirty: true,
        conflictMessage: state.remote ? state.conflictMessage : null,
      }
    }
    default:
      return state
  }
}

export function serializeMappingDraft(state: MappingDraftState) {
  return {
    expectedRevision: state.expectedRevision,
    mappings: state.pairs.map((pair) => ({
      columnPosition: pair.columnPosition,
      fieldKey: pair.fieldKey,
    })),
  }
}

export function fieldUsedByOtherColumn(
  state: MappingDraftState,
  fieldKey: string,
  columnPosition: number,
) {
  return state.pairs.some(
    (pair) =>
      pair.fieldKey === fieldKey && pair.columnPosition !== columnPosition,
  )
}

export function draftFieldForColumn(
  state: MappingDraftState,
  columnPosition: number,
) {
  return (
    state.pairs.find((pair) => pair.columnPosition === columnPosition)
      ?.fieldKey ?? ''
  )
}

export function countAssociatedRequiredFields(
  state: MappingDraftState,
  requiredKeys: string[],
) {
  const associated = new Set(state.pairs.map((pair) => pair.fieldKey))
  return requiredKeys.filter((key) => associated.has(key)).length
}
