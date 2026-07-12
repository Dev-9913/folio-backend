import { createClient } from 'redis'

let redisClient = null

export async function connectRedis() {
  try {
    const url = process.env.REDIS_URL || 'redis://localhost:6379'
    const isTLS = url.startsWith('rediss://')

    redisClient = createClient({
      url,
      socket: isTLS ? {
        tls: true,
        rejectUnauthorized: false,
      } : undefined,
    })

    redisClient.on('error', (err) => console.warn('Redis error:', err.message))
    await redisClient.connect()
    console.log('✅ Redis connected')
  } catch (err) {
    console.warn('⚠️  Redis unavailable — caching disabled:', err.message)
    redisClient = null
  }
}

export const getRedis = () => redisClient

export async function cacheGet(key) {
  if (!redisClient) return null
  try {
    const val = await redisClient.get(key)
    return val ? JSON.parse(val) : null
  } catch { return null }
}

export async function cacheSet(key, value, ttlSeconds = 3600) {
  if (!redisClient) return
  try {
    await redisClient.setEx(key, ttlSeconds, JSON.stringify(value))
  } catch {}
}

export async function cacheDel(key) {
  if (!redisClient) return
  try { await redisClient.del(key) } catch {}
}