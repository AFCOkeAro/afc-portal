/**
 * Privileged Directus client (AFC-669).
 *
 * Area admins hold the Administrator *portal* grants but their own Directus
 * tokens cannot manage roles/policies/permissions, and custom-role holders
 * cannot read the role tables at all. Admin-surface reads and writes
 * therefore run as the staging Directus administrator (credentials already
 * live in the service env, server-side only), never with a caller token.
 * Every caller is still gated by `requireArea` first.
 */

interface CachedToken {
  token: string
  at: number
}

let cached: CachedToken | null = null
let inflight: Promise<string> | null = null
const CACHE_TTL_MS = 9 * 60 * 1000

export async function directusAdminToken(
  event: import('h3').H3Event,
): Promise<string> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.token
  if (!inflight) {
    inflight = (async () => {
      const { directusFetch } = await import('./directus')
      const email = process.env.DIRECTUS_ADMIN_EMAIL ?? ''
      const password = process.env.DIRECTUS_ADMIN_PASSWORD ?? ''
      if (email === '' || password === '') {
        throw createError({
          statusCode: 503,
          statusMessage: 'Directus admin credentials are not configured',
          data: { code: 'directus_not_configured' },
        })
      }
      const res = await directusFetch<{ data: { access_token: string } }>(
        event,
        '/auth/login',
        { method: 'POST', body: { email, password } },
      )
      cached = { token: res.data.access_token, at: Date.now() }
      return cached.token
    })()
    try {
      return await inflight
    } finally {
      inflight = null
    }
  }
  return inflight
}

/** Forget the cached admin token (call after a 401, then retry once). */
export function forgetDirectusAdminToken(): void {
  cached = null
}
