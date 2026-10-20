import type { WelfareCaseRow } from '../../../types/portal'
import {
  branchNames,
  can,
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
  scopeFilter,
  stripHiddenMany,
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

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'welfare_cases', 'read')

  const query = getQuery(event)
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(100, Math.max(1, Number(query.limit) || 25))
  const search =
    typeof query.search === 'string' ? query.search.trim().slice(0, 120) : undefined
  const branch = typeof query.branch === 'string' ? query.branch : undefined
  const status = typeof query.status === 'string' ? query.status : 'open'
  const category = typeof query.category === 'string' ? query.category : undefined
  const priority = typeof query.priority === 'string' ? query.priority : undefined

  const statusFilter =
    status === 'all'
      ? undefined
      : status === 'open'
        ? { status: { _in: ['open', 'in_progress'] } }
        : { status: { _eq: status } }

  const result = await listItems<WelfareCaseRow>(event, scope, 'welfare_cases', {
    filter: mergeFilters(
      statusFilter,
      branch ? { branch: { _eq: branch } } : undefined,
      category ? { category: { _eq: category } } : undefined,
      priority ? { priority: { _eq: priority } } : undefined,
      scopeFilter(scope),
    ),
    fields: visibleFields(scope, 'welfare_cases', CASE_FIELDS),
    sort: '-opened_at',
    page,
    limit,
    search: search || undefined,
  })

  const ids = result.data.map((row) => String(row.id))
  const totals = new Map<string, number>()
  const eventCounts = new Map<string, number>()

  if (ids.length > 0 && can(scope, 'welfare_contributions', 'read')) {
    const contributions = await listItems<{ case: string; amount: string | null }>(
      event,
      scope,
      'welfare_contributions',
      {
        filter: { case: { _in: ids } },
        fields: ['case', 'amount'],
        limit: -1,
      },
    )
    for (const contribution of contributions.data) {
      const key = String(contribution.case)
      const amount = Number(contribution.amount ?? 0)
      totals.set(key, (totals.get(key) ?? 0) + (Number.isFinite(amount) ? amount : 0))
    }
  }

  if (ids.length > 0 && can(scope, 'welfare_case_events', 'read')) {
    const events = await listItems<{ case: string }>(
      event,
      scope,
      'welfare_case_events',
      {
        filter: { case: { _in: ids } },
        fields: ['case'],
        limit: -1,
      },
    )
    for (const row of events.data) {
      const key = String(row.case)
      eventCounts.set(key, (eventCounts.get(key) ?? 0) + 1)
    }
  }

  const personIds = [
    ...new Set(
      result.data
        .map((row) => row.person)
        .filter((value): value is string => Boolean(value)),
    ),
  ]
  const people = new Map<string, string>()
  if (personIds.length > 0) {
    const response = await listItems<{
      id: string | number
      first_name: string
      last_name: string
      preferred_name: string | null
    }>(event, scope, 'people', {
      filter: { id: { _in: personIds } },
      fields: ['id', 'first_name', 'last_name', 'preferred_name'],
      limit: personIds.length,
    })
    for (const person of response.data) {
      const name = [person.first_name, person.last_name].filter(Boolean).join(' ')
      people.set(String(person.id), person.preferred_name || name)
    }
  }

  const names = await branchNames(event, scope)
  const rows = stripHiddenMany(
    scope,
    'welfare_cases',
    result.data as unknown as Record<string, unknown>[],
  ).map((row) => {
    const record = row as unknown as WelfareCaseRow
    return {
      ...record,
      id: String(record.id),
      branch_name: record.branch
        ? (names.get(String(record.branch)) ?? null)
        : null,
      person_name: record.person ? (people.get(record.person) ?? null) : null,
      contribution_total: (totals.get(String(record.id)) ?? 0).toFixed(2),
      event_count: eventCounts.get(String(record.id)) ?? 0,
    }
  })

  return { data: rows, meta: result.meta }
})
