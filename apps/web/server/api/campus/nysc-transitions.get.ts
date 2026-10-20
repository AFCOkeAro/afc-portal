import {
  getPortalScope,
  listItems,
  requireCan,
} from '../../utils/portal'

/**
 * GET /api/campus/nysc-transitions — the ratified NYSC graph (US-C5 AC3).
 *
 * SELECT-only reference seeded by migration 0003 (eight edges; completed
 * and exempt are terminal and carry no outgoing row). The portal reads it
 * to validate transitions; nobody writes it from the portal.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'nysc_status_transitions', 'read')

  const rows = await listItems<Record<string, unknown>>(
    event,
    scope,
    'nysc_status_transitions',
    { fields: ['from_status', 'to_status'], limit: 50 },
  )

  return { data: rows.data }
})
