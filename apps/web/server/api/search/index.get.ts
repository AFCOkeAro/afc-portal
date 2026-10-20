import { searchQuerySchema } from '@afc/shared'
import {
  can,
  getPortalScope,
  listItems,
  throwValidation,
  eventScopeFilter,
  scopeFilter,
} from '../../utils/portal'
import { logScopedQuery } from '../../utils/office'

/**
 * GET /api/search?q=&domain= — cross-entity search (people, households,
 * branches, BSCs, events, tasks, minutes) within the caller's scope,
 * fail-closed on empty scope (`getPortalScope` 403s before any domain is
 * read; an empty `q` is a 400, never an unfiltered dump). Every query is
 * scope-logged for audit.
 */
const DOMAINS = [
  'people',
  'households',
  'branches',
  'bscs',
  'events',
  'tasks',
  'minutes',
] as const

const COLLECTION_FOR: Record<string, string> = {
  people: 'people',
  households: 'households',
  branches: 'branches',
  bscs: 'bible_study_centres',
  events: 'events',
  tasks: 'tasks',
  minutes: 'office_minutes',
}

export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  const parsed = searchQuerySchema.safeParse({
    q: getQuery(event).q,
    domain: getQuery(event).domain,
    page: getQuery(event).page ?? 1,
    limit: getQuery(event).limit ?? 10,
  })
  if (!parsed.success) throwValidation(parsed.error)
  const { q, domain } = parsed.data
  logScopedQuery(scope, 'search.query', { q, domain: domain ?? 'all' })

  const wanted = domain ? [domain] : [...DOMAINS]
  const results: Record<string, unknown[]> = {}
  for (const name of wanted) {
    const collection = COLLECTION_FOR[name] ?? name
    if (!can(scope, collection, 'read')) {
      results[name] = []
      continue
    }
    const filter =
      collection === 'events'
        ? eventScopeFilter(scope)
        : collection === 'branches'
          ? {}
          : scopeFilter(scope, collection === 'office_minutes' ? 'branch' : 'branch')
    try {
      const page = await listItems<Record<string, unknown>>(event, scope, collection, {
        search: q,
        filter,
        limit: parsed.data.limit,
      })
      results[name] = page.data.map((row) => ({ ...row, _domain: name }))
    } catch {
      results[name] = []
    }
  }
  return { data: results, meta: { q, domains: wanted } }
})
