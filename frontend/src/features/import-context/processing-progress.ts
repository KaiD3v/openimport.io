import type { ImportProgress } from '../../api/import-context.schema.ts'

export function progressPercent(
  progress: ImportProgress | null | undefined,
): number | null {
  if (!progress) return null
  if (progress.totalRows === null || progress.totalRows <= 0) return null
  return Math.min(
    100,
    Math.round((progress.processedRows / progress.totalRows) * 100),
  )
}

export function isPreviewFresh(input: {
  previewMappingRevision: number
  previewContentSha256: string
  mappingRevision: number
  contentSha256: string | null
}): boolean {
  return (
    input.contentSha256 !== null &&
    input.previewMappingRevision === input.mappingRevision &&
    input.previewContentSha256 === input.contentSha256
  )
}
