import type { ImportContext } from '../../api/import-context.schema.ts'
import { UPLOAD_FAILED_NOTICE } from './copy.ts'

type UploadFailedNoticeProps = {
  context: ImportContext
}

export function UploadFailedNotice({ context }: UploadFailedNoticeProps) {
  if (context.import.status !== 'upload_failed') {
    return null
  }

  const filename = context.import.originalFilename

  return (
    <section
      className="oi-interrupted"
      aria-labelledby="oi-interrupted-title"
    >
      <p className="oi-interrupted-stamp" aria-hidden="true">
        Registro recusado
      </p>
      <h2 id="oi-interrupted-title">{UPLOAD_FAILED_NOTICE.title}</h2>
      <p role="status" aria-label={UPLOAD_FAILED_NOTICE.title}>
        {UPLOAD_FAILED_NOTICE.body}
        {filename ? ` Arquivo envolvido: ${filename}.` : ''}
      </p>
      <p className="oi-interrupted-next">{UPLOAD_FAILED_NOTICE.nextAction}</p>
    </section>
  )
}
