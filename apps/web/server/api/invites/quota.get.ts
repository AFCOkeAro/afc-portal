import { getPortalScope } from '../../utils/portal'
import {
  countInviterWindows,
  inviteCapabilities,
  readMemberLimits,
  requireInviteCap,
} from '../../utils/event-invites'

/**
 * Own invite quota (AFC-538 finding 3, US-E1 AC4).
 *
 * Scoped GET: returns the caller's own daily/weekly limits with the live
 * rolling-window counts from `countInviterWindows` (advisory UX pre-check;
 * the atomic `claimInviteQuota` ledger in the POST route stays authoritative
 * and decides nothing here). No query params, no other-user lookup — the
 * inviter id is always the session user, so one member can never read
 * another's counts. Read-only; no send path.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  const caps = inviteCapabilities(scope.role)
  requireInviteCap(caps, 'read', 'read own invite quota')

  const inviterUserId = scope.session.user.id
  const [counts, limits] = await Promise.all([
    countInviterWindows(event, scope, inviterUserId),
    readMemberLimits(event, scope, inviterUserId),
  ])

  return {
    data: {
      daily_limit: limits.daily,
      weekly_limit: limits.weekly,
      sent_day: counts.sent24h,
      sent_week: counts.sent7d,
      remaining_day: Math.max(0, limits.daily - counts.sent24h),
      remaining_week: Math.max(0, limits.weekly - counts.sent7d),
      counts_verified: counts.countsVerified,
    },
  }
})
