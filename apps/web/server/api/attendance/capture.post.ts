import { z } from 'zod'
import {
  ATTENDANCE_CATEGORIES,
  SERVICE_TYPE_KEYS,
  attendanceCountSchema,
  dateSchema,
  optionalText,
} from '@afc/shared'
import { directusFetch } from '../../utils/directus'
import { isUniqueViolation } from '../../utils/event-invites'
import {
  createItem,
  getPortalScope,
  listItems,
  requireCan,
  requireZoneInScope,
  resolveBranch,
  scopeZoneIds,
  throwStoreUnavailable,
  throwValidation,
} from '../../utils/portal'

/**
 * Split capture (AFC-468 US-A1). One request carries the session header plus
 * one row per (category, sex); the unique (session, category, sex) constraint
 * turns a replayed batch into upsert no-ops, and the unique idempotency_key
 * turns a double-submitted session into a 409 refusal rather than a twin
 * (attendance-flows.md §3; suite 71 §§71.4–71.5 pins both).
 *
 * Category enforcement is per service type: the body may only name categories
 * the active service_type_definitions row for the chosen service type offers.
 * The form renders exactly that ordered set, so a rejection here means the
 * caller bypassed the form.
 */
/**
 * One split row. The session comes from the created header, not the row, so
 * the per-row `session` of the shared batch schema is omitted here and the
 * other-label rule is restated so the error still points at the label input.
 */
const captureRowSchema = attendanceCountSchema
  .innerType()
  .omit({ session: true })
  .refine(
    (row) =>
      row.category !== 'other' ||
      (typeof row.category_other_label === 'string' &&
        row.category_other_label.trim().length > 0),
    { message: 'Name the other category', path: ['category_other_label'] },
  )

const captureBodySchema = z.object({
  branch: optionalText(36),
  zone: optionalText(36),
  bsc: optionalText(36),
  session_date: dateSchema,
  session_type: z.enum(SERVICE_TYPE_KEYS).default('sunday_service'),
  session_name: z.string().trim().min(1, 'Name the session').max(200),
  service: optionalText(36),
  event: optionalText(36),
  idempotency_key: z.string().trim().min(1).max(128),
  recorded_at: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), {
      message: 'Expected an ISO 8601 timestamp',
    })
    .optional(),
  rows: z.array(captureRowSchema).min(1, 'Record at least one category'),
})

interface DefinitionRow {
  id: string | number
  key: string
  categories: string[] | string
}

interface CountRow {
  id: string | number
  category: string
  sex: string
  count: number
}

function asCategories(value: string[] | string): string[] {
  if (Array.isArray(value)) return value
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'attendance_sessions', 'create')
  requireCan(scope, 'attendance_counts', 'create')

  const parsed = captureBodySchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  const branch = resolveBranch(scope, form.branch)
  const visibleZones = await scopeZoneIds(event, scope)
  requireZoneInScope(scope, form.zone, visibleZones)
  if (!scope.isArea && form.zone && scope.zoneIds.length === 0) {
    // Branch-only staff cannot file into a zone grant they do not hold; their
    // own zone is derived from their branches.
    if (!visibleZones.includes(form.zone)) {
      throw createError({
        statusCode: 403,
        statusMessage: 'That zone is outside your scope',
        data: { code: 'zone_out_of_scope' },
      })
    }
  }

  const definitions = await listItems<DefinitionRow>(
    event,
    scope,
    'service_type_definitions',
    {
      filter: { key: { _eq: form.session_type }, status: { _eq: 'active' } },
      fields: ['id', 'key', 'categories'],
      limit: 1,
    },
  )
  const definition = definitions.data[0]
  if (!definition) {
    throw createError({
      statusCode: 400,
      statusMessage: 'That service type is not available for capture',
      data: { code: 'unknown_service_type' },
    })
  }
  const allowed = asCategories(definition.categories)
  const allowedSet = new Set(allowed)
  for (const row of form.rows) {
    if (!allowedSet.has(row.category)) {
      throw createError({
        statusCode: 400,
        statusMessage: `Category ${row.category} is not offered for ${form.session_type}`,
        data: {
          code: 'category_not_offered',
          fields: {
            rows: `Category ${row.category} is not offered for this service type`,
          },
        },
      })
    }
    if (!ATTENDANCE_CATEGORIES.includes(row.category)) {
      throw createError({
        statusCode: 400,
        statusMessage: `Category ${row.category} is not a known category`,
        data: { code: 'validation_error' },
      })
    }
  }

  let session: Record<string, unknown>
  try {
    session = await createItem<Record<string, unknown>>(
      event,
      scope,
      'attendance_sessions',
      {
        branch: branch ?? null,
        zone: form.zone ?? null,
        bsc: form.bsc ?? null,
        session_date: form.session_date,
        session_type: form.session_type,
        session_name: form.session_name,
        service: form.service ?? null,
        event: form.event ?? null,
        service_type_def: String(definition.id),
        idempotency_key: form.idempotency_key,
        recorded_by: scope.session.user.id,
        recorded_at: form.recorded_at ?? new Date().toISOString(),
      },
    )
  } catch (cause) {
    // UNIQUE (idempotency_key): a second submit with the same key collides
    // instead of duplicating the session. Refusal, not a twin. Live
    // Directus surfaces the replay as 400 RECORD_NOT_UNIQUE (AFC-803), not
    // 409, so the canonical unique detector is the matcher: the header's
    // only unique constraint is idempotency_key, hence any unique violation
    // here is a replay.
    const status =
      (cause as { statusCode?: number; status?: number })?.statusCode ??
      (cause as { statusCode?: number; status?: number })?.status
    if (status === 409 || isUniqueViolation(cause)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'This capture was already saved',
        data: { code: 'duplicate_capture' },
      })
    }
    // AFC-566: a missing/unreadable sessions register arrives here without
    // a status (DirectusAuthError) — map it to the named store error, never
    // a bare 500. Deliberate 4xx keep their codes.
    if (status == null) throwStoreUnavailable(cause, 'attendance_store', '0023')
    throw cause
  }
  const sessionId = String(session.id)

  // Convergent upsert: read the rows the session already holds, write only
  // what differs, and leave replays as no-ops. The DB unique constraint is
  // the backstop; this loop is what makes a retry cheap.
  //
  // attendance_counts.created_by REFERENCES people(id) (0003:159), so the
  // filed value is the linked person (nullable), never the Directus user
  // UUID — a login without a linked person (personId null) omits the column
  // instead of tripping INVALID_FOREIGN_KEY on every capture (AFC-803).
  const personId = scope.session.user.personId
  try {
    const existing = await listItems<CountRow>(event, scope, 'attendance_counts', {
      filter: { session: { _eq: sessionId } },
      fields: ['id', 'category', 'sex', 'count'],
      limit: -1,
    })
    const byKey = new Map(existing.data.map((row) => [`${row.category}|${row.sex}`, row]))
    for (const row of form.rows) {
      const current = byKey.get(`${row.category}|${row.sex}`)
      if (current && Number(current.count) === row.count) continue
      if (current) {
        await directusFetch(event, `/items/attendance_counts/${current.id}`, {
          method: 'PATCH',
          accessToken: scope.token,
          body: {
            count: row.count,
            category_other_label: row.category_other_label ?? null,
          },
        })
      } else {
        await createItem(event, scope, 'attendance_counts', {
          session: sessionId,
          category: row.category,
          category_other_label: row.category_other_label ?? null,
          sex: row.sex,
          count: row.count,
          ...(personId ? { created_by: personId } : {}),
        })
      }
    }
  } catch (cause) {
    // The header is already written and directus_app holds no DELETE on
    // either attendance table (least-privilege ceiling, 0003 §4 / 0023 §4),
    // so this route cannot clean the header up — granting that would widen
    // the privilege boundary, which is a CTO-gated migration, not a capture
    // fix. Fail closed with a named error instead of leaking raw Directus,
    // and keep deliberate 4xx codes untouched (AFC-566 pattern).
    const rowsStatus =
      (cause as { statusCode?: number; status?: number })?.statusCode ??
      (cause as { statusCode?: number; status?: number })?.status
    if (rowsStatus == null) throwStoreUnavailable(cause, 'attendance_store', '0023')
    throw cause
  }

  const total = form.rows.reduce((sum, row) => sum + row.count, 0)

  return {
    data: {
      ...session,
      id: sessionId,
      total,
      rows_saved: form.rows.length,
    },
  }
})
