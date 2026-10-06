import type { AuthSession } from '@afc/shared'
import { readSession } from '../../utils/session'

export interface AuthState {
  authenticated: boolean
  session: AuthSession | null
}

/**
 * GET /api/auth/me
 *
 * Returns an explicit envelope rather than a bare `null`.
 *
 * A route whose handler returns `null` is answered by Nitro with 204 and no
 * body, which the client then has to distinguish from a 200 carrying an empty
 * body. `{ authenticated: false, session: null }` is one shape in both cases and
 * there is nothing to infer.
 *
 * "Not signed in" is an ordinary answer here, not an error: an anonymous visitor
 * asking whether they have a session should not have to catch a 401.
 */
export default defineEventHandler(async (event): Promise<AuthState> => {
  const found = await readSession(event)
  return {
    authenticated: found !== null,
    session: found?.session ?? null,
  }
})
