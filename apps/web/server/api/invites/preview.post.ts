import { getPortalScope } from '../../utils/portal'
import {
  INVITE_AGE_BANDS,
  INVITE_CHANNELS,
  INVITE_RELATIONSHIPS,
  hashInvitePhone,
  inviteCapabilities,
  isInviteSuppressed,
  isMinorBand,
  loadInviteEvent,
  normalizeInvitePhone,
  renderInvitePreview,
  requireInviteCap,
  throwInviteValidation,
} from '../../utils/event-invites'

/**
 * Rendered-message preview before queue (AFC-480, prd-addendum-v4 §3.2
 * steps 2-3, US-E1 AC2). No DB write: the member confirms this exact text,
 * then POST /api/invites creates the row WITH the snapshot. A suppressed
 * number is reported here (409) so the member learns before confirming.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  const caps = inviteCapabilities(scope.role)
  requireInviteCap(caps, 'create', 'preview event invitations')

  const body = await readBody<Record<string, unknown>>(event)
  const eventId = typeof body.event === 'string' ? body.event : ''
  const inviteeName = typeof body.invitee_name === 'string' ? body.invitee_name.trim() : ''
  const phone = normalizeInvitePhone(body.invitee_phone)
  const channel = typeof body.channel_choice === 'string' ? body.channel_choice : 'auto'
  const ageBand = typeof body.invitee_age_band === 'string' ? body.invitee_age_band : 'unknown'
  const guardian = normalizeInvitePhone(body.guardian_phone)
  const relationship = typeof body.invitee_relationship === 'string' ? body.invitee_relationship : null
  const note = typeof body.inviter_note === 'string' ? body.inviter_note.trim().slice(0, 280) : ''

  const fields: Record<string, string> = {}
  if (!eventId) fields.event = 'Choose an event to invite to'
  if (!inviteeName) fields.invitee_name = 'Enter the invitee name'
  if (!phone) fields.invitee_phone = 'Enter the invitee phone number'
  else if (phone.replace(/\D/g, '').length < 7) fields.invitee_phone = 'That number looks too short'
  if (!INVITE_CHANNELS.includes(channel as never)) fields.channel_choice = 'Pick WhatsApp, SMS or automatic'
  if (!INVITE_AGE_BANDS.includes(ageBand as never)) fields.invitee_age_band = 'Pick an age band'
  if (relationship !== null && !INVITE_RELATIONSHIPS.includes(relationship as never)) {
    fields.invitee_relationship = 'Pick a relationship or leave it blank'
  }
  if (isMinorBand(ageBand) && !guardian) {
    fields.guardian_phone = 'A guardian number is required for a child or teen invitee'
  }
  if (Object.keys(fields).length > 0) throwInviteValidation(fields)

  const brief = await loadInviteEvent(event, scope, eventId)
  if (!brief.invite_eligible) {
    throw createError({
      statusCode: 400,
      statusMessage: 'That event is not open for member invitations',
      data: { code: 'event_not_invite_eligible' },
    })
  }
  if (brief.visibility === 'branch' && !scope.isArea) {
    const sameBranch = brief.branch !== null && scope.branchIds.includes(brief.branch)
    if (!sameBranch) {
      throw createError({
        statusCode: 403,
        statusMessage: 'Branch-private events need an inviter from the same branch',
        data: { code: 'branch_private_requires_same_branch_inviter' },
      })
    }
  }

  const contactHash = hashInvitePhone(phone)
  if (await isInviteSuppressed(event, scope, contactHash)) {
    throw createError({
      statusCode: 409,
      statusMessage: 'That number opted out of messages and cannot be invited',
      data: { code: 'suppressed', status: 'blocked_optout' },
    })
  }

  const inviterName = scope.session.user.firstName?.trim() || scope.session.user.email
  const variables = {
    invitee_name: inviteeName,
    inviter_name: inviterName,
    event_name: brief.title,
    event_datetime: brief.start_at ?? 'date to be confirmed',
    event_location: brief.location ?? '',
    branch_name: '',
    inviter_note: note,
    rsvp_link: `/events/${brief.id}/register`,
  }
  return {
    data: {
      rendered: renderInvitePreview(variables),
      variables,
      channel_choice: channel,
      suppressed: false,
      eligibility: { eligible: true, requires_approval: brief.invite_requires_approval },
    },
  }
})
