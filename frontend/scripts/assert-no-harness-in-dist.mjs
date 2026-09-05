import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const dist = join(process.cwd(), 'dist')
const forbidden = [
  'openimport-dev-harness',
  'OpenImport Lab',
  'Laboratório OpenImport',
  'Harness de desenvolvimento',
  'Inicializar sessão',
  'Carregar iframe',
  'Pré-visualização visual',
  'openimport-visual-fixture',
  'created — pronta para upload',
  'Fixtures sintéticas sem token real',
  'openimport-harness-log',
]

function walk(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

const files = walk(dist).filter((path) =>
  /\.(js|css|html|map)$/.test(path),
)
const hits = []

for (const file of files) {
  const text = readFileSync(file, 'utf8')
  for (const needle of forbidden) {
    if (text.includes(needle)) {
      hits.push(`${file}: ${needle}`)
    }
  }
}

if (hits.length > 0) {
  console.error('Production bundle contains development harness copy:')
  for (const hit of hits) {
    console.error(`- ${hit}`)
  }
  process.exit(1)
}
