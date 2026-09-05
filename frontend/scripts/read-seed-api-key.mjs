import { readFileSync } from 'node:fs'

export function parseSeedApiKey(text) {
  const match = text.match(/^SEED_API_KEY=(.+)$/m)
  if (!match) {
    throw new Error('SEED_API_KEY missing in backend/.env')
  }
  const key = match[1].trim().replace(/^["']|["']$/g, '').trim()
  if (!key.startsWith('oi_live_')) {
    throw new Error('SEED_API_KEY must be oi_live_')
  }
  return key
}

export function readSeedApiKey(envPath) {
  return parseSeedApiKey(readFileSync(envPath, 'utf8'))
}
