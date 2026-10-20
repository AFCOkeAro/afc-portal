import type { Celebration, CelebrationEvent } from '@afc/shared'
import {
  branchNames,
  findScopedItem,
  getPortalScope,
  listItems,
  requireCan,
  zoneScopeFilter,
} from '../../utils/portal'
import { CELEBRATION_PERSON_FIELDS } from '../../utils/celebration-feed'

const CELEBRATION_FIELDS = [
  'id',
  'person',
  'type',
  'event_date',
  'is_recurring',
  'title',
  'message',
  'visibility',
  'publish_channels',
  'branch',
  'zone',
  'status',
  'guardian_consent',
  'created_by',
  'created_at',
  'updated_at',
]

const EVENT_FIELDS = [
  'id',
  'celebration',
  'event_type',
  'detail',
  'actor_user',
  'created_at',
]

export interface CelebrationDetail extends Celebration {
  person_name: string | null
  person_is_minor: boolean | null
  branch_name: string | null
  events: CelebrationEvent[]
}

/**
 * GET /api/celebrations/:id — celebration detail with its audit trail.
 *
 * A cross-branch id is a 404 here, never a foreign greeting. The person
 * embed carries names + is_minor only: DOB, contact and medical fields are
 * never selected (safeguarding lens). The trail (celebration_events) is a
 * child of the celebration, so scoping the celebration scopes the trail.
 */
export default defineEventHandler(async (event): Promise<CelebrationDetail> => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'celebrations', 'read')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({ statusCode: 400, statusMessage: 'A celebration id is required' })

  const row = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'celebrations',
    id,
    {
      fields: CELEBRATION_FIELDS,
      scope: scope.isArea
        ? {}
        : scope.zoneIds.length > 0
          ? zoneScopeFilter(scope)
          : { branch: { _in: scope.branchIds } },
    },
  )

  const [names, personRows, trail] = await Promise.all([
    branchNames(event, scope),
    listItems<Record<string, unknown>>(event, scope, 'people', {
      filter: { id: { _eq: String(row.person) } },
      fields: CELEBRATION_PERSON_FIELDS,
      limit: 1,
    }),
    listItems<CelebrationEvent>(event, scope, 'celebration_events', {
      filter: { celebration: { _eq: id } },
      fields: EVENT_FIELDS,
      sort: 'created_at',
      limit: -1,
    }),
  ])

  const person = personRows.data[0]
  const first =
    typeof person?.first_name === 'string' ? (person.first_name as string).trim() : ''
  const last =
    typeof person?.last_name === 'string' ? (person.last_name as string).trim() : ''

  return {
    ...(row as unknown as Celebration),
    id: String(row.id),
    person_name: [first, last].filter(Boolean).join(' ') || null,
    person_is_minor:
      typeof person?.is_minor === 'boolean' ? (person.is_minor as boolean) : null,
    branch_name: row.branch ? (names.get(String(row.branch)) ?? null) : null,
    events: trail.data.map((item) => ({ ...item, id: String(item.id) })),
  }
})
