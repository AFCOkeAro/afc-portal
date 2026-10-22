import {
  cell,
  IMPORT_DOMAINS,
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  dataYearOf,
  parseCsv,
  personIdentityHash,
  validateImportRows,
  type ImportDomain,
  type ImportSummary,
  type RowError,
} from '../../utils/prior-year-import'
import {
  createItem,
  getPortalScope,
  listItems,
  mergeFilters,
  requireCan,
  type PortalScope,
} from '../../utils/portal'

/**
 * Prior-year CSV import (AFC-485, US-U2 AC2–AC3).
 *
 * POST /api/imports/:domain with a `text/csv` body (or JSON `{ "csv": "..." }`
 * for scripted callers). Server-side validation, per-row error report,
 * idempotent natural keys, permission-scoped:
 *
 * - attendance → sessions found-or-created by (branch, date, service_type);
 *   counts upserted on (session, category, sex) male/female rows.
 * - blessings → upserted on (branch, service_date, blessing_type).
 * - people → deduped on identity (email/phone exact match, else name+branch);
 *   creates only, never updates PII from a bulk file (smallest defensible
 *   reading: a re-import of the same identity is a skip, not an overwrite).
 * - finance → upserted on (branch, month); the WECA return row is
 *   found-or-created as `formula_pending` and its computation stays with
 *   `weca_compute_return` / the `weca.calculate` Flow (no arithmetic here).
 *
 * Idempotency promise: re-importing the same file produces zero new rows —
 * matches become `skipped` (identical) or `updated` (changed business values
 * under the same natural key). Suite 81 proves the key half in SQL; the
 * route half is read-then-write because Directus exposes no ON CONFLICT.
 *
 * Provenance: every batch writes a `prior_year_imports` ledger row with
 * `source = 'import'`, `data_year`, `imported_by`, `imported_at`, plus one
 * `prior_year_import_items` row per received data row (natural key +
 * target link + status). The ledger tables land with migration 0014; until
 * then the writes are tolerated failures and the response reports
 * `ledger: 'pending_migration_0014'` instead of failing the import.
 */

const WRITE_COLLECTION: Record<ImportDomain, string> = {
  attendance: 'attendance_sessions',
  blessings: 'blessings',
  people: 'people',
  finance: 'branch_financial_records',
}

interface BranchRow {
  id: string
  code: string
  zone: string | null
}

async function branchIdsByCode(
  event: Parameters<typeof listItems>[0],
  scope: PortalScope,
  codes: string[],
): Promise<Map<string, BranchRow>> {
  const upper = [...new Set(codes.map((code) => code.toUpperCase()))]
  const result = await listItems<BranchRow>(event, scope, 'branches', {
    filter: { code: { _in: upper } },
    fields: ['id', 'code', 'zone'],
    limit: upper.length,
  })
  return new Map(result.data.map((row) => [String(row.code).toUpperCase(), row]))
}

function branchInScope(scope: PortalScope, branchId: string): boolean {
  return scope.isArea || scope.branchIds.includes(branchId)
}

async function writeLedger(
  event: Parameters<typeof listItems>[0],
  scope: PortalScope,
  batch: Record<string, unknown>,
  items: Array<Record<string, unknown>>,
): Promise<{ batchId: string | null; ledger: string }> {
  try {
    const created = await createItem<{ id: string }>(
      event,
      scope,
      'prior_year_imports',
      batch,
    )
    for (const item of items) {
      try {
        await createItem(event, scope, 'prior_year_import_items', {
          ...item,
          import: created.id,
        })
      } catch {
        // One bad item row must not lose the batch record; the import
        // response already carries the per-row report.
      }
    }
    return { batchId: String(created.id), ledger: 'recorded' }
  } catch {
    return { batchId: null, ledger: 'pending_migration_0014' }
  }
}

export default defineEventHandler(async (event) => {
  const domain = getRouterParam(event, 'domain') as ImportDomain
  if (!(IMPORT_DOMAINS as readonly string[]).includes(domain)) {
    throw createError({
      statusCode: 404,
      statusMessage: `Unknown import domain. Use one of: ${IMPORT_DOMAINS.join(', ')}`,
      data: { code: 'unknown_domain' },
    })
  }
  const scope = await getPortalScope(event)
  requireCan(scope, WRITE_COLLECTION[domain], 'create')

  const body = await readBody(event).catch(() => null)
  const csv: unknown =
    typeof body === 'string' ? body : (body as { csv?: unknown } | null)?.csv
  if (typeof csv !== 'string' || csv.trim() === '') {
    throw createError({
      statusCode: 400,
      statusMessage:
        'Send the CSV file as the request body (text/csv) or as JSON { "csv": "..." }',
      data: { code: 'csv_required' },
    })
  }
  if (Buffer.byteLength(csv, 'utf8') > MAX_IMPORT_BYTES) {
    throw createError({
      statusCode: 400,
      statusMessage: `That file is larger than 2MB. Split it into smaller files of ${MAX_IMPORT_ROWS} rows or fewer.`,
      data: { code: 'file_too_large' },
    })
  }

  const parsed = parseCsv(csv)
  const { valid, errors } = validateImportRows(domain, parsed)
  let imported = 0
  let updated = 0
  let skipped = 0
  const rowErrors: RowError[] = [...errors]
  const items: Array<Record<string, unknown>> = []

  const codes = valid.map(({ values }) => {
    const template = {
      attendance: 'branch_code',
      blessings: 'branch_code',
      people: 'branch_code',
      finance: 'branch_code',
    } as const
    return values[template[domain]] ?? ''
  })
  const branches = await branchIdsByCode(event, scope, codes)
  const dataYears = new Set<number>()

  for (const { row, values } of valid) {
    const code = cell(values, 'branch_code').toUpperCase()
    const branch = branches.get(code)
    if (!branch) {
      rowErrors.push({ row, errors: [`unknown branch_code: ${values.branch_code}`] })
      items.push({
        row_number: row,
        natural_key: code,
        status: 'error',
        error: 'unknown branch_code',
      })
      continue
    }
    if (!branchInScope(scope, branch.id)) {
      rowErrors.push({ row, errors: ['that branch is outside your scope'] })
      items.push({
        row_number: row,
        natural_key: code,
        status: 'error',
        error: 'branch_out_of_scope',
      })
      continue
    }
    const year = dataYearOf(domain, values)
    if (Number.isFinite(year)) dataYears.add(year)
    try {
      if (domain === 'finance') {
        const outcome = await upsertFinance(event, scope, branch.id, values)
        if (outcome === 'imported') imported += 1
        else if (outcome === 'updated') updated += 1
        else skipped += 1
        items.push({
          row_number: row,
          natural_key: `${code}|${values.month}`,
          status: outcome,
          data_year: year,
          target_collection: 'branch_financial_records',
        })
      } else if (domain === 'blessings') {
        const outcome = await upsertBlessing(event, scope, branch.id, branch.zone, values)
        if (outcome === 'imported') imported += 1
        else if (outcome === 'updated') updated += 1
        else skipped += 1
        items.push({
          row_number: row,
          natural_key: `${code}|${values.service_date}|${values.blessing_type}`,
          status: outcome,
          data_year: year,
          target_collection: 'blessings',
        })
      } else if (domain === 'attendance') {
        const outcome = await upsertAttendance(
          event,
          scope,
          branch.id,
          branch.zone,
          values,
        )
        if (outcome === 'imported') imported += 1
        else if (outcome === 'updated') updated += 1
        else skipped += 1
        items.push({
          row_number: row,
          natural_key: `${code}|${values.service_date}|${values.service_type}|${values.category}`,
          status: outcome,
          data_year: year,
          target_collection: 'attendance_counts',
        })
      } else {
        const outcome = await upsertPerson(event, scope, branch.id, values)
        if (outcome === 'imported') imported += 1
        else skipped += 1
        const identity = await personIdentityHash(values)
        items.push({
          row_number: row,
          natural_key: identity,
          status: outcome,
          data_year: year,
          target_collection: 'people',
        })
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'insert failed'
      rowErrors.push({ row, errors: [message] })
      items.push({
        row_number: row,
        natural_key: code,
        status: 'error',
        error: message.slice(0, 500),
      })
    }
  }

  const summary: ImportSummary = {
    domain,
    data_year: dataYears.size === 1 ? ([...dataYears][0] ?? null) : null,
    received: parsed.rows.length,
    imported,
    updated,
    skipped,
    errors: rowErrors,
  }

  const { batchId, ledger } = await writeLedger(
    event,
    scope,
    {
      domain,
      source: 'import',
      data_year: summary.data_year,
      filename: null,
      received_rows: summary.received,
      imported_rows: imported,
      updated_rows: updated,
      skipped_rows: skipped,
      error_rows: rowErrors.length,
      imported_by: scope.session.user.id,
      status: rowErrors.length === 0 ? 'committed' : 'partial',
    },
    items.map((item) => ({ ...item, source: 'import' })),
  )

  return { ...summary, import_id: batchId, ledger }
})

type Outcome = 'imported' | 'updated' | 'skipped'

async function upsertFinance(
  event: Parameters<typeof listItems>[0],
  scope: PortalScope,
  branchId: string,
  values: Record<string, string>,
): Promise<Outcome> {
  const existing = await listItems<Record<string, unknown>>(
    event,
    scope,
    'branch_financial_records',
    {
      filter: mergeFilters(
        { branch: { _eq: branchId } },
        { month: { _eq: values.month } },
      ),
      fields: ['id', 'income', 'intervention', 'faith_city', 'currency', 'status'],
      limit: 1,
    },
  )
  const body = {
    branch: branchId,
    month: values.month,
    income: values.income,
    intervention: values.intervention || null,
    faith_city: values.faith_city || null,
    currency: values.currency || 'NGN',
  }
  const row = existing.data[0]
  if (!row) {
    const created = await createItem<{ id: string }>(
      event,
      scope,
      'branch_financial_records',
      body,
    )
    // The computed return follows the existing engine: a pending row the
    // weca.calculate Flow (or weca_compute_return) settles. No arithmetic here.
    try {
      await createItem(event, scope, 'weca_returns', {
        branch: branchId,
        financial_record: created.id,
        period: cell(values, 'month').slice(0, 7),
        computation_status: 'formula_pending',
      })
    } catch {
      // A return for this period may already exist; the flow reconciles it.
    }
    return 'imported'
  }
  const same =
    String(row.income) === String(body.income) &&
    String(row.intervention ?? '') === String(body.intervention ?? '') &&
    String(row.faith_city ?? '') === String(body.faith_city ?? '')
  if (same) return 'skipped'
  await updateItem(event, scope, 'branch_financial_records', String(row.id), body)
  return 'updated'
}

async function upsertBlessing(
  event: Parameters<typeof listItems>[0],
  scope: PortalScope,
  branchId: string,
  zoneId: string | null,
  values: Record<string, string>,
): Promise<Outcome> {
  const existing = await listItems<Record<string, unknown>>(event, scope, 'blessings', {
    filter: mergeFilters(
      { branch: { _eq: branchId } },
      { service_date: { _eq: values.service_date } },
      { blessing_type: { _eq: values.blessing_type } },
    ),
    fields: ['id', 'count', 'male_count', 'female_count', 'other_label'],
    limit: 2,
  })
  const match = existing.data.find(
    (row) => String(row.other_label ?? '') === values.other_label,
  )
  // Single-count (AFC-671): imports still carry male/female columns; the
  // count is their sum and male mirrors it so GENERATED total agrees.
  const count = Number(values.male_count) + Number(values.female_count)
  const body = {
    branch: branchId,
    zone: zoneId,
    service_date: values.service_date,
    blessing_type: values.blessing_type,
    other_label: values.other_label || null,
    count,
    male_count: count,
    female_count: 0,
    notes: values.notes || null,
  }
  if (!match) {
    await createItem(event, scope, 'blessings', body)
    return 'imported'
  }
  const same = Number(match.count ?? match.male_count) === body.count
  if (same) return 'skipped'
  await updateItem(event, scope, 'blessings', String(match.id), {
    count: body.count,
    male_count: body.count,
    female_count: 0,
  })
  return 'updated'
}

async function upsertAttendance(
  event: Parameters<typeof listItems>[0],
  scope: PortalScope,
  branchId: string,
  zoneId: string | null,
  values: Record<string, string>,
): Promise<Outcome> {
  const sessions = await listItems<Record<string, unknown>>(
    event,
    scope,
    'attendance_sessions',
    {
      filter: mergeFilters(
        { branch: { _eq: branchId } },
        { session_date: { _eq: values.service_date } },
        { service_type: { _eq: values.service_type } },
      ),
      fields: ['id'],
      limit: 1,
    },
  )
  let sessionId = sessions.data[0] ? String(sessions.data[0].id) : null
  if (!sessionId) {
    const created = await createItem<{ id: string }>(
      event,
      scope,
      'attendance_sessions',
      {
        branch: branchId,
        zone: zoneId,
        session_date: values.service_date,
        service_type: values.service_type,
        session_name: values.session_name || `Imported ${values.service_date}`,
        status: 'recorded',
        idempotency_key: `import:${branchId}:${values.service_date}:${values.service_type}`,
      },
    )
    sessionId = String(created.id)
  }
  let outcome: Outcome = 'skipped'
  for (const sex of ['male', 'female'] as const) {
    const count = Number(sex === 'male' ? values.male : values.female)
    const existing = await listItems<Record<string, unknown>>(
      event,
      scope,
      'attendance_counts',
      {
        filter: mergeFilters(
          { session: { _eq: sessionId } },
          { category: { _eq: values.category } },
          { sex: { _eq: sex } },
        ),
        fields: ['id', 'count'],
        limit: 1,
      },
    )
    const row = existing.data[0]
    if (!row) {
      await createItem(event, scope, 'attendance_counts', {
        session: sessionId,
        category: values.category,
        sex,
        count,
      })
      outcome = 'imported'
    } else if (Number(row.count) !== count) {
      await updateItem(event, scope, 'attendance_counts', String(row.id), { count })
      if (outcome === 'skipped') outcome = 'updated'
    }
  }
  return outcome
}

async function upsertPerson(
  event: Parameters<typeof listItems>[0],
  scope: PortalScope,
  branchId: string,
  values: Record<string, string>,
): Promise<Outcome> {
  // Dedupe on the strongest signal available: exact email, then digit-only
  // phone. A re-import of the same identity is a skip — the route never
  // overwrites PII from a bulk file (see header choice).
  const filters = []
  if (values.email) filters.push({ email: { _eq: values.email.trim().toLowerCase() } })
  if (values.phone) {
    filters.push({ phone: { _eq: values.phone.trim() } })
  }
  if (filters.length > 0) {
    const existing = await listItems<Record<string, unknown>>(event, scope, 'people', {
      filter: { _or: filters },
      fields: ['id'],
      limit: 1,
    })
    if (existing.data.length > 0) return 'skipped'
  }
  await createItem(event, scope, 'people', {
    branch: branchId,
    first_name: values.full_name,
    phone: values.phone || null,
    email: values.email ? values.email.trim().toLowerCase() : null,
    gender: values.sex ? values.sex.toLowerCase() : null,
    status: values.status || 'active',
    person_type: values.person_type || 'member',
  })
  return 'imported'
}
