import { getPortalScope, listItems, requireCan } from '../../utils/portal'

/**
 * Board-configured service types (AFC-468 US-A1 AC1). The capture form renders
 * exactly the ordered `categories` of the active definition for the selected
 * service type; definitions are area-wide rows, so no branch/zone predicate
 * applies here — scoping constrains the session being filed, not the config.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'service_type_definitions', 'read')

  const result = await listItems<{
    id: string | number
    key: string
    label: string
    categories: string[] | string
    supports_sex_split: boolean
    requires_bsc: boolean
    status: string
  }>(event, scope, 'service_type_definitions', {
    filter: { status: { _eq: 'active' } },
    fields: [
      'id',
      'key',
      'label',
      'categories',
      'supports_sex_split',
      'requires_bsc',
      'status',
    ],
    sort: 'label',
    limit: -1,
  })

  return {
    data: result.data.map((row) => ({
      ...row,
      id: String(row.id),
      categories: Array.isArray(row.categories)
        ? row.categories
        : (() => {
            try {
              const parsed: unknown = JSON.parse(row.categories)
              return Array.isArray(parsed) ? parsed.map(String) : []
            } catch {
              return []
            }
          })(),
    })),
  }
})
