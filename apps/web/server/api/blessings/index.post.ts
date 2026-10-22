import { blessingFormSchema } from '@afc/shared'
import {
  createItem,
  getPortalScope,
  requireCan,
  requireZoneInScope,
  resolveBranch,
  scopeZoneIds,
  throwValidation,
} from '../../utils/portal'

/**
 * POST /api/blessings — record blessings for a service/program (US-B1).
 *
 * One row per blessing type; a program records multiple types by calling
 * once per type (single) or once for all types (POST /api/blessings/batch).
 * Branch resolves to the caller's own branch for branch staff; area staff
 * must name a branch, because a blessing with no branch has no scope and
 * would be invisible fail-closed. total_count is never accepted in the
 * body -- Postgres derives it (migration 0011 GENERATED choice).
 *
 * Single-count (AFC-671): the form sends `count`. The route mirrors
 * male_count = count, female_count = 0 so GENERATED total stays equal to
 * count; legacy male/female inputs are accepted for import compat and
 * summed only when `count` is absent. The create writes the audit row
 * (blessing_events `created`) in the same request -- the portal is the
 * writer, the table is the trail.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'blessings', 'create')

  const parsed = blessingFormSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  const branch = resolveBranch(scope, form.branch)
  if (!branch) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A branch is required: a blessing with no branch has no scope',
      data: { code: 'validation_error', fields: { branch: 'Choose a branch' } },
    })
  }

  const visibleZones = await scopeZoneIds(event, scope)
  requireZoneInScope(scope, form.zone, visibleZones)
  if (
    !scope.isArea &&
    scope.zoneIds.length === 0 &&
    form.zone &&
    !visibleZones.includes(form.zone)
  ) {
    throw createError({
      statusCode: 403,
      statusMessage: 'That zone is outside your scope',
      data: { code: 'zone_out_of_scope' },
    })
  }

  // Single-count mirror (AFC-671): male carries the count, female stays 0,
  // so GENERATED total_count always equals the entered count. Legacy
  // male/female inputs are summed only when no count is sent (imports).
  const hasCount = form.count !== undefined && form.count !== null
  const count = hasCount
    ? Number(form.count ?? 0)
    : Number(form.male_count ?? 0) + Number(form.female_count ?? 0)
  const maleCount = hasCount ? count : Number(form.male_count ?? 0)
  const femaleCount = hasCount ? 0 : Number(form.female_count ?? 0)

  const now = new Date().toISOString()
  const created = await createItem<Record<string, unknown>>(event, scope, 'blessings', {
    blessing_type: form.blessing_type,
    other_label: form.other_label ?? null,
    count,
    male_count: maleCount,
    female_count: femaleCount,
    branch,
    zone: form.zone ?? null,
    bsc: form.bsc ?? null,
    session: form.session ?? null,
    event: form.event ?? null,
    sunday_service: form.sunday_service ?? null,
    service_date: form.service_date,
    recorded_by: scope.session.user.id,
    notes: form.notes ?? null,
    created_at: now,
    updated_at: now,
  })

  // Audit trail is written by the portal, not by the role: the matrix gives
  // non-admin roles read-only access to blessing events.
  await createItem(event, scope, 'blessing_events', {
    blessing: String(created.id),
    event_type: 'created',
    detail:
      `${form.blessing_type.replace(/_/g, ' ')} recorded for ${form.service_date}` +
      `${form.other_label ? ` — ${form.other_label}` : ''}`,
    actor_user: scope.session.user.id,
    created_at: now,
  })

  return { data: { ...created, id: String(created.id) } }
})
