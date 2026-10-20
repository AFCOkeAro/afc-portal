/**
 * Prior-year CSV import (AFC-485, ADR-0010 decision 3).
 *
 * Spec: prd-expansion §9.2 US-U2 (one template per domain, server-side
 * validation, per-row error report, idempotent natural keys, source-marked
 * comparable rows) + integrations-spec §9 (provenance: import_batch,
 * imported_by, imported_at) + data-model-expansion §13 flow
 * `prior_year.import` (validate + insert, idempotent).
 *
 * PROVENANCE CHOICE, STATED (smallest defensible option): this slice does NOT
 * ALTER the domain tables. Provenance lives in the `prior_year_imports` /
 * `prior_year_import_items` ledger (migration 0014): each item records
 * `source = 'import'`, `data_year`, the natural key, and the created
 * `target_id`. Domain rows hold business data only. Adding `source` columns
 * to `people` / finance tables touches personal data and is deferred to a
 * CTO-approved follow-up; the ledger join (`target_id`) is the comparable
 * marker until then. The ledger stores NO raw PII: people items carry only a
 * SHA-256 identity hash (see `personIdentityHash`), never a name, phone, or
 * email.
 *
 * Natural keys (idempotency = a test, not a claim; suite 81 re-imports):
 * - attendance: (session_date, branch_code, service_type, category, sex) —
 *   the session header is found-or-created by (branch, date, service_type)
 *   and each count row upserts on (session, category, sex) (suite 71 §71.4).
 * - blessings: (branch_code, service_date, blessing_type, other_label) —
 *   one row per (program, blessing_type) is the norm (US-B1 AC2), so the
 *   program date joins the key.
 * - people: person identity hash (normalised name + phone digits / email) —
 *   integrations-spec §9 "person dedupe on name+phone/email".
 * - finance: (branch_code, month) — the (branch, month) unique key (suite 68
 *   §68.7); WECA returns follow via `weca_compute_return` on the linked
 *   record, keyed (branch, period).
 */

export const IMPORT_DOMAINS = ['attendance', 'blessings', 'people', 'finance'] as const

export type ImportDomain = (typeof IMPORT_DOMAINS)[number]

export const IMPORT_SOURCE = 'import'

/** integrations-spec §9 limits: file size cap; large files go async. */
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024
export const MAX_IMPORT_ROWS = 5000

export interface ImportTemplate {
  domain: ImportDomain
  header: string[]
  example: string[]
}

export const IMPORT_TEMPLATES: Record<ImportDomain, ImportTemplate> = {
  attendance: {
    domain: 'attendance',
    header: [
      'branch_code',
      'service_date',
      'service_type',
      'category',
      'male',
      'female',
      'session_name',
    ],
    example: ['OKE-ARO', '2025-10-05', 'sunday_service', 'adults', '95', '110', 'Sunday Service'],
  },
  blessings: {
    domain: 'blessings',
    header: [
      'branch_code',
      'service_date',
      'blessing_type',
      'other_label',
      'male_count',
      'female_count',
      'notes',
    ],
    example: ['OKE-ARO', '2025-10-05', 'salvation', '', '3', '2', 'Sunday service'],
  },
  people: {
    domain: 'people',
    header: [
      'branch_code',
      'full_name',
      'phone',
      'email',
      'sex',
      'status',
      'person_type',
    ],
    example: ['OKE-ARO', 'Adaeze Okafor', '08031234567', 'adaeze@example.com', 'female', 'active', 'member'],
  },
  finance: {
    domain: 'finance',
    header: ['branch_code', 'month', 'income', 'intervention', 'faith_city', 'currency'],
    example: ['OKE-ARO', '2025-10-01', '1952150.00', '0', '38000.00', 'NGN'],
  },
}

export function templateCsv(domain: ImportDomain): string {
  const template = IMPORT_TEMPLATES[domain]
  if (!template) {
    throw new Error(`Unknown import domain: ${String(domain)}`)
  }
  return [template.header, template.example].map((row) => row.join(',')).join('\n') + '\n'
}

export interface ParsedCsv {
  header: string[]
  rows: string[][]
}

/**
 * Minimal RFC-4180 CSV reader (quoted fields, doubled quotes, CRLF). The
 * portal has no CSV dependency; the import cap (2MB / 5000 rows) bounds the
 * in-memory parse, same posture as the chunked export collectors.
 */
export function parseCsv(text: string): ParsedCsv {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = 0
  const push = (): void => {
    row.push(field)
    field = ''
  }
  while (i < text.length) {
    const char = text[i]
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
        } else {
          quoted = false
          i += 1
        }
      } else {
        field += char
        i += 1
      }
    } else if (char === '"') {
      quoted = true
      i += 1
    } else if (char === ',') {
      push()
      i += 1
    } else if (char === '\r' || char === '\n') {
      push()
      rows.push(row)
      row = []
      i += char === '\r' && text[i + 1] === '\n' ? 2 : 1
    } else {
      field += char
      i += 1
    }
  }
  push()
  rows.push(row)
  // Drop trailing blank lines (a final newline yields one empty row).
  while (rows.length > 0 && rows[rows.length - 1].every((cell) => cell.trim() === '')) {
    rows.pop()
  }
  if (rows.length === 0) return { header: [], rows: [] }
  const [header = [], ...rest] = rows
  return { header: header.map((cell) => cell.trim()), rows: rest }
}

export interface RowError {
  row: number
  errors: string[]
}

/**
 * Strict-mode reader for validated row maps. `noUncheckedIndexedAccess`
 * types every `values[key]` as `string | undefined`; validated rows always
 * carry every template column (see validateImportRows), so missing reads
 * collapse to '' rather than threading `| undefined` through every rule.
 */
export function cell(values: Record<string, string>, key: string): string {
  return values[key] ?? ''
}

export interface ValidatedImport {
  valid: Array<{ row: number; values: Record<string, string> }>
  errors: RowError[]
}

const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])-01$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const ATTENDANCE_IMPORT_CATEGORIES = [
  'children',
  'teens',
  'adults',
  'youth',
  'teachers',
  'ministers',
  'altar_workers',
  'avs',
  'visitors',
  'other',
] as const

export const ATTENDANCE_IMPORT_SERVICES = [
  'sunday_school',
  'elementary',
  'devotional',
  'youth_service',
  'revival_service',
  'sunday_service',
  'midweek',
  'event',
  'camp',
  'department',
  'special',
] as const

export const BLESSING_IMPORT_TYPES = [
  'salvation',
  'sanctification',
  'baptism_holy_ghost',
  'reanointing',
  'healing',
  'other',
] as const

function isInt(value: string, min = 0): boolean {
  return /^\d+$/.test(value.trim()) && Number(value.trim()) >= min
}

function isMoney(value: string): boolean {
  return /^\d+(\.\d{1,2})?$/.test(value.trim())
}

function checkDate(value: string): string | null {
  if (!DATE_RE.test(value.trim())) return 'expected YYYY-MM-DD'
  const date = new Date(`${value.trim()}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return 'not a calendar date'
  return null
}

/**
 * Server-side row validation (US-U2 AC2). Returns per-row errors; the route
 * commits only the valid rows and reports both counts explicitly (partial
 * import is explicit, integrations-spec §9). Row numbers are 1-based over
 * data rows (header is row 0) so the report points at the file the user sees.
 */
export function validateImportRows(domain: ImportDomain, parsed: ParsedCsv): ValidatedImport {
  const template = IMPORT_TEMPLATES[domain]
  const valid: ValidatedImport['valid'] = []
  const errors: RowError[] = []

  if (parsed.header.length === 0) {
    return { valid, errors: [{ row: 0, errors: ['the file is empty'] }] }
  }
  const missing = template.header.filter((column) => !parsed.header.includes(column))
  if (missing.length > 0) {
    return {
      valid,
      errors: [{ row: 0, errors: [`missing columns: ${missing.join(', ')}`] }],
    }
  }
  if (parsed.rows.length > MAX_IMPORT_ROWS) {
    return {
      valid,
      errors: [
        {
          row: 0,
          errors: [
            `too many rows (${parsed.rows.length}); split into files of ${MAX_IMPORT_ROWS} or fewer`,
          ],
        },
      ],
    }
  }

  const indexOf = (name: string): number => parsed.header.indexOf(name)
  parsed.rows.forEach((cells, position) => {
    const rowNumber = position + 1
    const values: Record<string, string> = {}
    for (const column of template.header) {
      values[column] = (cells[indexOf(column)] ?? '').trim()
    }
    const rowErrors: string[] = []
    const branchCode = cell(values, 'branch_code')
    if (domain === 'attendance') {
      if (!branchCode) rowErrors.push('branch_code is required')
      const dateError = checkDate(cell(values, 'service_date'))
      if (dateError) rowErrors.push(`service_date ${dateError}`)
      if (
        !(ATTENDANCE_IMPORT_SERVICES as readonly string[]).includes(cell(values, 'service_type'))
      ) {
        rowErrors.push(`service_type must be one of ${ATTENDANCE_IMPORT_SERVICES.join(', ')}`)
      }
      if (!(ATTENDANCE_IMPORT_CATEGORIES as readonly string[]).includes(cell(values, 'category'))) {
        rowErrors.push(`category must be one of ${ATTENDANCE_IMPORT_CATEGORIES.join(', ')}`)
      }
      if (!isInt(cell(values, 'male'))) rowErrors.push('male must be a whole number >= 0')
      if (!isInt(cell(values, 'female'))) rowErrors.push('female must be a whole number >= 0')
    } else if (domain === 'blessings') {
      if (!branchCode) rowErrors.push('branch_code is required')
      const dateError = checkDate(cell(values, 'service_date'))
      if (dateError) rowErrors.push(`service_date ${dateError}`)
      if (!(BLESSING_IMPORT_TYPES as readonly string[]).includes(cell(values, 'blessing_type'))) {
        rowErrors.push(`blessing_type must be one of ${BLESSING_IMPORT_TYPES.join(', ')}`)
      }
      if (cell(values, 'blessing_type') === 'other' && !cell(values, 'other_label')) {
        rowErrors.push('other_label is required when blessing_type is other')
      }
      if (!isInt(cell(values, 'male_count'))) rowErrors.push('male_count must be a whole number >= 0')
      if (!isInt(cell(values, 'female_count'))) {
        rowErrors.push('female_count must be a whole number >= 0')
      }
    } else if (domain === 'people') {
      if (!branchCode) rowErrors.push('branch_code is required')
      if (!cell(values, 'full_name')) rowErrors.push('full_name is required')
      if (!cell(values, 'phone') && !cell(values, 'email')) {
        rowErrors.push('phone or email is required (person identity)')
      }
      const phone = cell(values, 'phone')
      if (phone && !/^[+\d][\d\s-]{5,20}$/.test(phone)) {
        rowErrors.push('phone looks invalid')
      }
      const email = cell(values, 'email')
      if (email && !EMAIL_RE.test(email)) rowErrors.push('email looks invalid')
      const sex = cell(values, 'sex')
      if (sex && !['male', 'female'].includes(sex.toLowerCase())) {
        rowErrors.push('sex must be male or female')
      }
    } else {
      if (!branchCode) rowErrors.push('branch_code is required')
      if (!MONTH_RE.test(cell(values, 'month'))) {
        rowErrors.push('month must be the first of the month (YYYY-MM-01)')
      }
      if (!isMoney(cell(values, 'income'))) rowErrors.push('income must be a non-negative amount')
      if (cell(values, 'intervention') && !isMoney(cell(values, 'intervention'))) {
        rowErrors.push('intervention must be a non-negative amount')
      }
      if (cell(values, 'faith_city') && !isMoney(cell(values, 'faith_city'))) {
        rowErrors.push('faith_city must be a non-negative amount')
      }
      if (cell(values, 'currency') && cell(values, 'currency') !== 'NGN') {
        rowErrors.push('currency must be NGN (ADR-0008 v1)')
      }
    }
    if (rowErrors.length > 0) errors.push({ row: rowNumber, errors: rowErrors })
    else valid.push({ row: rowNumber, values })
  })

  return { valid, errors }
}

/** Idempotency key builders — the natural keys of ADR-0010 decision 3. */
export function attendanceImportKey(values: Record<string, string>): string {
  return [
    cell(values, 'branch_code').toUpperCase(),
    cell(values, 'service_date'),
    cell(values, 'service_type'),
    cell(values, 'category'),
    'male+female',
  ].join('|')
}

export function blessingsImportKey(values: Record<string, string>): string {
  return [
    cell(values, 'branch_code').toUpperCase(),
    cell(values, 'service_date'),
    cell(values, 'blessing_type'),
    cell(values, 'other_label').toLowerCase(),
  ].join('|')
}

export function financeImportKey(values: Record<string, string>): string {
  return [cell(values, 'branch_code').toUpperCase(), cell(values, 'month')].join('|')
}

/**
 * Person identity hash (integrations-spec §9 dedupe on name+phone/email).
 * Normalised (lowercased name, digit-only phone, lowercased email) then
 * SHA-256. The ledger stores ONLY this hash — raw PII never lands in an
 * import table, which is what keeps the ledger migration out of the
 * personal-data approval path.
 */
export async function personIdentityHash(values: Record<string, string>): Promise<string> {
  const name = (values.full_name ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  const phone = (values.phone ?? '').replace(/\D/g, '')
  const email = (values.email ?? '').trim().toLowerCase()
  const canonical = [name, phone, email].join('|')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function personIdentityHashSync(values: Record<string, string>): string {
  // Synchronous FNV-1a fallback for the DB-test documentation path only;
  // the route layer always uses `personIdentityHash` (SHA-256).
  const name = (values.full_name ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  const phone = (values.phone ?? '').replace(/\D/g, '')
  const email = (values.email ?? '').trim().toLowerCase()
  const canonical = [name, phone, email].join('|')
  let hash = 0x811c9dc5
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

export function dataYearOf(domain: ImportDomain, values: Record<string, string>): number {
  const raw = domain === 'finance' ? values.month : values.service_date
  return Number(String(raw ?? '').slice(0, 4))
}

export interface ImportSummary {
  domain: ImportDomain
  data_year: number | null
  received: number
  imported: number
  updated: number
  skipped: number
  errors: RowError[]
}
