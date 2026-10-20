import type {
  WelfareContribution,
  WelfareDetail,
  WelfareEvent,
} from '../../../types/portal'
import {
  branchNames,
  can,
  findScopedItem,
  getPortalScope,
  listItems,
  requireCan,
  stripHidden,
  visibleFields,
} from '../../utils/portal'

const CASE_FIELDS = [
  'id',
  'case_ref',
  'branch',
  'person',
  'category',
  'priority',
  'status',
  'confidentiality',
  'title',
  'amount_requested',
  'amount_assisted',
  'assigned_to',
  'description',
  'outcome_notes',
  'opened_at',
  'closed_at',
]

// Directus field transition (AFC-472): the §6.3 names are detail/body/
// actor_user; the live collection still carries summary/actor. Reads request
// both and map spec-first, so the timeline works before and after the
// Directus collection gains the new columns. Writes carry both shapes.
const EVENT_FIELDS = [
  'id',
  'case',
  'event_type',
  'detail',
  'body',
  'summary',
  'actor_user',
  'actor',
  'created_at',
]

interface WelfareEventRow {
  id: string | number
  case: string
  event_type: string
  detail?: string | null
  body?: string | null
  summary?: string | null
  actor_user?: string | null
  actor?: string | null
  created_at: string | null
}

export default defineEventHandler(async (event): Promise<WelfareDetail> => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'welfare_cases', 'read')

  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, statusMessage: 'A case id is required' })

  const row = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'welfare_cases',
    id,
    { fields: visibleFields(scope, 'welfare_cases', CASE_FIELDS) },
  )
  const names = await branchNames(event, scope)

  let personName: string | null = null
  if (row.person) {
    const person = await listItems<{
      id: string | number
      first_name: string
      last_name: string
      preferred_name: string | null
    }>(event, scope, 'people', {
      filter: { id: { _eq: row.person } },
      fields: ['id', 'first_name', 'last_name', 'preferred_name'],
      limit: 1,
    })
    const found = person.data[0]
    if (found) {
      personName =
        found.preferred_name ||
        [found.first_name, found.last_name].filter(Boolean).join(' ')
    }
  }

  let contributions: WelfareContribution[] = []
  if (can(scope, 'welfare_contributions', 'read')) {
    const result = await listItems<WelfareContribution>(
      event,
      scope,
      'welfare_contributions',
      {
        filter: { case: { _eq: id } },
        fields: [
          'id',
          'case',
          'contribution_type',
          'amount',
          'description',
          'contributor',
          'contributed_at',
          'status',
          'approved_by',
          'approved_at',
        ],
        sort: '-contributed_at',
        limit: -1,
      },
    )
    contributions = result.data.map((contribution) => ({
      ...contribution,
      id: String(contribution.id),
    }))
  }

  let events: WelfareEvent[] = []
  if (can(scope, 'welfare_case_events', 'read')) {
    const result = await listItems<WelfareEventRow>(event, scope, 'welfare_case_events', {
      filter: { case: { _eq: id } },
      fields: EVENT_FIELDS,
      sort: '-created_at',
      limit: -1,
    })
    events = result.data.map((welfareEvent) => ({
      id: String(welfareEvent.id),
      case: String(welfareEvent.case),
      event_type: welfareEvent.event_type,
      summary: welfareEvent.detail ?? welfareEvent.summary ?? '',
      body: welfareEvent.body ?? null,
      detail: welfareEvent.detail ?? welfareEvent.summary ?? null,
      actor: welfareEvent.actor_user ?? welfareEvent.actor ?? null,
      created_at: welfareEvent.created_at,
    }))
  }

  const total = contributions.reduce(
    (sum, contribution) => sum + Number(contribution.amount ?? 0),
    0,
  )

  return {
    ...(stripHidden(scope, 'welfare_cases', row) as unknown as WelfareDetail),
    id: String(row.id),
    branch_name: row.branch ? (names.get(String(row.branch)) ?? null) : null,
    person_name: personName,
    contribution_total: total.toFixed(2),
    event_count: events.length,
    contributions,
    events,
  }
})
