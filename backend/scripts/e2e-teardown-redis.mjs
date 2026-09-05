import Redis from 'ioredis'

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379/15'
let parsed
try {
  parsed = new URL(redisUrl)
} catch {
  throw new Error('REDIS_URL is not a valid URL')
}

const database = Number(parsed.pathname.replace(/^\//, '') || '0')
if (database !== 15) {
  throw new Error('Refusing to teardown a Redis URL that is not logical database 15')
}

const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1, lazyConnect: true })
await redis.connect()
await redis.flushdb()
await redis.quit()
console.log('E2E Redis database 15 flushed')
