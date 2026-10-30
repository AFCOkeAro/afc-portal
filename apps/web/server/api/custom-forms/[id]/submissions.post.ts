import { z } from 'zod'
import {
  isCustomFormModule,
  validateSubmissionValues,
  type CustomFormFieldDef,
} from '@afc/shared'
import {
  createItem,
  getPortalScope,
  listItems,
  requireCan,
  resolveBranch,
  throwStoreUnavailable,
  throwValidation,
} from '../../../utils/portal'
import { readModuleColumns } from '../../../utils/custom-forms'

const bodySchema = z.object({
  values: z.record(z.string(), z.unknown()),
})

function isConstraintFailure(error: unknown): boolean {
  const status =
    (error as { statusCode?: number; status?: number })?.statusCode ??
    (error as { status?: number })?.status
  if (status === 400 || status === 409) return true
  const message = String((error as { message?: string })?.message ?? '').toLowerCase()
  return (
    message.includes('23502') ||
    message.includes('23503') ||
    message.includes('23505') ||
    message.includes('23514') ||
    message.includes('violates not-null') ||
    message.includes('violates check constraint') ||
    message.includes('duplicate key')
  )
}

/**
 * POST /api/custom-forms/:id/submissions — fill a form (AFC-897).
 * The filler must hold create on the LINKED module: a custom form never
 * widens who may write the register, it only narrows which columns a
 * write may touch. Values are checked against the stored definition, keys
 * re-checked against the live columns (a column dropped since the build
 * fails the fill, not the module), and `branch` is stamped from session
 * scope -- never accepted from the filler -- on modules that carry it.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)

  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: 'A form id is required' })
  }
  let form: Record<string, unknown>
  try {
    const found = await listItems<Record<string, unknown>>(event, scope, 'custom_forms', {
      filter: { id: { _eq: id } },
      fields: ['id', 'name', 'module', 'schema'],
      limit: 1,
    })
    const row = found.data[0]
    if (!row) {
      throw createError({
        statusCode: 404,
        statusMessage: 'That form was not found',
        data: { code: 'form_not_found' },
      })
    }
    form = row
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'custom_form_store', '0061')
  }
  const module = String(form.module ?? '')
  if (!isCustomFormModule(module)) {
    throw createError({
      statusCode: 410,
      statusMessage: 'That form links to a retired module',
      data: { code: 'retired_module' },
    })
  }
  requireCan(scope, module, 'create')

  const body = ((await readBody(event)) ?? {}) as Record<string, unknown>
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) throwValidation(parsed.error)
  const fields = (
    (form.schema as { fields?: CustomFormFieldDef[] } | null)?.fields ?? []
  ).filter((field) => typeof field?.key === 'string')
  const problems = validateSubmissionValues(
    fields,
    parsed.data.values as Record<string, unknown>,
  )
  if (problems.length > 0) {
    throw createError({
      statusCode: 400,
      statusMessage: problems[0],
      data: { code: 'invalid_values' },
    })
  }
  const live = await readModuleColumns(event, module)
  const liveNames = new Set(live.map((column) => column.name))
  for (const key of Object.keys(parsed.data.values)) {
    if (!liveNames.has(key)) {
      throw createError({
        statusCode: 400,
        statusMessage: `Column "${key}" no longer exists on ${module}`,
        data: { code: 'stale_definition' },
      })
    }
  }
  const payload: Record<string, unknown> = {}
  for (const field of fields) {
    const value = (parsed.data.values as Record<string, unknown>)[field.key]
    if (value === undefined) continue
    payload[field.key] = value
  }
  if (liveNames.has('branch') && payload.branch === undefined) {
    payload.branch = resolveBranch(scope, null)
  }
  try {
    const created = await createItem<Record<string, unknown>>(
      event,
      scope,
      module,
      payload,
    )
    return { data: created }
  } catch (error) {
    if (isConstraintFailure(error)) {
      throw createError({
        statusCode: 400,
        statusMessage:
          'The module refused this fill: a required rule outside the form fired',
        data: {
          code: 'module_refused',
          detail: String((error as { message?: string })?.message ?? error).slice(0, 200),
        },
      })
    }
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, `${module}_store`, '0061')
  }
})
