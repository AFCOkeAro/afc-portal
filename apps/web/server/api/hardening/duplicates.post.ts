import {
  createItem,
  getPortalScope,
  requireCan,
  updateItem,
} from '../../utils/portal'
import {
  HARDENING_COLLECTIONS,
  buildDuplicateWarning,
  validateDuplicateDecision,
} from '../../utils/hardening'

/**
 * Phone-identity duplicate warnings (AFC-486, US-N1 AC4).
 *
 * POST without a decision records the warning (pending): the branch admin
 * sees it before any merge. POST with a terminal decision (merged |
 * kept_separate) records the branch-admin decision with decider + reason.
 * NEVER a silent auto-merge: this route writes review rows only — it never
 * writes a person row, and a terminal state without decider + reason is
 * rejected before it reaches the database CHECK.
 *
 * Enforcement: warning list/create needs a people read grant; recording a
 * decision needs a people update grant (branch_admin holds both on their
 * own branch). The route additionally requires an explicit branch in scope
 * for non-area staff.
 */

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  const body = await readBody<{
    contact_hash?: unknown
    person_a?: unknown
    person_b?: unknown
    branch?: unknown
    status?: unknown
    decided_by?: unknown
    reason?: unknown
  }>(event)

  const status = typeof body.status === 'string' ? body.status : 'pending'
  if (status === 'pending') {
    requireCan(scope, 'people', 'read')
    const warning = buildDuplicateWarning({
      contactHash: typeof body.contact_hash === 'string' ? body.contact_hash : '',
      personA: typeof body.person_a === 'string' ? body.person_a : null,
      personB: typeof body.person_b === 'string' ? body.person_b : null,
      branch: typeof body.branch === 'string' ? body.branch : null,
    })
    try {
      const row = await createItem<{ id: string }>(event, scope, HARDENING_COLLECTIONS.duplicateReviews, {
        ...warning,
      })
      return { warned: true, id: row.id, status: 'pending' as const }
    } catch (error) {
      throw createError({
        statusCode: 503,
        statusMessage: 'Duplicate-review store unavailable (migration 0015 not applied?)',
        data: { code: 'pending_migration_0015', cause: String(error) },
      })
    }
  }

  requireCan(scope, 'people', 'update')
  validateDuplicateDecision({
    status,
    decidedBy: typeof body.decided_by === 'string' ? body.decided_by : null,
    reason: typeof body.reason === 'string' ? body.reason : null,
  })
  // The decision targets an existing pending review by its id, passed as
  // `review_id`. Kept as an explicit field so a decider can never smuggle
  // identity edits through a decision write.
  const parsed = body as { review_id?: unknown }
  const review = typeof parsed.review_id === 'string' ? parsed.review_id.trim() : ''
  if (!review) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A decision needs the pending review id (review_id)',
      data: { code: 'review_id_required' },
    })
  }
  try {
    const row = await updateItem<{ id: string }>(event, scope, HARDENING_COLLECTIONS.duplicateReviews, review, {
      status,
      decided_by: body.decided_by,
      decision_reason: body.reason,
      decided_at: new Date().toISOString(),
    })
    return { decided: true, id: row.id, status }
  } catch (error) {
    throw createError({
      statusCode: 503,
      statusMessage: 'Duplicate-review store unavailable (migration 0015 not applied?)',
      data: { code: 'pending_migration_0015', cause: String(error) },
    })
  }
})
