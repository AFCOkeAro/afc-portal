import { z } from 'zod'
import {
  COACHING_TIMETABLE_FIELDS,
  timetableClashes,
  visibleProgrammeIds,
} from '../../../utils/campus'
import {
  createItem,
  findScopedItem,
  getPortalScope,
  listItems,
  requireCan,
  throwValidation,
} from '../../../utils/portal'

const DAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const

const TIME_RE = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/

const slotFormSchema = z.object({
  programme: z.string().uuid('Choose a programme'),
  subject: z.string().trim().min(1, 'Subject is required').max(200),
  facilitator: z.string().uuid().nullish(),
  day_of_week: z.enum(DAYS),
  start_time: z.string().regex(TIME_RE, 'Start time must be HH:MM').nullish(),
  end_time: z.string().regex(TIME_RE, 'End time must be HH:MM').nullish(),
  location: z.string().max(300).nullish(),
  capacity: z.number().int().min(0).nullish(),
  status: z.enum(['active', 'inactive']).default('active'),
})

/**
 * POST /api/campus/timetable — add a timetable slot (US-C1 AC1/AC2).
 *
 * The programme must be inside the caller's visible set (a crafted
 * cross-scope programme id is a 404, never a write). Clash detection is a
 * flag, not a refusal: the response carries `clashes` (same facilitator or
 * same location, same day, overlapping times) so the coordinator decides.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'coaching_timetable', 'create')

  const parsed = slotFormSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  if (form.start_time && form.end_time && form.start_time >= form.end_time) {
    throw createError({
      statusCode: 400,
      statusMessage: 'End time must be after start time',
      data: {
        code: 'validation_error',
        fields: { end_time: 'End time must be after start time' },
      },
    })
  }

  // Programme-in-scope check: branch/zone staff can only slot programmes
  // they can see; area staff may slot any programme.
  if (!scope.isArea) {
    const visible = await visibleProgrammeIds(event, scope)
    if (!visible.includes(form.programme)) {
      throw createError({
        statusCode: 404,
        statusMessage: 'That programme was not found in your scope',
        data: { code: 'not_found' },
      })
    }
  } else {
    await findScopedItem(event, scope, 'coaching_programmes', form.programme, {
      fields: ['id'],
    })
  }

  const existing = await listItems<Record<string, unknown>>(
    event,
    scope,
    'coaching_timetable',
    {
      filter: { programme: { _eq: form.programme } },
      fields: COACHING_TIMETABLE_FIELDS,
      limit: 200,
    },
  )

  const clashes = timetableClashes(
    {
      programme: form.programme,
      subject: form.subject,
      facilitator: form.facilitator ?? null,
      day_of_week: form.day_of_week,
      start_time: form.start_time ?? null,
      end_time: form.end_time ?? null,
      location: form.location ?? null,
    },
    existing.data.map((row) => ({
      id: row.id == null ? undefined : String(row.id),
      day_of_week: typeof row.day_of_week === 'string' ? row.day_of_week : null,
      start_time: typeof row.start_time === 'string' ? row.start_time : null,
      end_time: typeof row.end_time === 'string' ? row.end_time : null,
      facilitator: row.facilitator == null ? null : String(row.facilitator),
      location: typeof row.location === 'string' ? row.location : null,
    })),
  )

  const now = new Date().toISOString()
  const created = await createItem<Record<string, unknown>>(
    event,
    scope,
    'coaching_timetable',
    {
      programme: form.programme,
      subject: form.subject,
      facilitator: form.facilitator ?? null,
      day_of_week: form.day_of_week,
      start_time: form.start_time ?? null,
      end_time: form.end_time ?? null,
      location: form.location ?? null,
      capacity: form.capacity ?? null,
      status: form.status,
      created_at: now,
      updated_at: now,
    },
  )

  return {
    data: { ...created, id: String(created.id) },
    meta: {
      clashes: clashes
        .map((slot) => slot.id)
        .filter(Boolean)
        .map(String),
      clash_count: clashes.length,
    },
  }
})
