import {
  WORSHIP_TEMPLATES,
  worshipTemplateDuration,
  type WorshipTemplate,
} from '@afc/shared'
import { getPortalScope, requireCan } from '../../utils/portal'

export interface WorshipTemplateRow extends WorshipTemplate {
  durationMin: number
}

/**
 * GET /api/services/templates — worship planner catalogue (AFC-870).
 *
 * The ten in-code orders of service with their derived total minutes.
 * Static route, so Nitro matches it before `services/[id]` — without this
 * file, `templates` falls into the `:id` detail route and Directus answers
 * the non-UUID `_eq` against the uuid column with a 500. Same posture as
 * the page: templates live in code (staging DDL is frozen), so this reads
 * nothing from the store — but it still requires the `sunday_services`
 * read grant, so the catalogue is revealed by the same capability that
 * reveals the templates page. No new collection, no new privilege.
 */
export default defineEventHandler(async (event): Promise<{ data: WorshipTemplateRow[] }> => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'sunday_services', 'read')

  return {
    data: WORSHIP_TEMPLATES.map((template) => ({
      ...template,
      durationMin: worshipTemplateDuration(template),
    })),
  }
})
