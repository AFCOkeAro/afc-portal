import { referralFormSchema } from '@afc/shared'
import {
  createItem,
  getPortalScope,
  requireCan,
  throwValidation,
} from '../../utils/portal'

/**
 * POST /api/referrals — record an invite-a-friend referral (US-E2 AC1).
 * A re-invite after decline is a new row (no uniqueness); counts on the
 * event de-duplicate by invitee. Public registrations (matrix `none: C`)
 * arrive through the public event form, never this staff route.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'event_referrals', 'create')

  const parsed = referralFormSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  const now = new Date().toISOString()
  const created = await createItem<Record<string, unknown>>(
    event,
    scope,
    'event_referrals',
    {
      event: form.event,
      inviter: form.inviter ?? scope.session.user.personId ?? null,
      invitee_name: form.invitee_name,
      invitee_person: form.invitee_person ?? null,
      branch: scope.branchIds[0] ?? null,
      zone: scope.zoneIds[0] ?? null,
      invite_date: now.slice(0, 10),
      status: form.status,
      created_at: now,
    },
  )
  return { data: { ...created, id: String(created.id) } }
})
