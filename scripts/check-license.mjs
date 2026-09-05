import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath) {
  return readFileSync(join(root, relativePath), 'utf8')
}

const license = read('LICENSE')
if (!license.includes('Apache License') || !license.includes('Version 2.0')) {
  throw new Error('LICENSE must be Apache License Version 2.0')
}

for (const manifest of ['backend/package.json', 'frontend/package.json']) {
  const parsed = JSON.parse(read(manifest))
  if (parsed.license !== 'Apache-2.0') {
    throw new Error(`${manifest} license must be Apache-2.0`)
  }
  if (parsed.private !== true) {
    throw new Error(`${manifest} must remain private`)
  }
}

console.log('LICENSE and package manifests are Apache-2.0')
