import type { H3Event } from 'h3'
import {
  type CustomFormFieldType,
  type CustomFormLiveColumn,
  isCustomFormModule,
} from '@afc/shared'
import { directusFetch } from './directus'
import { throwStoreUnavailable } from './portal'

/**
 * Live module columns for the custom-form builder (AFC-897).
 *
 * DB-BACKED, STATED PLAINLY: the picker lists what Directus
 * `/fields/:collection` reports, and Directus introspects the database, so
 * a column renamed or dropped in a migration appears or vanishes here with
 * no checked-in copy to drift. The module must be in the v1 vocabulary --
 * there is no generic collection proxy, and adding one would hand the
 * browser an arbitrary-schema reader (see the `useApi` contract).
 *
 * Directus kinds with no safe phase-1 input (json and friends) are left
 * out: the definition validator would refuse a form it cannot check, so
 * the picker refuses to offer the column first.
 */
export interface ModuleColumn extends CustomFormLiveColumn {
  kind: CustomFormFieldType
}

/** Directus field kinds the phase-1 renderer can draw, mapped to form kinds. */
const DRAWABLE_DIRECTUS_TYPES: Record<string, CustomFormFieldType> = {
  string: 'string',
  text: 'text',
  integer: 'integer',
  bigInteger: 'integer',
  float: 'number',
  decimal: 'number',
  boolean: 'boolean',
  date: 'date',
  dateTime: 'date',
  timestamp: 'date',
  time: 'string',
  uuid: 'string',
}

interface DirectusFieldRow {
  field: string
  type: string
  schema: {
    is_nullable?: boolean
    default_value?: unknown
  } | null
}

export async function readModuleColumns(
  event: H3Event,
  module: string,
): Promise<ModuleColumn[]> {
  if (!isCustomFormModule(module)) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Custom forms link to a v1 module',
      data: { code: 'unknown_module' },
    })
  }
  let body: { data: DirectusFieldRow[] }
  try {
    // Reads as the portal service identity: the response carries column
    // names and nullability (schema shape), never row content. Row access
    // stays behind requireCan on the module routes.
    body = await directusFetch<{ data: DirectusFieldRow[] }>(event, `/fields/${module}`)
  } catch (error) {
    throwStoreUnavailable(error, `${module}_store`, '0061')
  }
  const columns: ModuleColumn[] = []
  for (const row of body.data ?? []) {
    if (!row || typeof row.field !== 'string') continue
    if (row.field === 'id') continue
    if (!row.schema) continue
    const kind = DRAWABLE_DIRECTUS_TYPES[row.type]
    if (!kind) continue
    columns.push({
      name: row.field,
      kind,
      nullable: row.schema.is_nullable !== false,
      hasDefault:
        row.schema.default_value !== null && row.schema.default_value !== undefined,
    })
  }
  return columns
}
