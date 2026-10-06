import { clearPortalSession } from '../../utils/session'

/**
 * POST /api/auth/logout
 *
 * Clears the sealed session cookie. Always 204, even when there was no session:
 * signing out is not a thing that can fail, and a caller retrying a failed
 * logout should not be stuck.
 */
export default defineEventHandler(async (event) => {
  await clearPortalSession(event)
  setResponseStatus(event, 204)
  return null
})
