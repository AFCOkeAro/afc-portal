import { z } from 'zod'
import { visibleProgrammeIds } from '../../../utils/campus'
import {
  createItem,
  findScopedItem,
  getPortalScope,
  requireCan,
  throwValidation,
} from '../../../utils/portal'

const facilitatorFormSchema = z.object({
  person: z.string().uuid('Choose a person'),
  programme: z.string().uuid('Choose a programme'),
  subject: z.string().max(200).nullish(),
  registration_date: z.string().date().nullish(),
  call_status: z
    .enum(['registered', 'called', 'confirmed', 'declined'])
    .default('registered'),
  status: z.enum(['active', 'inactive']).default('active'),
})

/**
 * POST /api/campus/facilitators — register a facilitator (US-C1 AC2).
 *
 * One assignment per (programme, person) is a partial-unique at the DB
 * layer; a duplicate registration surfaces as a 409 here, not a silent
 * second row. The programme must be inside the caller's visible set.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'coaching_facilitators', 'create')

  const parsed = facilitatorFormSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

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

  const now = new Date().toISOString()
  try {
    const created = await createItem<Record<string, unknown>>(
      event,
      scope,
      'coaching_facilitators',
      {
        person: form.person,
        programme: form.programme,
        subject: form.subject ?? null,
        registration_date: form.registration_date ?? null,
        call_status: form.call_status,
        status: form.status,
        created_at: now,
        updated_at: now,
      },
    )
    return { data: { ...created, id: String(created.id) } }
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      (error as { statusCode?: number }).statusCode === 409
    ) {
      throw error
    }
    const message = error instanceof Error ? error.message : String(error)
    if (/duplicate|unique|23505/i.test(message)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'That person is already registered for this programme',
        data: { code: 'duplicate_facilitator' },
      })
    }
    throw error
  }
})
