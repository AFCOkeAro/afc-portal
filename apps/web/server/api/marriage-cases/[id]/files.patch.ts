import { z } from 'zod'
import {
  assertUuidParam,
  findScopedItem,
  getPortalScope,
  requireCan,
  scopeFilter,
  throwValidation,
  updateItem,
} from '../../../utils/portal'
import { officeZoneScope } from '../../../utils/office'

/** The nine bare-uuid file slots on `marriage_cases` (migration 0035). */
export const MARRIAGE_FILE_SLOTS = [
  'consent_brother_file',
  'consent_sister_file',
  'passport_brother_file',
  'passport_sister_file',
  'lga_certificate_file',
  'bridal_list_file',
  'marriage_certificate_file',
  'couple_photo_file',
  'presentation_photo_file',
] as const

const filesPatchSchema = z.object({
  slot: z.enum(MARRIAGE_FILE_SLOTS),
  file: z.string().uuid('Link the uploaded file'),
})

/**
 * PATCH /api/marriage-cases/:id/files — link an uploaded file into one of
 * the nine bare-uuid slots (AFC-677 phase B). The bytes travel through
 * POST /api/marriage-cases/files (which returns the Directus file id);
 * this route only records the id on the case. Searchable EntitySelect and
 * the upload card supply the id -- staff never type a case, person or
 * branch id by hand. Closed cases refuse; no bare 500.
 */
export default defineEventHandler(async (event) => {
  const scope = await getPortalScope(event)
  requireCan(scope, 'marriage_cases', 'update')

  const parsed = filesPatchSchema.safeParse(await readBody(event))
  if (!parsed.success) throwValidation(parsed.error)

  const id = assertUuidParam(
    String(getRouterParam(event, 'id')),
    'case',
    'invalid_case_id',
  )
  const row = await findScopedItem<Record<string, unknown>>(
    event,
    scope,
    'marriage_cases',
    id,
    { scope: { ...scopeFilter(scope), ...officeZoneScope(scope) } },
  )
  if (['halted', 'transferred_out', 'reported'].includes(String(row.stage))) {
    throw createError({
      statusCode: 400,
      statusMessage: 'A closed case takes no more files',
      data: { code: 'validation_error', fields: { slot: 'This file is closed' } },
    })
  }

  const now = new Date().toISOString()
  const updated = await updateItem<Record<string, unknown>>(
    event,
    scope,
    'marriage_cases',
    id,
    { [parsed.data.slot]: parsed.data.file, updated_at: now },
  ).catch((error: unknown) => {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    throw createError({
      statusCode: 503,
      statusMessage: 'The marriage pipeline is unavailable (migration 0035 not applied?)',
      data: { code: 'pending_migration_0035', cause: String(error) },
    })
  })

  return { data: updated }
})
