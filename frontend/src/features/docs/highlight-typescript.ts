export type SyntaxTokenKind =
  | 'keyword'
  | 'string'
  | 'comment'
  | 'number'
  | 'function'
  | 'punct'
  | 'plain'

export type SyntaxToken = {
  kind: SyntaxTokenKind
  text: string
}

const KEYWORDS = new Set([
  'abstract',
  'async',
  'await',
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'from',
  'function',
  'if',
  'implements',
  'import',
  'in',
  'instanceof',
  'interface',
  'let',
  'new',
  'null',
  'of',
  'return',
  'static',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'undefined',
  'var',
  'void',
  'while',
  'with',
  'yield',
  'type',
  'as',
])

const PUNCT = new Set('(){}[].,;:?!=<>+-*/%&|^~'.split(''))

function isIdentStart(ch: string) {
  return /[A-Za-z_$]/.test(ch)
}

function isIdentPart(ch: string) {
  return /[A-Za-z0-9_$]/.test(ch)
}

function pushPlain(tokens: SyntaxToken[], text: string) {
  if (!text) return
  const last = tokens[tokens.length - 1]
  if (last?.kind === 'plain') {
    last.text += text
    return
  }
  tokens.push({ kind: 'plain', text })
}

/**
 * Lightweight TS/JS highlighter for docs terminals.
 * Not a full parser — enough for copy-paste integration snippets.
 */
export function highlightTypescriptCode(source: string): SyntaxToken[] {
  const tokens: SyntaxToken[] = []
  let i = 0

  while (i < source.length) {
    const ch = source[i]!

    if (ch === '/' && source[i + 1] === '/') {
      let end = i + 2
      while (end < source.length && source[end] !== '\n') end += 1
      tokens.push({ kind: 'comment', text: source.slice(i, end) })
      i = end
      continue
    }

    if (ch === '/' && source[i + 1] === '*') {
      let end = i + 2
      while (end < source.length && !(source[end] === '*' && source[end + 1] === '/')) {
        end += 1
      }
      end = Math.min(source.length, end + 2)
      tokens.push({ kind: 'comment', text: source.slice(i, end) })
      i = end
      continue
    }

    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      let end = i + 1
      while (end < source.length) {
        if (source[end] === '\\') {
          end += 2
          continue
        }
        if (source[end] === quote) {
          end += 1
          break
        }
        end += 1
      }
      tokens.push({ kind: 'string', text: source.slice(i, end) })
      i = end
      continue
    }

    if (/[0-9]/.test(ch)) {
      let end = i + 1
      while (end < source.length && /[0-9_.xXa-fA-F]/.test(source[end]!)) end += 1
      tokens.push({ kind: 'number', text: source.slice(i, end) })
      i = end
      continue
    }

    if (isIdentStart(ch)) {
      let end = i + 1
      while (end < source.length && isIdentPart(source[end]!)) end += 1
      const word = source.slice(i, end)
      let kind: SyntaxTokenKind = KEYWORDS.has(word) ? 'keyword' : 'plain'
      if (kind === 'plain') {
        let j = end
        while (j < source.length && /\s/.test(source[j]!)) j += 1
        if (source[j] === '(') kind = 'function'
      }
      tokens.push({ kind, text: word })
      i = end
      continue
    }

    if (PUNCT.has(ch)) {
      tokens.push({ kind: 'punct', text: ch })
      i += 1
      continue
    }

    pushPlain(tokens, ch)
    i += 1
  }

  return tokens
}
