import {
  MARRIAGE_VOW_TYPES,
  buildVowText,
  type MarriageVowType,
} from '@afc/shared'
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
 * GET /api/marriage-cases/:id/vow — render the wedding vow wording with the
 * couple's names inserted (AFC-677 phase B). `?type=A|B`, default B; an
 * explicit query value previews that wording, otherwise the case `vow_type`
 * (itself default B) decides.
 *
 * Names come from the submitted forms only (F17 `vows`, else F9
 * `wedding_info`) -- never invented, never read off-scope from `people`.
 * Without either form the route answers 400 `names_missing` and names the
 * missing step instead of printing blanks.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'marriage_case_forms', 'read')

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

  const query = getQuery(event)
  const rawType = String(query.type ?? row.vow_type ?? 'B').toUpperCase()
  if (!MARRIAGE_VOW_TYPES.includes(rawType as MarriageVowType)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Unknown vow wording',
      data: { code: 'validation_error', fields: { type: 'Choose A or B' } },
    })
  }
  const vowType = rawType as MarriageVowType

  const rows = await listItems<Record<string, unknown>>(
    event,
    scope,
    'marriage_case_forms',
    {
      filter: {
        marriage_case: { _eq: id },
        form_key: { _in: ['vows', 'wedding_info'] },
      },
      sort: '-created_at',
      limit: 50,
    },
  ).catch((error: unknown) => {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    throw createError({
      statusCode: 503,
      statusMessage: 'The marriage forms store is unavailable (migration 0036 not applied?)',
      data: { code: 'pending_migration_0036', cause: String(error) },
    })
  })

  const byKey: Record<string, Record<string, unknown>> = {}
  for (const item of rows.data) {
    const key = String(item.form_key)
    byKey[key] ??= (item.payload ?? {}) as Record<string, unknown>
  }
  const vows = byKey.vows ?? {}
  const info = (byKey.wedding_info ?? {}) as Record<string, unknown>
  const infoBrother = (info.brother ?? {}) as Record<string, unknown>
  const infoSister = (info.sister ?? {}) as Record<string, unknown>

  const brotherName =
    String(vows.brother_full_name ?? '').trim() ||
    [infoBrother.surname, infoBrother.other_names].map((part) => String(part ?? '').trim()).filter(Boolean).join(' ')
  const sisterName =
    String(vows.sister_full_name ?? '').trim() ||
    [infoSister.surname, infoSister.other_names].map((part) => String(part ?? '').trim()).filter(Boolean).join(' ')
  const giverName = String(vows.giver_name ?? '').trim() || undefined

  if (!brotherName || !sisterName) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Fill the vows form (or the wedding information form) before printing the vow',
      data: {
        code: 'names_missing',
        fields: {
          brother_full_name: brotherName ? 'Set' : 'Enter the brother full name on the vows form',
          sister_full_name: sisterName ? 'Set' : 'Enter the sister full name on the vows form',
        },
      },
    })
  }

  return {
    data: {
      vow_type: vowType,
      brother_full_name: brotherName,
      sister_full_name: sisterName,
      ...(giverName ? { giver_name: giverName } : {}),
      text: buildVowText(vowType, brotherName, sisterName, giverName),
    },
  }
})
