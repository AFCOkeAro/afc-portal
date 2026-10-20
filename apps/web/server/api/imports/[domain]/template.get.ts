import {
  IMPORT_DOMAINS,
  templateCsv,
  type ImportDomain,
} from '../../../utils/prior-year-import'
import { csvResponse, getPortalScope, requireCan } from '../../../utils/portal'

/**
 * Prior-year CSV templates (AFC-485, US-U2 AC1).
 *
 * GET /api/imports/:domain/template — one template per domain (attendance,
 * blessings, people, finance): the documented header row plus one example
 * row. The header is the contract the import endpoint validates against, so
 * the two cannot drift: both read IMPORT_TEMPLATES.
 *
 * Templates are readable by any scoped role that can read the domain;
 * importing itself is create-gated in the POST route.
 */
const READ_COLLECTION: Record<ImportDomain, string> = {
  attendance: 'attendance_sessions',
  blessings: 'blessings',
  people: 'people',
  finance: 'branch_financial_records',
}

export default defineEventHandler(async (event): Promise<string> => {
  const domain = getRouterParam(event, 'domain') as ImportDomain
  if (!(IMPORT_DOMAINS as readonly string[]).includes(domain)) {
    throw createError({
      statusCode: 404,
      statusMessage: `Unknown import domain. Use one of: ${IMPORT_DOMAINS.join(', ')}`,
      data: { code: 'unknown_domain' },
    })
  }
  const scope = await getPortalScope(event)
  requireCan(scope, READ_COLLECTION[domain], 'read')
  return csvResponse(event, `${domain}-import-template.csv`, [
    // csvResponse expects pre-split rows; the template builder emits one
    // string, so split it back into rows here (commas are bare in templates).
    ...templateCsv(domain)
      .trimEnd()
      .split('\n')
      .map((line) => line.split(',')),
  ])
})
