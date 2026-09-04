import { useEffect, useRef, useState } from 'react'
import {
  inspectInitializeEvent,
  postToParent,
} from './initialize-message.ts'
import { replaceSessionCredential } from './session-credential.ts'

export type HostInitError = {
  code: string
  importId: string
}

export function useHostSession(input: {
  importId: string
  allowedOrigins: readonly string[]
}) {
  const [generation, setGeneration] = useState(0)
  const [initError, setInitError] = useState<HostInitError | null>(null)
  const parentOriginRef = useRef<string | null>(null)

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const result = inspectInitializeEvent({
        data: event.data,
        origin: event.origin,
        source: event.source,
        expectedImportId: input.importId,
        allowedOrigins: input.allowedOrigins,
        parent: window.parent,
      })

      if (result.status === 'ignored') {
        return
      }

      if (result.status === 'rejected') {
        setInitError({ code: result.code, importId: result.importId })
        postToParent(window.parent, event.origin, {
          type: 'openimport.error',
          version: 1,
          importId: result.importId,
          code: result.code,
        })
        return
      }

      replaceSessionCredential(result.importId, result.accessToken)
      parentOriginRef.current = event.origin
      setInitError(null)
      setGeneration((current) => current + 1)
      postToParent(window.parent, event.origin, {
        type: 'openimport.ready',
        version: 1,
        importId: result.importId,
      })
    }

    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('message', onMessage)
    }
  }, [input.allowedOrigins, input.importId])

  return {
    generation,
    initError,
    parentOriginRef,
  }
}
