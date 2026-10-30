import {
  getPortalScope,
  listItems,
  requireCan,
  scopeFilter,
  throwStoreUnavailable,
} from '../../utils/portal'

/**
 * GET /api/outreach-secretaries — every assigned secretary with the schools
 * they visit (AFC-913).
 *
 * One row per distinct person on the outreach_location_secretaries
 * junction (so one person can carry many schools), each with their school
 * names. Locations are scope-gated first and the junction is narrowed to
 * those locations, so a caller only ever sees their own branches rows.
 * Person names resolve server-side (the [id] enrichment pattern). People
 * with no assignment have no roster record and are absent here — they are
 * added through the person picker, which accepts anyone.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'outreach_location_secretaries', 'read')
  requireCan(scope, 'outreach_locations', 'read')

  try {
    const locations = await listItems<Record<string, unknown>>(
      event,
      scope,
      'outreach_locations',
      {
        filter: scopeFilter(scope),
        fields: ['id', 'name'],
        sort: 'name',
        limit: -1,
      },
    )
    const locationNames = new Map(
      locations.data.map((row: Record<string, unknown>) => [
        String(row.id),
        String(row.name ?? '').trim() || 'Unnamed location',
      ]),
    )
    if (locationNames.size === 0) return { data: [] }

    const links = await listItems<{ location: string | null; person: string | null }>(
      event,
      scope,
      'outreach_location_secretaries',
      {
        filter: { location: { _in: [...locationNames.keys()] } },
        fields: ['id', 'location', 'person'],
        limit: -1,
      },
    )
    const personIds = [
      ...new Set(
        links.data.map((row: { person: unknown }) => row.person).filter(Boolean),
      ),
    ]
    let names = new Map<string, string>()
    if (personIds.length > 0) {
      const people = await listItems<Record<string, unknown>>(event, scope, 'people', {
        filter: { id: { _in: personIds } },
        fields: ['id', 'first_name', 'last_name', 'preferred_name'],
        limit: -1,
      }).catch(() => ({ data: [] as Record<string, unknown>[] }))
      names = new Map(
        people.data.map((row: Record<string, unknown>) => {
          const full =
            `${String(row.first_name ?? '').trim()} ${String(row.last_name ?? '').trim()}`.trim()
          return [
            String(row.id),
            String(row.preferred_name ?? '').trim() || full || 'Unnamed member',
          ]
        }),
      )
    }
    const byPerson = new Map<
      string,
      { person: string; name: string; schools: { id: string; name: string }[] }
    >()
    for (const row of links.data) {
      if (!row.person || !row.location) continue
      const person = String(row.person)
      const location = String(row.location)
      if (!locationNames.has(location)) continue
      let entry = byPerson.get(person)
      if (!entry) {
        entry = { person, name: names.get(person) ?? 'Unknown', schools: [] }
        byPerson.set(person, entry)
      }
      if (!entry.schools.some((school) => school.id === location)) {
        entry.schools.push({
          id: location,
          name: locationNames.get(location) ?? 'Unknown',
        })
      }
    }
    const data = [...byPerson.values()]
      .map((entry) => ({
        ...entry,
        schools: entry.schools.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return { data }
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode) throw error
    throwStoreUnavailable(error, 'outreach_store', '0051')
  }
})
