import { z } from 'zod'
import {
  CUSTOM_FORM_FIELD_LIMIT,
  CUSTOM_FORM_FIELD_TYPES,
  isCustomFormModule,
  validateCustomFormFields,
  type CustomFormFieldDef,
} from '@afc/shared'
import {
  createItem,
  getPortalScope,
  throwStoreUnavailable,
  throwValidation,
} from '../../utils/portal'
import { requireArea } from '../../utils/admin-guard'
import { readModuleColumns } from '../../utils/custom-forms'
import { isUniqueViolation } from '../../utils/event-invites'

const fieldSchema = z.object({
  key: z.string().trim().min(1).max(63),
  label: z.string().trim().min(1).max(80),
  type: z.enum(CUSTOM_FORM_FIELD_TYPES),
  required: z.boolean(),
  options: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
})

const bodySchema = z.object({
  name: z.string().trim().min(1).max(80),
  module: z.string().trim().min(1),
  fields: z.array(fieldSchema).min(1).max(CUSTOM_FORM_FIELD_LIMIT),
})

/**
 * POST /api/custom-forms — define a form (AFC-897).
 * Area-only (requireArea): definitions are global taxonomy, like the
 * expense categories next door. Keys must be live DB columns of the
 * linked module and the required set must cover the NOT NULL-no-default
 * columns, both checked against live Directus introspection -- the
 * database, not a checked-in copy, is the source of truth. Duplicate
 * (module, name) 409s on the 0061 unique pair.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireArea(event)

  const body = ((await readBody(event)) ?? {}) as Record<string, unknown>
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data
  if (!isCustomFormModule(form.module)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Custom forms link to a v1 module',
      data: { code: 'unknown_module' },
    })
  }
  const live = await readModuleColumns(event, form.module)
  const problems = validateCustomFormFields(
    form.module,
    form.fields as CustomFormFieldDef[],
    live,
  )
  if (problems.length > 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'The form cannot produce a valid row',
      data: { code: 'invalid_definition', fields: { fields: problems[0] } },
    })
  }
  try {
    const created = await createItem<Record<string, unknown>>(
      event,
      scope,
      'custom_forms',
      {
        name: form.name,
        module: form.module,
        schema: { version: 1, fields: form.fields },
        created_by: scope.session.user.id,
      },
    )
    return { data: created }
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'That module already has a form with this name',
        data: { code: 'duplicate_form', fields: { name: 'Pick a unique name' } },
      })
    }
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'custom_form_store', '0061')
  }
})
