import { blessingBulkFormSchema } from '@afc/shared'
import {
  createItem,
  getPortalScope,
  listItems,
  requireCan,
  requireZoneInScope,
  resolveBranch,
  scopeZoneIds,
  throwValidation,
  updateItem,
} from '../../utils/portal'

interface BatchRowResult {
  blessing_type: string
  other_label: string | null
  count: number
  status: 'created' | 'updated' | 'skipped'
  id: string | null
  error?: string
}

/**
 * POST /api/blessings/batch — one-screen bulk entry (AFC-671 §A).
 *
 * One Save writes N rows in one request: the six blessing types at once
 * with a single count each. Rows with count 0 (and no other label) are
 * skipped, never stored as empty facts. Every written row is idempotent
 * per type per program: an existing row on the same branch + service_date
 * + type + label + program links is updated, otherwise created.
 *
 * Scope is unchanged (requireCan + resolveBranch + requireZoneInScope);
 * the response reports per-row results with row-level errors, never a
 * bare 500: failures carry { code, fields }.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'blessings', 'create')

  const parsed = blessingBulkFormSchema.safeParse(await readBody(event))
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

  const program = {
    zone: form.zone ?? null,
    bsc: form.bsc ?? null,
    session: form.session ?? null,
    event: form.event ?? null,
    sunday_service: form.sunday_service ?? null,
  }

  const now = new Date().toISOString()
  const results: BatchRowResult[] = []

  for (const row of form.rows) {
    const count = Number(row.count ?? 0)
    const label = row.other_label?.trim() || null
    if (count <= 0 && !(row.blessing_type === 'other' && label)) {
      results.push({
        blessing_type: row.blessing_type,
        other_label: label,
        count: 0,
        status: 'skipped',
        id: null,
      })
      continue
    }
    try {
      // Idempotency per type per program: the same branch + date + type +
      // label + program links resolve to one row.
      const eqOrNull = (value: string | null) =>
        value ? { _eq: value } : { _null: true }
      const existing = await listItems<Record<string, unknown>>(
        event,
        scope,
        'blessings',
        {
          filter: {
            branch: { _eq: branch },
            service_date: { _eq: form.service_date },
            blessing_type: { _eq: row.blessing_type },
            ...(label
              ? { other_label: { _eq: label } }
              : { other_label: { _null: true } }),
            session: eqOrNull(program.session),
            event: eqOrNull(program.event),
            sunday_service: eqOrNull(program.sunday_service),
          },
          fields: ['id'],
          limit: 1,
          page: 1,
        },
      )
      const body = {
        blessing_type: row.blessing_type,
        other_label: label,
        count,
        male_count: count,
        female_count: 0,
        branch,
        zone: program.zone,
        bsc: program.bsc,
        session: program.session,
        event: program.event,
        sunday_service: program.sunday_service,
        service_date: form.service_date,
        recorded_by: scope.session.user.id,
        notes: form.notes ?? null,
        updated_at: now,
      }
      const found = existing.data[0]
      if (found) {
        const updated = await updateItem<Record<string, unknown>>(
          event,
          scope,
          'blessings',
          String(found.id),
          body,
        )
        await createItem(event, scope, 'blessing_events', {
          blessing: String(found.id),
          event_type: 'updated',
          detail: `${row.blessing_type.replace(/_/g, ' ')} bulk-updated to ${count} for ${form.service_date}`,
          actor_user: scope.session.user.id,
          created_at: now,
        })
        results.push({
          blessing_type: row.blessing_type,
          other_label: label,
          count,
          status: 'updated',
          id: String(updated.id ?? found.id),
        })
      } else {
        const created = await createItem<Record<string, unknown>>(
          event,
          scope,
          'blessings',
          {
            ...body,
            created_at: now,
          },
        )
        await createItem(event, scope, 'blessing_events', {
          blessing: String(created.id),
          event_type: 'created',
          detail:
            `${row.blessing_type.replace(/_/g, ' ')} recorded for ${form.service_date}` +
            `${label ? ` — ${label}` : ''}`,
          actor_user: scope.session.user.id,
          created_at: now,
        })
        results.push({
          blessing_type: row.blessing_type,
          other_label: label,
          count,
          status: 'created',
          id: String(created.id),
        })
      }
    } catch (cause) {
      const error = cause as { message?: string }
      results.push({
        blessing_type: row.blessing_type,
        other_label: label,
        count,
        status: 'skipped',
        id: null,
        error: error.message ?? 'Could not save this row',
      })
    }
  }

  return {
    data: results,
    meta: {
      created: results.filter((row) => row.status === 'created').length,
      updated: results.filter((row) => row.status === 'updated').length,
      skipped: results.filter((row) => row.status === 'skipped').length,
    },
  }
})
