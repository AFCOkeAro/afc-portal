import { z } from 'zod'
import { coachingProgrammeScopeFilter } from '../../../utils/campus'
import {
  createItem,
  getPortalScope,
  requireCan,
  requireZoneInScope,
  resolveBranch,
  scopeZoneIds,
  throwValidation,
} from '../../../utils/portal'

const programmeFormSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(200),
  exam: z.enum(['waec', 'utme', 'other']),
  year: z.number().int().min(1900).max(2100).nullish(),
  area: z.string().uuid().nullish(),
  zone: z.string().uuid().nullish(),
  branch: z.string().uuid().nullish(),
  scope_note: z.string().max(2000).nullish(),
  status: z.enum(['active', 'inactive']).default('active'),
})

/**
 * POST /api/campus/programmes — create a coaching programme (US-C1 AC1).
 *
 * Scope lands on the programme's own columns: branch staff default to their
 * own branch (an area-wide programme needs an explicit null from area
 * staff). Institutions are reference-only (SELECT ceiling, migration 0003
 * choice), so programmes never create institutions here.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'coaching_programmes', 'create')

  const parsed = programmeFormSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  const branch = resolveBranch(scope, form.branch, { allowAreaWide: true })
  if (!scope.isArea && !branch) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A branch is required for non-area staff',
      data: { code: 'validation_error', fields: { branch: 'Choose a branch' } },
    })
  }

  const visibleZones = await scopeZoneIds(event, scope)
  requireZoneInScope(scope, form.zone ?? null, visibleZones)

  // A branch-scoped caller cannot file a programme under a zone they cannot see.
  if (!scope.isArea && scope.zoneIds.length === 0 && branch) {
    await coachingProgrammeScopeFilter(event, scope, { branch })
  }

  const now = new Date().toISOString()
  const created = await createItem<Record<string, unknown>>(
    event,
    scope,
    'coaching_programmes',
    {
      name: form.name,
      exam: form.exam,
      year: form.year ?? null,
      area: form.area ?? null,
      zone: form.zone ?? null,
      branch,
      scope_note: form.scope_note ?? null,
      status: form.status,
      created_at: now,
      updated_at: now,
    },
  )

  return { data: { ...created, id: String(created.id) } }
})
