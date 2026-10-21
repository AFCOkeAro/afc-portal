import { z } from 'zod'
import {
  findScopedItem,
  getPortalScope,
  requireCan,
  throwStoreUnavailable,
  throwValidation,
  updateItem,
} from '../../utils/portal'
import { JOURNEY_FIELDS, validateWelfareOfficer } from '../../utils/visitor-journey'

const assignSchema = z.object({
  id: z.string().trim().min(1),
  /** Directus user id of the Welfare officer. Null clears the assignment. */
  officer: z.string().trim().min(1).max(36).nullable(),
})

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'visitors', 'update')

  const parsed = assignSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)

  // AFC-583: the read + assignment write hit the 0025 register — map an
  // unreadable store to the named error, never a bare 500. Deliberate 4xx
  // (scope 404s, officer/validation 400s) pass through untouched.
  try {
    const visitor = await findScopedItem<Record<string, unknown>>(
      event,
      scope,
      'visitors',
      parsed.data.id,
      { fields: JOURNEY_FIELDS },
    )
    const branchId = (visitor.branch as string | null) ?? null

    if (parsed.data.officer) {
      // Restricted: the assignee must hold the Welfare position in the same
      // branch (data-model-v4 §5). Fail-closed when the registry is absent.
      await validateWelfareOfficer(event, scope, parsed.data.officer, branchId)
    }

    const updated = await updateItem<Record<string, unknown>>(
      event,
      scope,
      'visitors',
      parsed.data.id,
      {
        follow_up_owner: parsed.data.officer,
        welfare_officer_assigned_at: parsed.data.officer
          ? new Date().toISOString()
          : null,
      },
    )
    return { data: { ...updated, id: String((updated as { id: unknown }).id) } }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'visitor_store', '0025')
  }
})
