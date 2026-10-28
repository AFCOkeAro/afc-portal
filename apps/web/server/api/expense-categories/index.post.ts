import { z } from 'zod'
import { createItem, getPortalScope, throwValidation } from '../../utils/portal'
import { requireArea } from '../../utils/admin-guard'
import { isUniqueViolation } from '../../utils/event-invites'

const categoryKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9_]+$/, 'Use lowercase letters, digits and underscores')

/**
 * POST /api/expense-categories — add a spend category (AFC-825).
 * Area-only (requireArea): categories are global taxonomy, not branch
 * data. Duplicate keys 409 (named conflict); validation 400 with fields.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireArea(event)

  const body = ((await readBody(event)) ?? {}) as Record<string, unknown>
  const parsed = z
    .object({
      key: categoryKeySchema,
      label: z.string().trim().min(1).max(80),
      sort: z.number().int().min(0).max(100000).optional(),
    })
    .safeParse(body)
  if (!parsed.success) throwValidation(parsed.error)
  const form = parsed.data

  try {
    const created = await createItem<Record<string, unknown>>(
      event,
      scope,
      'expense_categories',
      {
        key: form.key,
        label: form.label,
        sort: form.sort ?? 100,
        active: true,
      },
    )
    return { data: { ...created, key: String(created.key) } }
  } catch (error) {
    const media = error as { statusCode?: number; status?: number }
    const status = media.statusCode ?? media.status
    if (status === 409 || isUniqueViolation(error)) {
      throw createError({
        statusCode: 409,
        statusMessage: 'That category key is already in use',
        data: { code: 'conflict', fields: { key: 'Pick a unique category key' } },
      })
    }
    throw error
  }
})
