import {
  assertUuidParam,
  findScopedItem,
  getPortalScope,
  requireCan,
  scopeFilter,
  stripHidden,
} from '../../../utils/portal'
import { officeZoneScope } from '../../../utils/office'

function prefillPerson(row: Record<string, unknown>) {
  const first = String(row.first_name ?? '').trim()
  const other = String(row.other_names ?? '').trim()
  return {
    surname: String(row.last_name ?? '').trim(),
    other_names: [first, other].filter(Boolean).join(' '),
    date_of_birth: row.date_of_birth ?? null,
    phone: row.phone ?? null,
    residence: row.address ?? null,
  }
}

/**
 * GET /api/marriage-cases/:id/wedding-info — prefill the Wedding
 * Information Form from the linked people rows (AFC-677 phase B). The
 * portal fills surnames, other names, birth dates, phones and residences;
 * staff correct anything, then tick the explicit verify checkbox on the
 * form submit -- only that tick flips `wedding_info_verified` (via the
 * transition route), never this prefill. Out-of-scope people read 404,
 * fail-closed; the store answers 503 with a named code, never a bare 500.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'marriage_cases', 'read')
  requireCan(scope, 'people', 'read')

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
  ).catch((error: unknown) => {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    throw createError({
      statusCode: 503,
      statusMessage: 'The marriage pipeline is unavailable (migration 0035 not applied?)',
      data: { code: 'pending_migration_0035', cause: String(error) },
    })
  })

  const brotherId = String(row.brother_person ?? '')
  const sisterId = String(row.sister_person ?? '')
  const [brother, sister] = await Promise.all([
    brotherId
      ? findScopedItem<Record<string, unknown>>(event, scope, 'people', brotherId)
        .then((person) => prefillPerson(stripHidden(scope, 'people', person)))
        .catch(() => null)
      : Promise.resolve(null),
    sisterId
      ? findScopedItem<Record<string, unknown>>(event, scope, 'people', sisterId)
        .then((person) => prefillPerson(stripHidden(scope, 'people', person)))
        .catch(() => null)
      : Promise.resolve(null),
  ])

  return { data: { brother, sister, wedding_info_verified: row.wedding_info_verified ?? false } }
})
