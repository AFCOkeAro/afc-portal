/**
 * Custom form definitions (AFC-897, phase 1).
 *
 * Pure: no I/O, no framework imports. The builder UI, the create/update
 * routes and the contract tests share these, so the vocabulary and the
 * DB-backed rules are stated once. Directus type names never appear here;
 * the server util maps Directus introspection onto `CustomFormLiveColumn`.
 */

/** Modules a custom form may link to in phase 1 (migration 0061 CHECK). */
export const CUSTOM_FORM_MODULES = [
  'visitors',
  'people',
  'households',
  'welfare_cases',
  'blessings',
  'announcements',
  'tasks',
] as const

export type CustomFormModule = (typeof CUSTOM_FORM_MODULES)[number]

export function isCustomFormModule(value: unknown): value is CustomFormModule {
  return (
    typeof value === 'string' &&
    (CUSTOM_FORM_MODULES as readonly string[]).includes(value)
  )
}

/** Field kinds the phase-1 renderer knows how to draw and submit. */
export const CUSTOM_FORM_FIELD_TYPES = [
  'string',
  'text',
  'number',
  'integer',
  'boolean',
  'date',
  'select',
] as const

export type CustomFormFieldType = (typeof CUSTOM_FORM_FIELD_TYPES)[number]

export interface CustomFormFieldDef {
  key: string
  label: string
  type: CustomFormFieldType
  required: boolean
  options?: string[]
}

/**
 * One live DB column, as the server util reads it from Directus
 * `/fields/:collection` (Directus introspects the database, so this is the
 * database speaking, not a checked-in copy of the schema).
 */
export interface CustomFormLiveColumn {
  name: string
  /** False when the database refuses NULL (the column must be covered). */
  nullable: boolean
  /** True when the database fills the column itself when omitted. */
  hasDefault: boolean
}

/**
 * Columns the form layer owns, never the filler. `id` is generated;
 * `branch` is stamped by the submissions route from the session scope
 * (resolveBranch), so no form may demand it and no submission may spoof it
 * past scope.
 */
export const CUSTOM_FORM_SYSTEM_COLUMNS = ['id', 'branch'] as const

export const CUSTOM_FORM_FIELD_LIMIT = 50

const SELECT_OPTION_LIMIT = 30

function fieldErrors(
  field: CustomFormFieldDef,
  liveNames: ReadonlySet<string>,
): string[] {
  const problems: string[] = []
  const where = field.label.trim() || field.key
  if (field.key.trim().length === 0) {
    problems.push(`A field is missing its column key (${where}).`)
    return problems
  }
  if (!liveNames.has(field.key)) {
    if ((CUSTOM_FORM_SYSTEM_COLUMNS as readonly string[]).includes(field.key)) {
      problems.push(
        `"${field.key}" is stamped by the portal (${where}): it cannot be a form field.`,
      )
      return problems
    }
    problems.push(
      `Unknown column "${field.key}" for this module (${where}): pick a column the database has.`,
    )
    return problems
  }
  if ((CUSTOM_FORM_SYSTEM_COLUMNS as readonly string[]).includes(field.key)) {
    problems.push(
      `"${field.key}" is stamped by the portal (${where}): it cannot be a form field.`,
    )
  }
  if (field.label.trim().length === 0) {
    problems.push(`Column "${field.key}" needs a label the filler can read.`)
  }
  if (!(CUSTOM_FORM_FIELD_TYPES as readonly string[]).includes(field.type)) {
    problems.push(
      `Column "${field.key}" has an undrawable kind "${field.type}" (${where}).`,
    )
  }
  if (typeof field.required !== 'boolean') {
    problems.push(`Column "${field.key}" must say whether it is required.`)
  }
  const options = field.options ?? []
  if (field.type === 'select') {
    const clean = options.map((option) => option.trim()).filter(Boolean)
    const unique = new Set(clean)
    if (clean.length < 2 || clean.length > SELECT_OPTION_LIMIT) {
      problems.push(
        `Select "${field.key}" needs between 2 and ${SELECT_OPTION_LIMIT} choices (${where}).`,
      )
    } else if (unique.size !== clean.length) {
      problems.push(`Select "${field.key}" repeats a choice (${where}).`)
    }
  } else if (options.length > 0) {
    problems.push(`Only a select carries choices ("${field.key}" is ${field.type}).`)
  }
  return problems
}

/**
 * DB-backed definition check, run by the create route against the LIVE
 * column list. Returns every problem; empty means the definition writes.
 *
 * The coverage rule is the point: every column the database refuses to
 * leave empty (NOT NULL with no default, outside the system-owned pair)
 * must appear in the form as required. A form that cannot produce a valid
 * row is refused at build time, not at the filler's face.
 */
export function validateCustomFormFields(
  module: string,
  fields: readonly CustomFormFieldDef[],
  live: readonly CustomFormLiveColumn[],
): string[] {
  if (!isCustomFormModule(module)) {
    return [`Unknown module "${module}": custom forms link to a v1 module.`]
  }
  if (fields.length === 0) return ['Add at least one field.']
  if (fields.length > CUSTOM_FORM_FIELD_LIMIT) {
    return [`Keep it to ${CUSTOM_FORM_FIELD_LIMIT} fields or fewer.`]
  }
  const problems: string[] = []
  const liveNames = new Set(live.map((column) => column.name))
  const seen = new Set<string>()
  for (const field of fields) {
    if (seen.has(field.key)) {
      problems.push(`Column "${field.key}" appears twice: one input per column.`)
      continue
    }
    seen.add(field.key)
    problems.push(...fieldErrors(field, liveNames))
  }
  for (const column of live) {
    if (column.nullable || column.hasDefault) continue
    if ((CUSTOM_FORM_SYSTEM_COLUMNS as readonly string[]).includes(column.name)) {
      continue
    }
    const covering = fields.find((field) => field.key === column.name)
    if (!covering || covering.required !== true) {
      problems.push(
        `Column "${column.name}" cannot be left blank by the database: keep it in the form and mark it required.`,
      )
    }
  }
  return problems
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * Submission check, run by the submissions route before writing. Keys must
 * be the form's own fields, required fields must be filled, values must
 * match the field kind, and select values must be declared choices.
 */
export function validateSubmissionValues(
  fields: readonly CustomFormFieldDef[],
  values: Record<string, unknown>,
): string[] {
  const problems: string[] = []
  const byKey = new Map(fields.map((field) => [field.key, field]))
  for (const key of Object.keys(values)) {
    if (!byKey.has(key)) {
      problems.push(`"${key}" is not a field of this form.`)
    }
  }
  for (const field of fields) {
    const value = values[field.key]
    const blank =
      value === undefined ||
      value === null ||
      (typeof value === 'string' && value.trim().length === 0)
    if (blank) {
      if (field.required) problems.push(`"${field.label}" is required.`)
      continue
    }
    switch (field.type) {
      case 'string':
      case 'text':
        if (typeof value !== 'string') {
          problems.push(`"${field.label}" takes text.`)
        }
        break
      case 'number':
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          problems.push(`"${field.label}" takes a number.`)
        }
        break
      case 'integer':
        if (typeof value !== 'number' || !Number.isInteger(value)) {
          problems.push(`"${field.label}" takes a whole number.`)
        }
        break
      case 'boolean':
        if (typeof value !== 'boolean') {
          problems.push(`"${field.label}" takes yes or no.`)
        }
        break
      case 'date':
        if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
          problems.push(`"${field.label}" takes a date.`)
        }
        break
      case 'select':
        if (typeof value !== 'string') {
          problems.push(`"${field.label}" takes one of the choices.`)
        } else {
          const clean = (field.options ?? []).map((option) => option.trim())
          if (!clean.includes(value.trim())) {
            problems.push(`"${field.label}" is not one of the choices.`)
          }
        }
        break
    }
  }
  return problems
}
