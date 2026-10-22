import { MARRIAGE_FORM_KEYS, type MarriageFormKey } from '@afc/shared'
import {
  assertUuidParam,
  findScopedItem,
  getPortalScope,
  listItems,
  requireCan,
  scopeFilter,
} from '../../../utils/portal'
import { officeZoneScope } from '../../../utils/office'

/**
 * GET /api/marriage-cases/:id/forms — latest submission per form key
 * (AFC-677 phase B). Resubmissions append rows, so latest-wins is pinned
 * HERE (newest `created_at` per key), never assumed from row order.
 * Missing keys read `null` -- the print view shows them as outstanding.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'marriage_case_forms', 'read')

  const id = assertUuidParam(
    String(getRouterParam(event, 'id')),
    'case',
    'invalid_case_id',
  )
  await findScopedItem<Record<string, unknown>>(event, scope, 'marriage_cases', id, {
    scope: { ...scopeFilter(scope), ...officeZoneScope(scope) },
  }).catch((error: unknown) => {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    throw createError({
      statusCode: 503,
      statusMessage: 'The marriage pipeline is unavailable (migration 0035 not applied?)',
      data: { code: 'pending_migration_0035', cause: String(error) },
    })
  })

  const rows = await listItems<Record<string, unknown>>(
    event,
    scope,
    'marriage_case_forms',
    {
      filter: { marriage_case: { _eq: id } },
      sort: '-created_at',
      limit: 500,
    },
  ).catch((error: unknown) => {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    throw createError({
      statusCode: 503,
      statusMessage:
        'The marriage forms store is unavailable (migration 0036 not applied?)',
      data: { code: 'pending_migration_0036', cause: String(error) },
    })
  })

  const latest: Record<MarriageFormKey, Record<string, unknown> | null> =
    Object.fromEntries(MARRIAGE_FORM_KEYS.map((key) => [key, null])) as Record<
      MarriageFormKey,
      Record<string, unknown> | null
    >
  for (const row of rows.data) {
    const key = String(row.form_key) as MarriageFormKey
    if (MARRIAGE_FORM_KEYS.includes(key) && latest[key] === null) {
      latest[key] = row
    }
  }
  return { data: latest }
})
