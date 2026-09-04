export function importContextQueryKey(importId: string) {
  return ['import-context', importId] as const
}

export function rejectedRowsQueryKey(importId: string, generation: number) {
  return ['rejected-rows', importId, generation] as const
}
