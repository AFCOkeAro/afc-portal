import {
  MARRIAGE_CASE_STAGES,
  MARRIAGE_FORM_KEYS,
  marriageFormPayloadSchemas,
  marriageFormSubmitSchema,
} from '@afc/shared'
import {
  assertUuidParam,
  createItem,
  findScopedItem,
  getPortalScope,
  requireCan,
  scopeFilter,
  throwValidation,
} from '../../../utils/portal'
import { officeZoneScope } from '../../../utils/office'

/**
 * POST /api/marriage-cases/:id/forms — submit one source form (AFC-677
 * phase B). The `form_key` selects its zod shape from
 * `marriageFormPayloadSchemas`; a closed case refuses; `stage` (when sent)
 * must name a pipeline stage or the row is rejected here with
 * {code, fields} -- the DB only pins the key vocabulary.
 * Resubmission appends; readers take the latest row per key.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'marriage_case_forms', 'create')

  const parsed = marriageFormSubmitSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)
  const { form_key: formKey, stage, payload } = parsed.data

  if (!MARRIAGE_FORM_KEYS.includes(formKey)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Unknown marriage form',
      data: { code: 'validation_error', fields: { form_key: 'Choose a known form' } },
    })
  }
  const shape = marriageFormPayloadSchemas[formKey]
  const shaped = shape.safeParse(payload ?? {})
  if (!shaped.success) throwValidation(shaped.error, `The ${formKey} form needs attention`)

  if (stage !== undefined && !(MARRIAGE_CASE_STAGES as readonly string[]).includes(stage)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Unknown pipeline stage',
      data: { code: 'validation_error', fields: { stage: 'Record the stage at submission time' } },
    })
  }

  const id = assertUuidParam(
    String(getRouterParam(event, 'id')),
    'case',
    'invalid_case_id',
  )
  const row = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'marriage_cases',
    id,
    { scope: { ...scopeFilter(scope), ...officeZoneScope(scope) } },
  )
  if (['halted', 'transferred_out', 'reported'].includes(String(row.stage))) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A closed case takes no more forms',
      data: { code: 'validation_error', fields: { form_key: 'This file is closed' } },
    })
  }

  const now = new Date().toISOString()
  let saved: Record<string, unknown>
  try {
    saved = await createItem<Record<string, unknown>>(event, scope, 'marriage_case_forms', {
      marriage_case: id,
      form_key: formKey,
      stage: stage ?? String(row.stage),
      payload: shaped.data,
      submitted_by: scope.session.user.id,
      created_at: now,
      updated_at: now,
    })
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    throw createError({
      statusCode: 503,
      statusMessage: 'The marriage forms store is unavailable (migration 0036 not applied?)',
      data: { code: 'pending_migration_0036', cause: String(error) },
    })
  }

  return { data: saved }
})
