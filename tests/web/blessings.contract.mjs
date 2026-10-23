/**
 * AFC-474 contract tests — blessings records: scoped list/detail/create with
 * audit, per-program multi-type, sort + CSV, permission-scoped export.
 *
 * Pure node:test, no dependencies. Asserts the structural contract the
 * blessings routes are built on:
 *   1. Schema: blessings carries the §3.4 column set with a GENERATED total
 *      and the other_label CHECK; blessing_events is the audit trail;
 *      the §3.4 + issue index set exists; the app has no DELETE.
 *   2. Scoping: the list/detail/patch routes resolve inside the caller's
 *      branch/zone scope (out-of-scope is a 403 on filters, a 404 on ids).
 *   3. Create: the form schema requires other_label exactly for `other`,
 *      never sends total_count, and the route writes a `created` audit row
 *      with the session user as actor.
 *   4. Audit: every create/update writes a blessing_events row; the detail
 *      route returns the trail.
 *   5. Reports: the list and the CSV read the same shared collector over
 *      the same scoped query; the CSV carries exactly the US-B2 columns.
 *   6. Surfaces: the event page shows linked blessings (US-E1), the service
 *      page shows its blessings tab, and branch/zone/BSC profiles link
 *      their counts to the filtered list (analytics-with-drill-down).
 *
 * Run: node --test tests/web/blessings.contract.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const codeOf = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')
/** SQL files comment with `--`, which codeOf leaves alone. */
const sqlOf = (rel) =>
  codeOf(rel)
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')

const MIGRATION = 'services/directus/schema/migrations/20261020_0011_blessings.sql'
const MIGRATION_COUNT = 'services/directus/schema/migrations/20261020_0034_blessings_count_recipients.sql'
const DOWN =
  'services/directus/schema/migrations/rollback/20261020_0011_blessings.down.sql'
const DOWN_COUNT =
  'services/directus/schema/migrations/rollback/20261020_0034_blessings_count_recipients.down.sql'
const ROUTES = {
  list: 'apps/web/server/api/blessings/index.get.ts',
  create: 'apps/web/server/api/blessings/index.post.ts',
  batch: 'apps/web/server/api/blessings/batch.post.ts',
  detail: 'apps/web/server/api/blessings/[id].get.ts',
  patch: 'apps/web/server/api/blessings/[id].patch.ts',
  csv: 'apps/web/server/api/blessings/reports.csv.get.ts',
  collector: 'apps/web/server/utils/blessing-report.ts',
  recipientsList: 'apps/web/server/api/blessing-recipients/index.get.ts',
  recipientsCreate: 'apps/web/server/api/blessing-recipients/index.post.ts',
  recipientsDetail: 'apps/web/server/api/blessing-recipients/[id].get.ts',
  recipientsPatch: 'apps/web/server/api/blessing-recipients/[id].patch.ts',
  eventDetail: 'apps/web/server/api/events/[id].get.ts',
  serviceDetail: 'apps/web/server/api/services/[id].get.ts',
  branchDetail: 'apps/web/server/api/branches/[id].get.ts',
}
const SHARED = {
  schema: 'packages/shared/src/schemas/blessings.ts',
  barrel: 'packages/shared/src/schemas/index.ts',
  collections: 'packages/shared/src/collections.ts',
  matrix: 'packages/shared/src/role-matrix.ts',
}
const PAGES = {
  list: 'apps/web/pages/blessings/index.vue',
  detail: 'apps/web/pages/blessings/[id].vue',
  modal: 'apps/web/components/BlessingFormModal.vue',
  event: 'apps/web/pages/events/[id].vue',
  service: 'apps/web/pages/services/[id].vue',
  branch: 'apps/web/pages/branches/[id].vue',
  zone: 'apps/web/pages/zones/[id].vue',
  bsc: 'apps/web/pages/bscs/[id].vue',
}

describe('blessings — schema (§3.4)', () => {
  it('the migration creates blessings with the §3.4 column set', () => {
    const src = sqlOf(MIGRATION)
    for (const column of [
      'blessing_type',
      'other_label',
      'male_count',
      'female_count',
      'total_count',
      'branch',
      'zone',
      'bsc',
      'session',
      'event',
      'sunday_service',
      'service_date',
      'recorded_by',
      'notes',
    ]) {
      assert.match(src, new RegExp(`\\b${column}\\b`), `migration must define ${column}`)
    }
  })

  it('total is GENERATED, never hand-editable, and absent from app grants', () => {
    const src = sqlOf(MIGRATION)
    assert.match(
      src,
      /total_count\s+integer\s+GENERATED ALWAYS AS \(male_count \+ female_count\) STORED/,
      'total_count must derive as male+female in the schema',
    )
    assert.match(src, /blessings_other_needs_label/, 'the other_label CHECK must exist')
    const grants = src.slice(src.indexOf('Least-privilege ceiling'))
    assert.doesNotMatch(
      grants,
      /total_count/,
      'total_count must not appear in the app grant lists',
    )
    assert.doesNotMatch(
      grants,
      /DELETE\s+ON\s+blessings|DELETE\s+ON\s+blessing_events/,
      'the app must hold no DELETE on blessings or their trail',
    )
  })

  it('the §3.4 + issue index set exists, including session', () => {
    const src = sqlOf(MIGRATION)
    for (const index of [
      'blessings_branch_idx',
      'blessings_zone_idx',
      'blessings_service_date_idx',
      'blessings_branch_date_idx',
      'blessings_zone_date_idx',
      'blessings_type_idx',
      'blessings_session_idx',
      'blessing_events_blessing_created_idx',
    ]) {
      assert.match(src, new RegExp(index), `index ${index} must exist`)
    }
  })

  it('the 0034 migration adds the single-count column with a backfill', () => {
    const src = sqlOf(MIGRATION_COUNT)
    assert.match(
      src,
      /ALTER TABLE blessings ADD COLUMN IF NOT EXISTS count integer NOT NULL DEFAULT 0/,
      'count column must be added idempotently',
    )
    assert.match(
      src,
      /blessings_count_nonnegative/,
      'the count non-negative CHECK must exist',
    )
    assert.match(
      src,
      /UPDATE blessings SET count = male_count \+ female_count/,
      'count must backfill as male+female',
    )
    assert.match(
      src,
      /GRANT INSERT \(count\) ON blessings TO directus_app/,
      'the app grant must extend to count',
    )
  })

  it('the 0034 migration creates blessing_recipients with the mapping lenses', () => {
    const src = sqlOf(MIGRATION_COUNT)
    for (const column of [
      'blessing',
      'blessing_type',
      'other_label',
      'person',
      'attendee_user',
      'branch',
      'service_date',
    ]) {
      assert.match(src, new RegExp(`\\b${column}\\b`), `recipients must define ${column}`)
    }
    assert.match(
      src,
      /blessing_recipients_needs_person/,
      'at-least-one-person CHECK must exist',
    )
    assert.match(
      src,
      /blessing_recipients_other_needs_label/,
      'the other-label CHECK must exist',
    )
    assert.match(
      src,
      /blessing_recipients_unique_entry/,
      'the idempotent per-person entry key must exist',
    )
  })

  it('recipients keep the least-privilege ceiling: read/write operational, no DELETE', () => {
    const src = sqlOf(MIGRATION_COUNT)
    // sqlOf strips `--` comments, so anchor on the GRANT itself.
    const grants = src.slice(src.indexOf('GRANT SELECT ON blessing_recipients'))
    assert.match(grants, /GRANT SELECT ON blessing_recipients TO directus_app/, 'read grant')
    assert.match(
      grants,
      /GRANT INSERT \(blessing, blessing_type/,
      'insert grant lists operational columns',
    )
    assert.doesNotMatch(
      grants,
      /DELETE\s+ON\s+blessing_recipients/,
      'the app must hold no DELETE on recipients',
    )
    assert.match(src, /REVOKE ALL ON blessing_recipients FROM PUBLIC/, 'public revoked')
  })

  it('the 0034 rollback refuses while rows exist and drops recipients before count', () => {
    const src = sqlOf(DOWN_COUNT)
    assert.match(src, /refusing to roll back blessings count\/recipients/, 'rollback must refuse with rows')
    assert.match(src, /ERRCODE = 'restrict_violation'/, 'refusal must be restrict_violation')
    const dropTable = src.indexOf('DROP TABLE IF EXISTS blessing_recipients')
    const dropColumn = src.indexOf('DROP COLUMN IF EXISTS count')
    assert.ok(
      dropTable !== -1 && dropColumn !== -1 && dropTable < dropColumn,
      'recipients must drop before the count column',
    )
    assert.doesNotMatch(src, /CASCADE/, 'rollback must use no CASCADE')
  })

  it('the 0011 rollback refuses while rows exist and drops in dependency order', () => {
    const src = sqlOf(DOWN)
    assert.match(src, /refusing to roll back blessings/, 'rollback must refuse with rows')
    assert.match(
      src,
      /ERRCODE = 'restrict_violation'/,
      'refusal must be restrict_violation',
    )
    const eventsDrop = src.indexOf('DROP TABLE IF EXISTS blessing_events')
    const blessingsDrop = src.indexOf('DROP TABLE IF EXISTS blessings;')
    assert.ok(
      eventsDrop !== -1 && blessingsDrop !== -1 && eventsDrop < blessingsDrop,
      'the trail must drop before its blessing table',
    )
    assert.doesNotMatch(src, /CASCADE/, 'rollback must use no CASCADE')
  })
})

describe('blessings — shared contracts', () => {
  it('the collections and the barrel export are registered', () => {
    assert.match(
      codeOf(SHARED.collections),
      /blessings: 'blessings'/,
      'blessings collection',
    )
    assert.match(
      codeOf(SHARED.collections),
      /blessingEvents: 'blessing_events'/,
      'blessingEvents collection',
    )
    assert.match(
      codeOf(SHARED.collections),
      /blessingRecipients: 'blessing_recipients'/,
      'blessingRecipients collection',
    )
    assert.match(
      codeOf(SHARED.barrel),
      /blessings/,
      'schemas barrel must export blessings',
    )
  })

  it('the form schema uses a single count and never sends total', () => {
    const src = codeOf(SHARED.schema)
    assert.match(src, /blessing_type !== 'other'/, 'other_label refine must exist')
    assert.match(src, /Name the other blessing/, 'the refine must point at the label')
    assert.match(src, /count: z\.coerce\.number\(\)\.int\(\)\.min\(0\)/, 'single count must exist')
    assert.doesNotMatch(
      src,
      /total_count:\s*z\./,
      'no form schema may accept total_count',
    )
    for (const type of [
      'salvation',
      'sanctification',
      'baptism_holy_ghost',
      'reanointing',
      'healing',
      'other',
    ]) {
      assert.match(src, new RegExp(`'${type}'`), `blessing type ${type} must be listed`)
    }
  })

  it('the bulk schema writes all types at once with row-level other-label errors', () => {
    const src = codeOf(SHARED.schema)
    assert.match(src, /blessingBulkFormSchema/, 'bulk form schema must exist')
    assert.match(src, /rows: z\.array\(blessingBulkRowSchema\)/, 'bulk rows must be typed')
    assert.match(src, /Enter at least one blessing count/, 'empty bulk must be rejected')
    assert.match(src, /\['rows', index, 'other_label'\]/, 'other-label errors must point at the row')
  })

  it('the recipient schema maps one person to blessing types with both lenses', () => {
    const src = codeOf(SHARED.schema)
    assert.match(src, /blessingRecipientFormSchema/, 'recipient form schema must exist')
    assert.match(src, /needsRecipientPerson/, 'the at-least-one-person refine must exist')
    assert.match(
      src,
      /Choose a person for this blessing/,
      'the person refine must point at the picker',
    )
    assert.match(src, /interface BlessingRecipient/, 'recipient interface must exist')
  })

  it('the permission row matches expansion §11 (CRUD/CRUD/CRUD zone/CRUD own/CRU dept/CU assigned)', () => {
    const src = codeOf(SHARED.matrix)
    const row = src.slice(
      src.indexOf('[COLLECTIONS.blessings]'),
      src.indexOf('[COLLECTIONS.blessingEvents]'),
    )
    assert.match(
      row,
      /branch_admin: \[ALL, 'own_branch', 'CRUD \(own\)'\]/,
      'branch CRUD own',
    )
    assert.match(
      row,
      /department_leader: \[CRU, 'own_department', 'CRU \(dept\)'\]/,
      'dept CRU',
    )
    assert.match(
      row,
      /volunteer: \[CU, 'own_branch', 'C\/U \(assigned\)'\]/,
      'volunteer C/U',
    )
    assert.match(row, /none: \[NONE, 'none'\]/, 'no public grant')
    assert.match(
      src.slice(src.indexOf('[COLLECTIONS.blessingRecipients]')),
      /branch_admin: \[ALL, 'own_branch', 'CRUD \(own\)'\]/,
      'recipients mirror blessings CRUD own',
    )
  })
})

describe('blessings — scoping (scoped list/detail/create + audit)', () => {
  it('the list and detail routes enforce the hierarchy predicate', () => {
    assert.match(
      codeOf(ROUTES.list),
      /collectBlessings/,
      'the list must read through the shared collector',
    )
    assert.match(
      codeOf(ROUTES.collector),
      /requireZoneInScope/,
      'an explicitly out-of-scope zone must 403',
    )
    assert.match(
      codeOf(ROUTES.collector),
      /resolveBranch\(scope/,
      'an explicitly out-of-scope branch must 403',
    )
    assert.match(
      codeOf(ROUTES.detail),
      /findScopedItem[\s\S]*?\(\s*event,\s*scope,\s*'blessings'/,
      'detail must resolve inside the caller scope (cross-scope ids 404)',
    )
    assert.match(
      codeOf(ROUTES.patch),
      /findScopedItem[\s\S]*?\(\s*event,\s*scope,\s*'blessings'/,
      'patch must resolve inside the caller scope (no foreign edits)',
    )
  })

  it('create validates, defaults the branch, and mirrors count into male', () => {
    const src = codeOf(ROUTES.create)
    assert.match(src, /blessingFormSchema\.safeParse/, 'create must validate the form')
    assert.match(
      src,
      /resolveBranch\(scope, form\.branch\)/,
      'branch must resolve in scope',
    )
    assert.match(src, /event_type: 'created'/, 'create must write the created audit row')
    assert.match(
      src,
      /actor_user: scope\.session\.user\.id/,
      'the audit actor is the session user',
    )
    assert.match(src, /male_count: maleCount/, 'create must mirror count into male')
    assert.match(src, /femaleCount/, 'create must clear female')
    assert.doesNotMatch(src, /total_count/, 'create must never send total_count')
  })

  it('batch writes all types at once with per-row idempotent results', () => {
    const src = codeOf(ROUTES.batch)
    assert.match(src, /blessingBulkFormSchema\.safeParse/, 'batch must validate the bulk form')
    assert.match(
      src,
      /resolveBranch\(scope, form\.branch\)/,
      'branch must resolve in scope',
    )
    assert.match(src, /requireCan\(scope, 'blessings', 'create'\)/, 'scope is unchanged')
    assert.match(src, /status: 'created'/, 'batch must report created rows')
    assert.match(src, /status: 'updated'/, 'batch must report updated rows')
    assert.match(src, /status: 'skipped'/, 'batch must report skipped rows')
    assert.match(
      src,
      /const existing = await listItems/,
      'batch must look up the existing row per type per program (idempotent upsert)',
    )
    assert.match(src, /event_type: 'created'/, 'batch must audit creates')
  })

  it('recipient routes validate the person and stay inside the caller scope', () => {
    const create = codeOf(ROUTES.recipientsCreate)
    assert.match(
      create,
      /blessingRecipientFormSchema\.safeParse/,
      'recipient create must validate the form',
    )
    assert.match(
      create,
      /findScopedItem\(event, scope, 'people'/,
      'the person must resolve inside the caller scope',
    )
    assert.match(
      create,
      /requireCan\(scope, 'blessing_recipients', 'create'\)/,
      'scope is enforced on create',
    )
    assert.match(
      create,
      /code: 'conflict'/,
      'duplicate mappings must 409 with a named code',
    )
    assert.match(
      create,
      /DirectusAuthError/,
      'recipient create must recognise a Directus denial (AFC-714)',
    )
    assert.match(
      create,
      /code: 'blessing_recipients_forbidden'/,
      'a Directus denial must map to a named 403, never 400 with empty fields',
    )
    assert.match(
      create,
      /statusCode: 403[\s\S]*?blessing_recipients_forbidden/,
      'the named denial must carry the 403 status',
    )
    assert.match(
      create,
      /directus_forbidden/,
      'the user-token denial code must be recognised, not fall through to 400',
    )
    assert.match(
      codeOf(ROUTES.recipientsList),
      /blessingScopeFilter\(event, scope/,
      'the list must read through the shared scope filter',
    )
    assert.match(
      codeOf(ROUTES.recipientsDetail),
      /findScopedItem[\s\S]*?\(\s*event,\s*scope,\s*'blessing_recipients'/,
      'detail must resolve inside the caller scope',
    )
    assert.match(
      codeOf(ROUTES.recipientsPatch),
      /findScopedItem[\s\S]*?\(\s*event,\s*scope,\s*'blessing_recipients'/,
      'patch must resolve inside the caller scope',
    )
  })

  it('recipients detail falls back to first + last name (AFC-747)', () => {
    const src = codeOf(ROUTES.recipientsDetail)
    assert.match(
      src,
      /first_name/,
      'recipients detail must read first_name for the person fallback',
    )
    assert.match(
      src,
      /last_name/,
      'recipients detail must read last_name for the person fallback',
    )
    assert.doesNotMatch(
      src,
      /full_name/,
      'recipients detail must not rely on full_name (people carry first/last)',
    )
    assert.match(
      src,
      /preferred \|\| base \|\| null/,
      'recipients detail must resolve preferred, then first+last, then null',
    )
  })

  it('patch audits the edit and detail returns the trail', () => {
    assert.match(codeOf(ROUTES.patch), /event_type: 'updated'/, 'patch writes updated')
    assert.match(
      codeOf(ROUTES.detail),
      /blessing_events/,
      'detail must return the audit trail',
    )
  })

  it('the sort parameter is an allowlist (US-B2 sort)', () => {
    const src = codeOf(ROUTES.collector)
    assert.match(src, /-service_date/, 'newest-first sort must exist')
    assert.match(src, /-total_count/, 'total sort must exist')
    assert.match(src, /blessingSortParam/, 'sort must pass through the allowlist')
  })

  it('the collector reads the single count and breaks down by type only', () => {
    const src = codeOf(ROUTES.collector)
    assert.match(src, /'count',/, 'the collector must read count')
    assert.match(
      src,
      /existing\.count \+= count|existing\.count \+=/,
      'the breakdown must sum the single count',
    )
    assert.doesNotMatch(src, /existing\.male/, 'the breakdown must not sum male')
    assert.match(
      src,
      /String\(\(row as BlessingRow\)\.count \?\? row\.total_count \?\? 0\)|count \?\?/,
      'the CSV must read count with a legacy fallback',
    )
  })
})

describe('blessings — CSV export respects scope (US-B2)', () => {
  it('the CSV reads the same collector with the same filters and scope', () => {
    const src = codeOf(ROUTES.csv)
    assert.match(
      src,
      /collectBlessings\(event, scope/,
      'CSV must read the shared collector',
    )
    assert.match(
      src,
      /blessingReportFilters\(event\)/,
      'CSV must honour the same filters',
    )
    assert.match(src, /range_too_large/, 'oversized exports must refuse with guidance')
  })

  it('the CSV carries exactly the single-count US-B2 columns', () => {
    const src = codeOf(SHARED.schema)
    assert.match(
      src,
      /'branch',\s*'zone',\s*'service',\s*'date',\s*'blessing_type',\s*'count'/,
      'CSV column order must be branch, zone, service, date, type, count',
    )
    assert.doesNotMatch(
      src,
      /'male',\s*'female',\s*'total'/,
      'the sex-split columns must be gone',
    )
  })
})

describe('blessings — program and profile surfaces', () => {
  it('the event page shows linked blessings (US-E1 blessings side)', () => {
    const route = codeOf(ROUTES.eventDetail)
    assert.match(
      route,
      /filter: mergeFilters\(\s*\{ event: \{ _eq: id \} \}/,
      'event detail must query blessings linked to the event inside the scope predicate',
    )
    assert.match(route, /blessings_total/, 'event detail must roll up the blessing total')
    const page = codeOf(PAGES.event)
    assert.match(page, /BlessingFormModal/, 'the event page must offer recording')
    assert.match(
      page,
      /preset="\{\s*event: event\.id/,
      'recording must pre-fill the event link',
    )
  })

  it('the service page shows its blessings tab with pre-filled recording', () => {
    const route = codeOf(ROUTES.serviceDetail)
    assert.match(
      route,
      /\{ sunday_service: \{ _eq: id \} \}/,
      'service detail must query blessings linked to the service inside the scope predicate',
    )
    const page = codeOf(PAGES.service)
    assert.match(
      page,
      /tab === 'blessings'/,
      'the service page must have a blessings tab',
    )
    assert.match(
      page,
      /preset="\{\s*sunday_service: service\.id/,
      'recording must pre-fill the service link',
    )
  })

  it('branch/zone/BSC profiles link their counts to the filtered list', () => {
    const route = codeOf(ROUTES.branchDetail)
    assert.match(route, /blessingsRollup/, 'branch detail must roll up blessings')
    assert.match(
      route,
      /blessings_breakdown/,
      'branch detail must return the per-type breakdown',
    )
    assert.match(
      codeOf(PAGES.branch),
      /to="`\/blessings\?branch=\$\{data\.id\}`"/,
      'the branch profile must link its count to the filtered list',
    )
    assert.match(
      codeOf(PAGES.zone),
      /to="`\/blessings\?zone=\$\{zoneId\}`"/,
      'the zone profile must link to the zone-filtered list',
    )
    assert.match(
      codeOf(PAGES.bsc),
      /to="`\/blessings\?bsc=\$\{bscId\}`"/,
      'the BSC profile must link to the centre-filtered list',
    )
  })

  it('the list page filters by branch/zone/type/bucket and exports the same query', () => {
    const src = codeOf(PAGES.list)
    for (const binding of [
      'v-model="branch"',
      'v-model="zone"',
      'v-model="blessingType"',
      'v-model="period"',
      'v-model="sort"',
    ]) {
      assert.match(
        src,
        new RegExp(binding.replace(/"/g, '"')),
        `list must bind ${binding}`,
      )
    }
    assert.match(
      src,
      /reports\.csv/,
      'the list must link the CSV export of the same query',
    )
    assert.match(src, /date_from/, 'custom ranges must reach the query')
  })

  it('the modal enters all types on one screen with no sex split', () => {
    const src = codeOf(PAGES.modal)
    assert.match(
      src,
      /preset\?\.sunday_service/,
      'the modal must accept a service pre-fill',
    )
    assert.match(src, /preset\?\.event/, 'the modal must accept an event pre-fill')
    assert.match(src, /other_label/, 'the modal must collect the other label')
    assert.match(
      src,
      /\/api\/blessings\/batch/,
      'the modal must save through the batch endpoint',
    )
    assert.match(
      src,
      /form\.counts\[type\.value\]|form\.counts\[/,
      'the modal must hold one count per type',
    )
    assert.doesNotMatch(
      src,
      /male_count|female_count/,
      'the modal must ask no male/female inputs',
    )
  })

  it('the detail page shows a single count with the individual section', () => {
    const src = codeOf(PAGES.detail)
    assert.match(src, /Individual blessings/, 'detail must show the individual section')
    assert.match(
      src,
      /standalone_recipients/,
      'detail must show standalone rows alongside linked ones',
    )
    assert.match(
      src,
      /\/api\/blessing-recipients/,
      'detail must link people through the recipients route',
    )
    assert.match(
      src,
      /server-search/,
      'the person picker must be searchable, never a manual id',
    )
  })
})
