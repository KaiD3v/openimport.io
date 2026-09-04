import { OpenImportApiError } from './errors.ts'

export function buildUploadFormData(file: File): FormData {
  const form = new FormData()
  form.append('file', file)
  return form
}

export function assertSingleCsvFile(files: FileList | File[] | null): File {
  const list = files ? Array.from(files) : []
  if (list.length === 0) {
    throw new OpenImportApiError({
      status: 0,
      code: 'OPENIMPORT.NO_FILE_SELECTED',
      message: 'Selecione um arquivo CSV para enviar.',
    })
  }
  if (list.length > 1) {
    throw new OpenImportApiError({
      status: 0,
      code: 'OPENIMPORT.MULTIPLE_FILES',
      message: 'Envie somente um arquivo por vez.',
    })
  }

  const file = list[0]!
  const name = file.name.toLowerCase()
  const mime = file.type
  const mimeOk =
    mime === '' ||
    mime === 'text/csv' ||
    mime === 'application/vnd.ms-excel' ||
    mime === 'application/octet-stream' ||
    mime === 'text/plain'

  if (!name.endsWith('.csv') && !mimeOk) {
    throw new OpenImportApiError({
      status: 0,
      code: 'OPENIMPORT.INVALID_FILE_TYPE',
      message: 'Use um arquivo CSV.',
    })
  }

  return file
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
