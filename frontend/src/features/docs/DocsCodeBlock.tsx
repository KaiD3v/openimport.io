import { useId, useMemo, useState } from 'react'
import { highlightTypescriptCode } from './highlight-typescript.ts'

type DocsCodeBlockProps = {
  code: string
  /** Terminal language legend — product copy uses Typescript. */
  language?: string
}

async function writeClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.left = '-9999px'
  document.body.appendChild(area)
  area.select()
  document.execCommand('copy')
  document.body.removeChild(area)
}

function CopyIcon() {
  return (
    <svg
      className="oi-docs-terminal-icon"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="8"
        y="8"
        width="11"
        height="11"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        d="M6 15H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1"
      />
    </svg>
  )
}

function CopiedIcon() {
  return (
    <svg
      className="oi-docs-terminal-icon"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="square"
        d="M5 12.5 10 17.5 19 7"
      />
    </svg>
  )
}

export function DocsCodeBlock({
  code,
  language = 'Typescript',
}: DocsCodeBlockProps) {
  const labelId = useId()
  const tokens = useMemo(() => highlightTypescriptCode(code), [code])
  const [copied, setCopied] = useState(false)

  async function onCopy() {
    try {
      await writeClipboard(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
    }
  }

  return (
    <figure className="oi-docs-terminal" aria-labelledby={labelId}>
      <div className="oi-docs-terminal-bar">
        <p id={labelId} className="oi-docs-terminal-lang">
          <span className="oi-docs-terminal-prompt" aria-hidden="true">
            ▌
          </span>
          {language}
        </p>
        <button
          type="button"
          className="oi-docs-terminal-copy"
          aria-label={
            copied ? 'Copiado para a área de transferência' : 'Copiar para a área de transferência'
          }
          onClick={() => {
            void onCopy()
          }}
        >
          {copied ? <CopiedIcon /> : <CopyIcon />}
        </button>
      </div>
      <pre className="oi-docs-terminal-pre" tabIndex={0}>
        <code>
          {tokens.map((token, index) => (
            <span
              key={`${token.kind}-${index}`}
              className={`oi-syn oi-syn-${token.kind}`}
            >
              {token.text}
            </span>
          ))}
        </code>
      </pre>
    </figure>
  )
}
