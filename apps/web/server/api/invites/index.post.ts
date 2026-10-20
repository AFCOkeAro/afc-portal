import { createItem, getPortalScope, resolveBranch } from '../../utils/portal'
import {
  INVITE_AGE_BANDS,
  INVITE_CHANNELS,
  INVITE_RELATIONSHIPS,
  claimInviteQuota,
  countInviterWindows,
  hashInvitePhone,
  inviteCapabilities,
  isInviteSuppressed,
  isMemberSession,
  isMinorBand,
  loadInviteEvent,
  normalizeInvitePhone,
  readMemberLimits,
  redactInviteForMember,
  renderInvitePreview,
  requiresGuardianBand,
  requireInviteCap,
  throwInviteValidation,
  throwOnForgedInviterIdentity,
  validateInviterNote,
} from '../../utils/event-invites'
import type { InviteRow } from '../../utils/event-invites'

/**
 * Submit an invite (AFC-480, US-E1). Preview-then-confirm: the row is
 * created WITH the rendered message + variables snapshot, so the DB never
 * needs a later UPDATE of frozen columns. Outcomes:
 *   suppressed number  -> created as blocked_optout (auditable, never queued)
 *   quota claim fails  -> created as blocked_rate_limit + approval_required
 *   event-level approval flag -> pending_approval + approval_required
 *   otherwise          -> queued (single send only; later messages need a
 *                         real consent grant, §3.3 -- no drip).
 * Minor without a guardian number is rejected at creation (400, and the DB
 * CHECK pins it too). Staff cannot override an opt-out: blocked_optout rows
 * have no approval path (approve route refuses them).
 *
 * F3 CLOSED (AFC-516, ADR-0011 ledger-slot claim): the quota verdict is the
 * atomic `claimInviteQuota` below, not the rolling count. Concurrent writers
 * claim slots by INSERT into invite_quota_slots and serialize on the UNIQUE
 * (inviter_user, period, period_start, slot_no): exactly D day-winners and W
 * week-winners exist regardless of interleaving. `countInviterWindows` stays
 * only as the advisory UX pre-check feeding the blocked-reason text; it
 * decides nothing. The claim guarantees the cap is never queued past; it
 * does NOT guarantee quota is never wasted -- crash orphans between claim
 * and invite write (or between claim and release) consume a slot in the
 * fail-safe direction (blocks more, never queues past the limit), so there
 * is deliberately no sweeper. Windows are calendar windows in Africa/Lagos
 * (day resets at 00:00 Lagos, week is Monday-to-Sunday Lagos); the previous
 * rolling-24h/7d reading was the approximation this replaces.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  const caps = inviteCapabilities(scope.role)
  requireInviteCap(caps, 'create', 'submit event invitations')

  const body = await readBody<Record<string, unknown>>(event)
  // F2 (AFC-512 S8): inviter identity is session-derived; a body carrying
  // inviter_* values is forgery -> 403, never silently overwritten.
  throwOnForgedInviterIdentity(body)
  const eventId = typeof body.event === 'string' ? body.event : ''
  const inviteeName =
    typeof body.invitee_name === 'string' ? body.invitee_name.trim() : ''
  const phone = normalizeInvitePhone(body.invitee_phone)
  const channel = typeof body.channel_choice === 'string' ? body.channel_choice : 'auto'
  const ageBand =
    typeof body.invitee_age_band === 'string' ? body.invitee_age_band : 'unknown'
  const guardian = normalizeInvitePhone(body.guardian_phone)
  const relationship =
    typeof body.invitee_relationship === 'string' ? body.invitee_relationship : null
  // F7: note bound to 140 chars, no URLs/phone numbers, delimited render.
  const { note, error: noteError } = validateInviterNote(body.inviter_note)
  // F5: explicit guardian attestation for child/teen/unknown, staff-confirmable.
  const guardianAttested = body.guardian_attested === true

  const fields: Record<string, string> = {}
  if (!eventId) fields.event = 'Choose an event to invite to'
  if (!inviteeName) fields.invitee_name = 'Enter the invitee name'
  if (!phone) fields.invitee_phone = 'Enter the invitee phone number'
  else if (phone.replace(/\D/g, '').length < 7)
    fields.invitee_phone = 'That number looks too short'
  if (!INVITE_CHANNELS.includes(channel as never))
    fields.channel_choice = 'Pick WhatsApp, SMS or automatic'
  if (!INVITE_AGE_BANDS.includes(ageBand as never))
    fields.invitee_age_band = 'Pick an age band'
  if (relationship !== null && !INVITE_RELATIONSHIPS.includes(relationship as never)) {
    fields.invitee_relationship = 'Pick a relationship or leave it blank'
  }
  // F5: unknown defaults to the guardian path (never treated as adult).
  if (requiresGuardianBand(ageBand) && !guardian) {
    fields.guardian_phone =
      'A guardian number is required for a child, teen or unknown-age invitee'
  }
  if (isMinorBand(ageBand) && !guardianAttested) {
    fields.guardian_attested =
      'Confirm that a guardian agreed to this invitation so staff can verify it'
  }
  if (noteError) fields.inviter_note = noteError
  const inviterPerson = scope.session.user.personId
  if (!inviterPerson) {
    fields.inviter =
      'Your login is not linked to a member record yet; ask your branch admin to link it'
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

  const branch = resolveBranch(scope, brief.branch, { allowAreaWide: true })
  const contactHash = hashInvitePhone(phone)
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
  const rendered = renderInvitePreview(variables)

  // STOP/opt-out: recorded as blocked_optout, never queued, no approval path.
  if (await isInviteSuppressed(event, scope, contactHash)) {
    const blocked = await createItem<Record<string, unknown>>(
      event,
      scope,
      'event_invites',
      {
        event: eventId,
        branch,
        inviter_person: inviterPerson,
        inviter_user: scope.session.user.id,
        invitee_name: inviteeName,
        invitee_phone: phone,
        invitee_contact_hash: contactHash,
        invitee_relationship: relationship,
        invitee_age_band: ageBand,
        guardian_phone: guardian || null,
        channel_choice: channel,
        consent_basis: 'inviter_vouched',
        message_rendered: rendered,
        variables_snapshot: variables,
        status: 'blocked_optout',
        approval_required: false,
        blocked_reason:
          'That number opted out of messages (STOP); staff cannot override an opt-out',
      },
    )
    return { data: { ...blocked, id: String(blocked.id) } }
  }

  // Atomic member quota (AFC-516, ADR-0011): the claim is AUTHORITATIVE.
  // The rolling count below is advisory only -- it feeds the blocked-reason
  // text so the member learns the numbers, but it decides nothing. Suppressed
  // (STOP) numbers returned above and never claim.
  const inviterUserId = scope.session.user.id
  const [counts, limits] = await Promise.all([
    countInviterWindows(event, scope, inviterUserId),
    readMemberLimits(event, scope, inviterUserId),
  ])
  const claim = await claimInviteQuota(event, scope, inviterUserId, limits)

  let status = 'queued'
  let approvalRequired = false
  let blockedReason: string | null = null
  if (!claim.allowed) {
    status = 'blocked_rate_limit'
    approvalRequired = true
    blockedReason =
      `Member invite limit reached: ${counts.sent24h} sent in the last 24h ` +
      `(limit ${limits.daily}), ${counts.sent7d} in the last 7 days (limit ${limits.weekly}). ` +
      `Your branch admin can approve this invite.`
  } else if (brief.invite_requires_approval) {
    status = 'pending_approval'
    approvalRequired = true
    blockedReason = 'That event needs staff approval for invitations.'
  }

  let created: Record<string, unknown>
  try {
    created = await createItem<Record<string, unknown>>(event, scope, 'event_invites', {
      event: eventId,
      branch,
      inviter_person: inviterPerson,
      inviter_user: inviterUserId,
      invitee_name: inviteeName,
      invitee_phone: phone,
      invitee_contact_hash: contactHash,
      invitee_relationship: relationship,
      invitee_age_band: ageBand,
      guardian_phone: guardian || null,
      channel_choice: channel,
      consent_basis: 'inviter_vouched',
      message_rendered: rendered,
      variables_snapshot: variables,
      status,
      approval_required: approvalRequired,
      blocked_reason: blockedReason,
    })
  } catch (error) {
    // No leaked quota on the handled path: a failed invite write releases
    // the claimed slots before the error propagates. Crash orphans (the
    // process dying between claim and release) waste quota in the fail-safe
    // direction -- they block more, never queue past the limit.
    if (claim.allowed) await claim.release()
    throw error
  }

  // A member-shaped session (track d) reads back the redacted projection;
  // staff read the full row they just wrote.
  if (isMemberSession(scope)) {
    return {
      data: redactInviteForMember({
        ...(created as object),
        id: String(created.id),
      } as InviteRow),
    }
  }
  return {
    data: { ...created, id: String(created.id) },
    meta: { countsVerified: counts.countsVerified },
  }
})
