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
  'amount_requested',
  'amount_assisted',
  'assigned_to',
  'description',
  'outcome_notes',
  'opened_at',
  'closed_at',
]

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
    const result = await listItems<WelfareEvent>(
      event,
      scope,
      'welfare_case_events',
      {
        filter: { case: { _eq: id } },
        fields: ['id', 'case', 'event_type', 'summary', 'actor', 'created_at'],
        sort: '-created_at',
        limit: -1,
      },
    )
    events = result.data.map((welfareEvent) => ({
      ...welfareEvent,
      id: String(welfareEvent.id),
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
