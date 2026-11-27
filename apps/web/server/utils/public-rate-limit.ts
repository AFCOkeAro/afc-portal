/**
 * Per-instance token-bucket rate limiter for the public registration edge
 * (AFC-1222 F1, hardened AFC-1226 H1/M2).
 *
 * STATED CHOICE (spec is silent on the store). data-model §9 calls for a
 * rate-limited public endpoint and the route header records that a
 * per-instance in-memory limiter is worse than none behind more than one
 * worker. This module is the smallest defensible edge that is still honest:
 *
 *   - One Nitro/Node process enforces a per-IP + per-route token bucket here,
 *     so a single-process deploy (today's staging and the single-VPS prod in
 *     infra-spec §2) actually throttles an open-day flood.
 *   - The bucket state is process-local. Behind more than one worker the limit
 *     is per-worker, not global. The shared store (Redis) that would make it
 *     global is a CTO deploy-topology decision, not a code default smuggled
 *     in here: this module exposes `configurePublicRateLimit` so the shared
 *     store lands without touching the route, and the route comment says so.
 *
 * Stock `caddy:2-alpine` ships no `rate_limit` directive, so the rate_limit
 * sketch in infra-spec §4 never enforced anything. The Caddyfile in
 * services/directus/Caddyfile deliberately carries no rate-limit block and
 * says where the limit lives instead of pretending.
 *
 * KEYING (AFC-1226 H1). The key is the CDN-attested client IP
 * (`CF-Connecting-IP`, which Cloudflare overwrites on ingress so a client
 * cannot spoof it through the CDN) or, when the CDN header is absent, the
 * socket peer address. `X-Forwarded-For` is NEVER a key input: it is
 * client-controlled unless an edge strips it, and a rotating-XFF flood
 * (AFC-1211 F1) walks straight through an XFF-keyed bucket. Caddy
 * overwrites XFF at the edge for log integrity (see the Caddyfile), but the
 * route does not trust it either way. Residual, stated: a client that
 * reaches Nuxt with no CDN header and a shared socket peer (direct-to-
 * origin behind one proxy) shares one bucket — the limit degrades toward
 * global rather than toward open, and direct-to-origin traffic is an
 * operator firewall question, not something this module can attest.
 *
 * BOUND (AFC-1226 H1). The map is capped at MAX_BUCKETS entries. Past the
 * cap, expired buckets are evicted first and then the oldest entries are
 * dropped to make room, so the map cannot grow with the internet. At the
 * bound the limiter degrades OPEN for new keys (allowed, counted fresh):
 * the bound protects the process from a key-spray, it is not a second
 * limit, and a spray that holds the map full also washes legitimate
 * buckets. Seat protection never depended on this module — the 0070/0071
 * trigger decides that deterministically.
 */

export interface PublicRateLimitOptions {
  /** Max POSTs per window per key. Default 5. */
  maxRequests?: number
  /** Window length in milliseconds. Default 60_000. */
  windowMs?: number
}

export interface PublicRateLimitVerdict {
  allowed: boolean
  /** Requests remaining in the current window (0 when refused). */
  remaining: number
  /** Milliseconds until the window resets (0 when allowed). */
  retryAfterMs: number
}

interface Bucket {
  count: number
  resetAt: number
}

/** Hard cap on tracked keys: the map cannot grow with the internet. */
export const MAX_BUCKETS = 10_000

const buckets = new Map<string, Bucket>()

let maxRequests = 5
let windowMs = 60_000

/**
 * Test/deploy seam. The route calls this never; tests and a future
 * shared-store wiring call it to set the budget. Kept module-level so the
 * limiter stays dependency-free.
 */
export function configurePublicRateLimit(options: PublicRateLimitOptions): void {
  if (options.maxRequests !== undefined) maxRequests = options.maxRequests
  if (options.windowMs !== undefined) windowMs = options.windowMs
  if (process.env.NODE_ENV === 'test') buckets.clear()
}

/** Introspection seam for the contract test. Not a production read path. */
export function resetPublicRateLimitForTest(): void {
  buckets.clear()
}

/** Current number of tracked keys. Introspection seam for the bound probe. */
export function publicRateLimitSize(): number {
  return buckets.size
}

/**
 * Resolve the limiter key for one request (AFC-1226 H1).
 *
 * CDN-attested header first, socket peer second, XFF never: the header is
 * passed in (rather than read from the event) so the pure contract test can
 * drive it without Nitro.
 */
export function resolveRateLimitKey(
  headers: Record<string, string | string[] | undefined>,
  socketAddress?: string | null,
): string {
  const cdn = firstHeaderValue(headers['cf-connecting-ip'])
  if (cdn) return `register:${cdn.toLowerCase()}`
  const socket = (socketAddress ?? '').trim()
  if (socket) return `register:${socket.toLowerCase()}`
  return 'register:unknown-client'
}

function firstHeaderValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) value = value[0]
  return typeof value === 'string' ? value.trim() : ''
}

export function checkPublicRateLimit(
  key: string,
  now: number = Date.now(),
): PublicRateLimitVerdict {
  const existing = buckets.get(key)
  if (!existing || now >= existing.resetAt) {
    if (!existing && buckets.size >= MAX_BUCKETS) {
      // Bound: evict the expired first, then drop the oldest to make room.
      // Degrades open for the new key (see the module header).
      evictExpiredPublicRateLimitBuckets(now)
      for (const oldest of buckets.keys()) {
        if (buckets.size < MAX_BUCKETS) break
        buckets.delete(oldest)
      }
    }
    const fresh: Bucket = { count: 1, resetAt: now + windowMs }
    buckets.set(key, fresh)
    return { allowed: true, remaining: Math.max(0, maxRequests - 1), retryAfterMs: 0 }
  }
  if (existing.count < maxRequests) {
    existing.count += 1
    return {
      allowed: true,
      remaining: maxRequests - existing.count,
      retryAfterMs: 0,
    }
  }
  return {
    allowed: false,
    remaining: 0,
    retryAfterMs: Math.max(0, existing.resetAt - now),
  }
}

/**
 * Totally-ordered eviction of expired buckets. Called opportunistically by
 * the route (every Nth request) so the map cannot grow with the internet.
 * Exported so the contract test can drive it deterministically.
 */
export function evictExpiredPublicRateLimitBuckets(now: number = Date.now()): number {
  let evicted = 0
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) {
      buckets.delete(key)
      evicted += 1
    }
  }
  return evicted
}
