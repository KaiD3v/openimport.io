import { useState } from 'react'

type CopyableDetailProps = {
  value: string
  label?: string
}

export function CopyableDetail({
  value,
  label = 'Detalhe técnico',
}: CopyableDetailProps) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="oi-copyable">
      <p className="oi-state-detail">
        {label}: <span className="oi-mono">{value}</span>
      </p>
      <button type="button" className="oi-secondary" onClick={() => void copy()}>
        {copied ? 'Copiado' : 'Copiar detalhe técnico'}
      </button>
    </div>
  )
}
