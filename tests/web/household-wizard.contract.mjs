/**
 * AFC-590 contract tests — guided New Family wizard (roles, contacts,
 * SMS/WhatsApp consent).
 *
 * Pure node:test, no dependencies. Asserts the structural contract:
 *  1. The wizard schema names the four household roles on the member
 *     model (no parallel role system), requires exactly one head, and
 *     validates contacts with the shared phone/email schemas.
 *  2. The submit route creates household + people + head link + consent
 *     records with a scoped branch, writes nothing for unchecked boxes,
 *     and returns named field errors.
 *  3. The wizard page is staff-only, kit-styled, branch-scoped, and
 *     linked from the household list; the detail view renders roles.
 *  4. Migration 0026 extends people with a CHECK-bound household_role
 *     (rollback refuses while roles exist); suite 91 pins it.
 *
 * Run: node --test tests/web/household-wizard.contract.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const codeOf = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')

describe('schemas: the wizard extends the household member model', () => {
  const schema = read('packages/shared/src/schemas/household-wizard.ts')
  const barrel = read('packages/shared/src/schemas/index.ts')

  it('names the four member roles and nothing else', () => {
    for (const role of ['head_of_household', 'spouse', 'child', 'relative']) {
      assert.ok(schema.includes(`'${role}'`), `wizard names role ${role}`)
    }
  })

  it('stores the role on the member, not in a parallel system', () => {
    assert.match(schema, /household_role/)
    assert.doesNotMatch(schema, /household_roles/)
    assert.doesNotMatch(schema, /CREATE TABLE/)
  })

  it('covers the per-row contact fields from the issue', () => {
    for (const field of [
      'first_name',
      'last_name',
      'gender',
      'date_of_birth',
      'phone',
      'email',
      'consent_sms',
      'consent_whatsapp',
    ]) {
      assert.ok(schema.includes(field), `wizard member names ${field}`)
    }
  })

  it('restricts gender to M/F per the issue adaptation', () => {
    assert.match(schema, /householdWizardGenderSchema/)
    assert.match(schema, /'male', 'female'/)
  })

  it('validates phone and email with the shared schemas', () => {
    assert.match(schema, /phoneSchema/)
    assert.match(schema, /emailSchema|z\.string\(\)\.email\(\)/)
  })

  it('consent boxes default to false so untouched means no', () => {
    assert.match(schema, /consent_sms: z\.boolean\(\)\.default\(false\)/)
    assert.match(schema, /consent_whatsapp: z\.boolean\(\)\.default\(false\)/)
  })

  it('requires at least one member and exactly one head', () => {
    assert.match(schema, /min\(1, 'Add at least one person'\)/)
    assert.match(schema, /Only one person can be head of household/)
    assert.match(schema, /Mark one person as head of household/)
  })

  it('bounds the member fan-out', () => {
    assert.match(schema, /MAX_WIZARD_MEMBERS/)
    assert.match(schema, /max\(MAX_WIZARD_MEMBERS/)
  })

  it('carries the household block: scoped branch plus address', () => {
    assert.match(schema, /branch: uuidSchema/)
    assert.match(schema, /address: optionalNote\(\)/)
  })

  it('is exported from the shared barrel', () => {
    assert.ok(barrel.includes("'./household-wizard'"), 'barrel exports household-wizard')
  })
})

describe('types: the role is readable where members render', () => {
  it('adds household_role to the shared Person type', () => {
    const types = read('packages/shared/src/types.ts')
    assert.match(types, /household_role/)
  })

  it('adds household_role to the portal member row', () => {
    const portal = read('apps/web/types/portal.ts')
    assert.match(portal, /household_role/)
  })
})

describe('wizard route: one scoped submit, named field errors', () => {
  const src = codeOf('apps/web/server/api/households/wizard.post.ts')

  it('gates all three writes on capabilities', () => {
    assert.match(src, /requireCan\(scope, 'households', 'create'\)/)
    assert.match(src, /requireCan\(scope, 'people', 'create'\)/)
    assert.match(src, /requireCan\(scope, 'consent_records', 'create'\)/)
  })

  it('validates with the wizard schema and returns named field errors', () => {
    assert.match(src, /householdWizardSchema\.safeParse/)
    assert.match(src, /throwValidation\(parsed\.error\)/)
  })

  it('scopes the branch to the caller', () => {
    assert.match(src, /resolveBranch\(scope, form\.branch\)/)
  })

  it('creates the household before its members', () => {
    assert.match(src, /createItem[\s\S]*?'households'/)
    assert.match(src, /status: 'active'/)
  })

  it('writes members with the household link and the wizard role', () => {
    assert.match(src, /household: householdId/)
    assert.match(src, /household_role: member\.role/)
  })

  it('refuses a minor as head with a named field error', () => {
    assert.match(src, /head of household must be/i)
    assert.match(src, /members\.\$\{headIndex\}\.date_of_birth/)
  })

  it('points minor members at the head as guardian', () => {
    assert.match(src, /guardian: isMinor \? headId : null/)
  })

  it('sets the household head from the head row', () => {
    assert.match(src, /household_head: headId/)
    assert.match(src, /primary_contact: headId/)
  })

  it('writes explicit_opt_in for adults and guardian for minors', () => {
    assert.match(src, /consent_type: 'channel'/)
    assert.match(src, /basis: isMinor \? 'guardian' : 'explicit_opt_in'/)
    assert.match(src, /method: 'digital'/)
  })

  it('writes nothing for unchecked channels', () => {
    assert.match(src, /if \(!checked \|\| !phone\) continue/)
  })

  it('hashes the contact like the invite path', () => {
    assert.match(src, /sha256:/)
    assert.match(src, /createHash\('sha256'\)/)
  })

  it('reports a partial write instead of a bare 500', () => {
    assert.match(src, /wizard_partial_write/)
    assert.match(src, /member_ids: progress\.member_ids/)
  })

  it('states the no-transaction limit in the file', () => {
    const withComments = read('apps/web/server/api/households/wizard.post.ts')
    assert.match(withComments, /NO CROSS-COLLECTION TRANSACTION/)
  })
})

describe('wizard page: staff-only guided submit with kit styling', () => {
  const page = codeOf('apps/web/pages/households/new.vue')
  const raw = read('apps/web/pages/households/new.vue')

  it('is staff-only', () => {
    assert.match(page, /middleware: 'staff'/)
  })

  it('renders a PageHeader and posts to the wizard route', () => {
    assert.match(page, /<PageHeader/)
    assert.match(page, /\/api\/households\/wizard/)
  })

  it('scopes the branch select to the caller branches', () => {
    assert.match(page, /\/api\/branches/)
    assert.match(page, /Use my branch/)
  })

  it('offers the four roles and M/F gender per row', () => {
    assert.match(page, /Head of household/)
    assert.match(page, /Spouse/)
    assert.match(page, /Child/)
    assert.match(page, /Relative/)
    assert.match(page, /Male/)
    assert.match(page, /Female/)
  })

  it('names contact inputs and per-channel consent boxes', () => {
    assert.match(page, /Birth date/)
    assert.match(page, /Phone/)
    assert.match(page, /Email/)
    assert.match(page, /consent_sms/)
    assert.match(page, /consent_whatsapp/)
    assert.match(raw, /unchecked box stores nothing/)
  })

  it('supports adding and removing people', () => {
    assert.match(page, /Add person/)
    assert.match(page, /Remove person/)
  })

  it('surfaces named field errors per member row', () => {
    assert.match(page, /members\.\$\{index\}\.\$\{field\}/)
  })

  it('links back to the household list and lands on the new detail', () => {
    assert.match(page, /Back to households/)
    assert.match(page, /`\/households\/\$\{result\.data\.household_id\}`/)
  })

  it('is linked from the household list', () => {
    const index = codeOf('apps/web/pages/households/index.vue')
    assert.match(index, /to="\/households\/new"/)
    assert.match(index, /New family/)
  })

  it('renders the role on the household detail', () => {
    const detailRoute = codeOf('apps/web/server/api/households/[id].get.ts')
    assert.match(detailRoute, /household_role/)
    const detailPage = codeOf('apps/web/pages/households/[id].vue')
    assert.match(detailPage, /household_role/)
  })
})

describe('migration: 0026 extends people without widening the boundary', () => {  const path26 = 'services/directus/schema/migrations/20261020_0026_household_roles.sql'
  const down26 =
    'services/directus/schema/migrations/rollback/20261020_0026_household_roles.down.sql'

  it('exists with the next free number and a rollback', () => {
    assert.ok(existsSync(path.join(root, path26)), '0026 exists')
    assert.ok(existsSync(path.join(root, down26)), '0026 rollback exists')
  })

  it('keeps the bootstrap-role boundary', () => {
    // SQL line comments carry the words "role-creation" and "superuser"
    // in prose; strip them so the boundary pin reads the statements.
    const statements = read(path26)
      .split('\n')
      .map((line) => line.split('--')[0])
      .join('\n')
    assert.match(statements, /directus_migrator.*directus_app/)
    assert.doesNotMatch(statements, /CREATE ROLE/i)
    assert.doesNotMatch(statements, /CREATEROLE/i)
    assert.doesNotMatch(statements, /SUPERUSER/i)
  })

  it('adds the column conditionally with the fixed-name CHECK', () => {
    const src = codeOf(path26)
    assert.match(src, /ADD COLUMN IF NOT EXISTS household_role/)
    assert.match(src, /people_household_role_check/)
    assert.match(src, /head_of_household.*spouse.*child.*relative/s)
  })

  it('grants the app the role update and nothing destructive', () => {
    const src = codeOf(path26)
    assert.match(src, /GRANT UPDATE \(household_role\) ON people TO directus_app/)
    assert.doesNotMatch(src, /DELETE FROM people/)
    assert.doesNotMatch(src, /DROP TABLE/)
  })

  it('refuses to roll back roles that exist', () => {
    const down = read(down26)
    assert.match(down, /refusing to roll back household roles/)
    assert.match(down, /restrict_violation/)
  })

  it('is pinned by DB suite 91', () => {
    assert.ok(
      existsSync(path.join(root, 'tests/db/91_household_roles.sql')),
      'suite 91 exists',
    )
    const suite = read('tests/db/91_household_roles.sql')
    assert.match(suite, /91\.1/)
    assert.match(suite, /91\.6/)
    assert.match(suite, /household_head/)
    assert.match(suite, /people_household_role_check/)
  })
})

/**
 * AFC-771 contract tests — hybrid-row upgrade (Option C, user-picked).
 *
 * Covers what lands in-tree this commit: the wizard schema (wedding
 * date, structured address, per-member branch/status/BSC), the submit
 * route (persist + scope 403s + composed legacy address), the shared
 * readback types, and migration 0041 (+ rollback, pinned by suite 99).
 *
 * UI assertions (hybrid new.vue, detail [id].get.ts fields) are NOT
 * pinned here: those two paths are not writable from this workspace
 * (owned by another uid) and travel as AFC-771 issue documents for the
 * CTO courier to apply. The courier extends this file when it lands
 * them. A red pin on an unapplied file would be a bought green, not a
 * earned one.
 *
 * Run: node --test tests/web/household-wizard.contract.mjs
 */
describe('AFC-771 schema: wedding date, structured address, per-member links', () => {
  const schema = read('packages/shared/src/schemas/household-wizard.ts')

  it('carries wedding_date as an optional date', () => {
    assert.match(schema, /wedding_date/)
  })

  it('carries the structured address: parts plus decimal-degree pins', () => {
    for (const field of [
      'address_1',
      'address_2',
      'city',
      'state',
      'zip',
      'country',
      'latitude',
      'longitude',
    ]) {
      assert.ok(schema.includes(field), `wizard names address field ${field}`)
    }
    assert.match(schema, /latitude.*-90.*90/s)
    assert.match(schema, /longitude.*-180.*180/s)
  })

  it('keeps the legacy address readable', () => {
    assert.match(schema, /address: optionalNote\(\)/)
  })

  it('carries optional middle/suffix names on the member', () => {
    assert.match(schema, /middle_name/)
    assert.match(schema, /suffix/)
  })

  it('carries per-member branch, status, and BSC links', () => {
    assert.match(schema, /branch: uuidSchema\.optional\(\)/)
    assert.match(schema, /membership_status/)
    assert.match(schema, /bsc: uuidSchema\.optional\(\)/)
  })

  it('reuses MEMBERSHIP_STATUSES with no new enum values', () => {
    assert.match(schema, /MEMBERSHIP_STATUSES/)
    assert.match(schema, /from '\.\/person'/)
    const person = read('packages/shared/src/schemas/person.ts')
    assert.match(person, /export const MEMBERSHIP_STATUSES/)
    for (const status of [
      'member',
      'regular_attendee',
      'visitor',
      'youth',
      'child',
      'staff',
      'inactive',
    ]) {
      assert.ok(person.includes(`'${status}'`), `person names status ${status}`)
    }
  })
})

describe('AFC-771 route: persist everything, scope every link', () => {
  const src = codeOf('apps/web/server/api/households/wizard.post.ts')

  it('persists wedding_date instead of a hardcoded null', () => {
    assert.match(src, /wedding_date: form\.wedding_date \?\? null/)
    assert.doesNotMatch(src, /wedding_date: null/)
  })

  it('persists the structured address and composes the legacy line', () => {
    assert.match(src, /address_1: structured/)
    assert.match(src, /latitude: structured/)
    assert.match(src, /composeAddress\(form\)/)
    assert.match(src, /hasStructuredAddress\(form\)/)
  })

  it('defaults per-member branch to the household branch, 403 outside', () => {
    assert.match(src, /member\.branch \? resolveBranch\(scope, member\.branch\) : branch/)
  })

  it('keeps the age-band status default and honors an explicit status', () => {
    assert.match(src, /member\.membership_status \?\? statusForAge\(age\)/)
  })

  it('scope-checks the BSC with a fail-closed 403', () => {
    assert.match(src, /resolveBscInScope\(event, scope, member\.bsc\)/)
    assert.match(src, /bsc_out_of_scope/)
    assert.match(src, /bible_study_centres/)
  })

  it('requires the BSC read grant only when a centre is named', () => {
    assert.match(src, /bible_study_centres', 'read'/)
    assert.match(src, /form\.members\.some\(\(member\) => member\.bsc\)/)
  })

  it('maps middle to other_names and suffix onto last_name', () => {
    assert.match(src, /other_names: member\.middle_name/)
    assert.match(src, /member\.suffix/)
  })

  it('keeps the partial-write shape and consent semantics', () => {
    assert.match(src, /wizard_partial_write/)
    assert.match(src, /basis: isMinor \? 'guardian' : 'explicit_opt_in'/)
  })
})

describe('AFC-771 readback types: address parts and member links', () => {
  it('extends the shared Household with the structured address', () => {
    const types = read('packages/shared/src/types.ts')
    for (const field of ['address_1', 'city', 'latitude', 'longitude']) {
      assert.ok(types.includes(field), `Household names ${field}`)
    }
  })

  it('adds bsc to the shared Person', () => {
    const types = read('packages/shared/src/types.ts')
    assert.match(types, /bsc: string \| null/)
  })

  it('adds branch and bsc to the portal member row', () => {
    const portal = read('apps/web/types/portal.ts')
    assert.match(portal, /branch: string \| null/)
    assert.match(portal, /bsc: string \| null/)
  })
})

describe('migration: 0041 adds address + BSC without widening the boundary', () => {
  const path41 = 'services/directus/schema/migrations/20261023_0041_household_address_bsc.sql'
  const down41 =
    'services/directus/schema/migrations/rollback/20261023_0041_household_address_bsc.down.sql'

  it('exists with the next free number and a rollback', () => {
    assert.ok(existsSync(path.join(root, path41)), '0041 exists')
    assert.ok(existsSync(path.join(root, down41)), '0041 rollback exists')
  })

  it('keeps the bootstrap-role boundary', () => {
    const statements = read(path41)
      .split('\n')
      .map((line) => line.split('--')[0])
      .join('\n')
    assert.match(statements, /directus_migrator.*directus_app/)
    assert.doesNotMatch(statements, /CREATE ROLE/i)
    assert.doesNotMatch(statements, /SUPERUSER/i)
  })

  it('adds address columns and the BSC link conditionally', () => {
    const src = codeOf(path41)
    assert.match(src, /ADD COLUMN IF NOT EXISTS address_1/)
    assert.match(src, /ADD COLUMN IF NOT EXISTS latitude/)
    assert.match(src, /households_lat_check/)
    assert.match(src, /households_lng_check/)
    assert.match(src, /ADD COLUMN IF NOT EXISTS bsc/)
    assert.match(src, /people_bsc_fkey/)
  })

  it('backfills address_1 from the legacy line', () => {
    const src = codeOf(path41)
    assert.match(src, /SET address_1 = address/)
  })

  it('grants the app the new writes and nothing destructive', () => {
    const src = codeOf(path41)
    assert.match(src, /GRANT UPDATE \(address_1.*ON households TO directus_app/s)
    assert.match(src, /GRANT UPDATE \(bsc\) ON people TO directus_app/)
    assert.doesNotMatch(src, /DELETE FROM people/)
    assert.doesNotMatch(src, /DROP TABLE/)
  })

  it('refuses to roll back pins and links with no legacy copy', () => {
    const down = read(down41)
    assert.match(down, /refusing to roll back member BSC links/)
    assert.match(down, /refusing to roll back household geo pins/)
    assert.match(down, /restrict_violation/)
  })

  it('is pinned by DB suite 99', () => {
    assert.ok(
      existsSync(path.join(root, 'tests/db/99_household_address_bsc.sql')),
      'suite 99 exists',
    )
    const suite = read('tests/db/99_household_address_bsc.sql')
    assert.match(suite, /99\.1/)
    assert.match(suite, /99\.6/)
    assert.match(suite, /people_bsc_fkey/)
    assert.match(suite, /households_lat_check/)
  })
})
