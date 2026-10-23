import type { BlessingRecipient } from '@afc/shared'
import {
  branchNames,
  findScopedItem,
  getPortalScope,
  requireCan,
  zoneScopeFilter,
} from '../../utils/portal'

export interface BlessingRecipientDetail extends BlessingRecipient {
  branch_name: string | null
  person_name: string | null
}

/**
 * GET /api/blessing-recipients/:id — individual blessing detail (AFC-671 §C).
 *
 * A cross-branch id is a 404 here exactly like the blessings detail route,
 * never a foreign record. The person name resolves alongside the branch
 * name so the detail reads as a person, not an id.
 */
export default defineEventHandler(async (event): Promise<BlessingRecipientDetail> => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'blessing_recipients', 'read')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({
      statusCode: 400,
      statusMessage: 'A blessing recipient id is required',
    })

  const row = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'blessing_recipients',
    id,
    {
      fields: [
        'id',
        'blessing',
        'blessing_type',
        'other_label',
        'person',
        'attendee_user',
        'branch',
        'zone',
        'bsc',
        'session',
        'event',
        'sunday_service',
        'service_date',
        'recorded_by',
        'notes',
        'created_at',
        'updated_at',
      ],
      scope: scope.isArea
        ? {}
        : scope.zoneIds.length > 0
          ? zoneScopeFilter(scope)
          : { branch: { _in: scope.branchIds } },
    },
  )

  const names = await branchNames(event, scope)
  let personName: string | null = null
  if (row.person) {
    try {
      const person = await findScopedItem<{
        first_name?: string | null
        last_name?: string | null
        preferred_name?: string | null
      }>(event, scope, 'people', String(row.person), {
        fields: ['id', 'first_name', 'last_name', 'preferred_name'],
      })
      const preferred =
        typeof person.preferred_name === 'string' ? person.preferred_name.trim() : ''
      const base = [person.first_name, person.last_name]
        .filter(
          (part): part is string => typeof part === 'string' && part.trim().length > 0,
        )
        .map((part) => part.trim())
        .join(' ')
      personName = preferred || base || null
    } catch {
      personName = null
    }
  }

  return {
    ...(row as unknown as BlessingRecipient),
    id: String(row.id),
    branch_name: row.branch ? (names.get(String(row.branch)) ?? null) : null,
    person_name: personName,
  }
})
