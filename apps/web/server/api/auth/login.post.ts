import type { H3Event } from 'h3'
import type { AuthSession, LoginCredentials, PortalUser } from '@afc/shared'
import { loginCredentialsSchema } from '@afc/shared'
import { DirectusAuthError, directusFetch } from '../../utils/directus'
import { STUB_ACCESS_TOKEN, clearPortalSession, writeSession } from '../../utils/session'
import { findStubIdentity, stubAuthEnabled } from '../../utils/stub-identities'

/**
 * POST /api/auth/login
 *
 * Signs a user in and seals the session cookie. Two paths:
 *
 *   - stub: `NUXT_STUB_AUTH=true`, answers from seeded local identities. See
 *     `server/utils/stub-identities.ts` for what that is and is not.
 *   - Directus: exchanges the credentials for an access token, then reads the
 *     portal's custom user fields with that token. This path is written but
 *     unexercised — the Directus project does not exist yet, so the honest
 *     statement is that it has never returned a token.
 *
 * The user's own token, not the scoped server token, is stored: the grants the
 * Directus policy applies to that token are what the portal is built around.
 */
export default defineEventHandler(async (event) => {
  // A stale session must not survive a new sign-in.
  await clearPortalSession(event)

  const parsed = loginCredentialsSchema.safeParse(await readBody(event))
  if (!parsed.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Enter an email address and a password',
      data: {
        code: 'invalid_credentials_format',
        fields: fieldErrors(parsed.error),
      },
    })
  }
  const credentials = parsed.data as LoginCredentials

  const { accessToken, refreshToken, user } = stubAuthEnabled(event)
    ? stubSession(credentials)
    : await directusSession(event, credentials)

  const now = new Date()
  const session: AuthSession = {
    user,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString(),
  }
  await writeSession(event, { accessToken, refreshToken, session })

  return session
})

interface DirectusAuthResponse {
  data: {
    access_token: string
    refresh_token: string | null
    expires: number
  }
}

interface DirectusUserResponse {
  data: {
    id: string
    email: string
    first_name: string | null
    staff_role: PortalUser['staffRole'] | null
    branch: string | null
    branch_ids: string[] | null
    department_ids: string[] | null
    person: string | null
  }
}

async function directusSession(
  event: H3Event,
  credentials: LoginCredentials,
): Promise<{ accessToken: string; refreshToken: string | null; user: PortalUser }> {
  let auth: DirectusAuthResponse
  try {
    auth = await directusFetch<DirectusAuthResponse>(event, '/auth/login', {
      method: 'POST',
      body: { email: credentials.email, password: credentials.password },
    })
  } catch (cause) {
    if (cause instanceof DirectusAuthError) {
      // Deliberately vague: a distinct message for "no such account" and "wrong
      // password" tells an unauthenticated caller which emails are registered.
      throw createError({
        statusCode: 401,
        statusMessage: 'Email address or password is incorrect',
        data: { code: 'invalid_credentials' },
      })
    }
    throw cause
  }

  const me = await directusFetch<DirectusUserResponse>(event, '/users/me', {
    accessToken: auth.data.access_token,
    query: {
      fields: [
        'id',
        'email',
        'first_name',
        'staff_role',
        'branch',
        'branch_ids',
        'department_ids',
        'person',
      ].join(','),
    },
  })

  return {
    accessToken: auth.data.access_token,
    refreshToken: auth.data.refresh_token,
    user: {
      id: me.data.id,
      email: me.data.email,
      firstName: me.data.first_name,
      // A user with no `staff_role` set is treated as `none`, which grants
      // nothing. Failing closed on an unset role is the only safe default: a
      // null here must not become "treat as admin".
      staffRole: me.data.staff_role ?? 'none',
      branchId: me.data.branch,
      branchIds: me.data.branch_ids ?? [],
      departmentIds: me.data.department_ids ?? [],
      personId: me.data.person,
    },
  }
}

function stubSession(credentials: LoginCredentials): {
  accessToken: string
  refreshToken: string | null
  user: PortalUser
} {
  const user = findStubIdentity(credentials.email, credentials.password)
  if (!user) {
    throw createError({
      statusCode: 401,
      statusMessage: 'Email address or password is incorrect',
      data: { code: 'invalid_credentials' },
    })
  }
  return { accessToken: STUB_ACCESS_TOKEN, refreshToken: null, user }
}

/** Flatten zod issues into `{ "field": "message" }` for display beside inputs. */
function fieldErrors(error: { issues: Array<{ path: PropertyKey[]; message: string }> }) {
  const fields: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.map(String).join('.')
    if (key && !fields[key]) fields[key] = issue.message
  }
  return fields
}
