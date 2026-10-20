import type { YouthProfile, YouthProfileEvent } from '@afc/shared'
import {
  branchNames,
  findScopedItem,
  getPortalScope,
  listItems,
  requireCan,
  stripHidden,
  stripHiddenMany,
  zoneScopeFilter,
} from '../../utils/portal'
import { CELEBRATION_PERSON_FIELDS } from '../../utils/celebration-feed'

const YOUTH_FIELDS = [
  'id',
  'person',
  'education_level',
  'institution',
  'course',
  'study_level',
  'employment_status',
  'professional_status',
  'is_entrepreneur',
  'youth_leadership_role',
  'branch',
  'zone',
  'status',
  'created_at',
  'updated_at',
]

const EVENT_FIELDS = ['id', 'profile', 'event_type', 'detail', 'actor_user', 'created_at']

const HISTORY_FIELDS = [
  'id',
  'person',
  'branch_name',
  'branch',
  'role',
  'from_year',
  'to_year',
]

const MILESTONE_FIELDS = [
  'id',
  'person',
  'milestone_type',
  'milestone_date',
  'milestone_year',
  'church',
  'branch',
  'notes',
  'recorded_by',
]

export interface YouthDetail extends YouthProfile {
  person_name: string | null
  person_is_minor: boolean | null
  branch_name: string | null
  events: YouthProfileEvent[]
  previous_branches: Array<Record<string, unknown>>
  milestones: Array<Record<string, unknown>>
}

/**
 * GET /api/youth/:id — youth detail with audit trail and history.
 *
 * A cross-branch id is a 404 here, never a foreign profile. The person
 * embed carries names + is_minor only: DOB, contact and medical fields are
 * never selected (safeguarding lens). Previous branches and milestones are
 * children of the person, so scoping the profile scopes the history --
 * both lists filter on the profile's own person id.
 */
export default defineEventHandler(async (event): Promise<YouthDetail> => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'youth_profiles', 'read')

  const id = getRouterParam(event, 'id')
  if (!id)
    throw createError({
      statusCode: 400,
      statusMessage: 'A youth profile id is required',
    })

  const row = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'youth_profiles',
    id,
    {
      fields: YOUTH_FIELDS,
      scope: scope.isArea
        ? {}
        : scope.zoneIds.length > 0
          ? zoneScopeFilter(scope)
          : { branch: { _in: scope.branchIds } },
    },
  )

  const personId = String(row.person)
  const [names, personRows, trail, previous, milestones] = await Promise.all([
    branchNames(event, scope),
    listItems<Record<string, unknown>>(event, scope, 'people', {
      filter: { id: { _eq: personId } },
      fields: CELEBRATION_PERSON_FIELDS,
      limit: 1,
    }),
    listItems<YouthProfileEvent>(event, scope, 'youth_profile_events', {
      filter: { profile: { _eq: id } },
      fields: EVENT_FIELDS,
      sort: 'created_at',
      limit: -1,
    }),
    listItems<Record<string, unknown>>(event, scope, 'person_previous_branches', {
      filter: { person: { _eq: personId } },
      fields: HISTORY_FIELDS,
      sort: '-from_year',
      limit: -1,
    }),
    listItems<Record<string, unknown>>(event, scope, 'person_milestones', {
      filter: { person: { _eq: personId } },
      fields: MILESTONE_FIELDS,
      sort: '-milestone_year',
      limit: -1,
    }),
  ])

  const person = personRows.data[0]
  const first =
    typeof person?.first_name === 'string' ? (person.first_name as string).trim() : ''
  const last =
    typeof person?.last_name === 'string' ? (person.last_name as string).trim() : ''

  return {
    ...(stripHidden(scope, 'youth_profiles', row) as unknown as YouthProfile),
    id: String(row.id),
    person_name: [first, last].filter(Boolean).join(' ') || null,
    person_is_minor:
      typeof person?.is_minor === 'boolean' ? (person.is_minor as boolean) : null,
    branch_name: row.branch ? (names.get(String(row.branch)) ?? null) : null,
    events: trail.data.map((item) => ({ ...item, id: String(item.id) })),
    previous_branches: stripHiddenMany(scope, 'person_previous_branches', previous.data),
    milestones: stripHiddenMany(scope, 'person_milestones', milestones.data),
  }
})
