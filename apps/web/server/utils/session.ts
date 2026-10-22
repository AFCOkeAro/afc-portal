import type { H3Event } from 'h3'
import type { AuthSession, ImpersonatedBy } from '@afc/shared'
import { SESSION_COOKIE_NAME } from '@afc/shared'

/**
 * Session storage.
 *
 * The session lives in a sealed httpOnly cookie created by h3's `useSession`.
 * Sealed rather than merely signed because the cookie carries the Directus access
 * token: the client must not be able to read it, and a signed-but-readable value
 * would still be readable by any script on the origin.
 *
 * The password comes from `NUXT_SESSION_SECRET`. There is no default. A missing
 * secret in a deployed environment is a configuration fault and it is raised as
 * one, rather than falling back to a constant that everybody's deployment
 * shares.
 */

export interface PortalSessionData {
  accessToken: string
  refreshToken: string | null
  session: AuthSession
  /**
   * Distinct impersonation claim (AFC-684). When set, `session.user` is the
   * effective (previewed) scope and this claim retains the original actor,
   * the reason, and the hard expiry. Absent means "not impersonating".
   */
  impersonatedBy?: ImpersonatedBy
}

/** Set when `NUXT_STUB_AUTH` is on: the cookie carries a synthetic token. */
export const STUB_ACCESS_TOKEN = 'afc-stub-access-token'

function sessionPassword(event: H3Event): string {
  const config = useRuntimeConfig(event)
  const secret = String(config.sessionSecret ?? '')
  if (!secret) {
    throw createError({
      statusCode: 503,
      statusMessage: 'NUXT_SESSION_SECRET is not configured for this deployment',
    })
  }
  return secret
}

function portalSession(event: H3Event) {
  return useSession<PortalSessionData>(event, {
    name: SESSION_COOKIE_NAME,
    password: sessionPassword(event),
    // Sealed cookies cannot be read by the client, so the lifetime is enforced
    // here and by `authSessionSchema` on the way out, not by the browser.
    maxAge: 60 * 60 * 8,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      // `import.meta.dev`, not NODE_ENV: the production *build* runs with
      // NODE_ENV=production even when a developer previews it over plain HTTP,
      // and a Secure cookie is silently dropped by the browser in that case. The
      // deployment is behind Caddy over TLS either way.
      secure: !import.meta.dev,
      path: '/',
    },
  })
}

export async function readSession(event: H3Event): Promise<PortalSessionData | null> {
  try {
    const session = await portalSession(event)
    const data = session.data as Partial<PortalSessionData> | undefined
    // An absent cookie leaves h3 with an empty object, not undefined, and an
    // empty object is truthy. Treating "sealed nothing" as a session is how an
    // anonymous request ends up dereferencing `undefined` and getting a 500
    // where the correct answer is a clean 401.
    if (
      !data ||
      typeof data.accessToken !== 'string' ||
      !data.session ||
      typeof data.session !== 'object'
    ) {
      return null
    }
    return data as PortalSessionData
  } catch {
    // A missing secret in local dev, or a cookie that was sealed with a
    // different secret after a deploy. Both mean "no usable session", and both
    // are handled by sending the user to the sign-in page rather than by
    // failing the request.
    return null
  }
}

/** The access token to use for Directus on behalf of the signed-in user. */
export async function sessionAccessToken(event: H3Event): Promise<string | null> {
  return (await readSession(event))?.accessToken ?? null
}

/**
 * Throw 401 unless there is a session. Every staff-facing route calls this
 * first; the browser-facing guard is a convenience, not the control.
 */
export async function requireSession(event: H3Event): Promise<PortalSessionData> {
  const found = await readSession(event)
  if (!found) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Sign in to continue',
      data: { code: 'unauthenticated' },
    })
  }
  return found
}

export async function writeSession(
  event: H3Event,
  data: PortalSessionData,
): Promise<void> {
  const session = await portalSession(event)
  await session.update(data)
}

export async function clearPortalSession(event: H3Event): Promise<void> {
  const session = await portalSession(event)
  await session.clear()
}
