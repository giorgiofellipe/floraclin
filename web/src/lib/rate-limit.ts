/**
 * Best-effort fixed-window limiter held in this server instance's memory. It is not shared across instances or
 * cold starts, so it only slows down a single client hammering one instance; anything that needs a hard limit
 * must count in the database (see updateReferralCode). The map is capped so it cannot grow without bound.
 */
export interface RateLimiter {
  /** True when `key` may make another request now (and counts it). */
  take(key: string, now?: number): boolean
}

const MAX_KEYS = 10_000

export function createRateLimiter({ limit, windowMs }: { limit: number; windowMs: number }): RateLimiter {
  const hits = new Map<string, { count: number; resetAt: number }>()
  return {
    take(key, now = Date.now()) {
      const entry = hits.get(key)
      if (!entry || entry.resetAt <= now) {
        if (hits.size >= MAX_KEYS) {
          for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k)
          // Still full: drop the oldest window (Map keeps insertion order) rather than resetting everyone.
          if (hits.size >= MAX_KEYS) hits.delete(hits.keys().next().value!)
        }
        hits.delete(key)
        hits.set(key, { count: 1, resetAt: now + windowMs })
        return true
      }
      if (entry.count >= limit) return false
      entry.count++
      return true
    },
  }
}

/**
 * First x-forwarded-for hop, then x-real-ip; 'unknown' groups clients without either. On Vercel the platform sets
 * x-forwarded-for to the client address; elsewhere it can be spoofed, which only weakens this best-effort limit.
 */
export function clientIpKey(headers: Pick<Headers, 'get'>): string {
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip')?.trim() || 'unknown'
}
