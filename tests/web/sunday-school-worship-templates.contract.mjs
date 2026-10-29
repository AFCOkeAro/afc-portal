/**
 * AFC-870 contract tests — worship planner templates + Sunday School class pages.
 *
 * Static gates over the slice (no DB in this suite; the DB suite owns table
 * CHECKs and the app ceiling):
 *
 *   1. Shared catalogue: exactly 10 in-code templates including Christmas
 *      Eve, Communion, Easter, Midweek and Sunday Morning; every item has a
 *      title and a positive duration; serviceType stays inside the §4.3 set
 *      (sunday/midweek/special/camp); the barrel re-exports the module.
 *   2. Sunday School routes: both require the sunday_school_classes read
 *      grant, scope by branch-or-null (area sees all), detail 404s
 *      cross-branch via findScopedItem, students come from the existing
 *      scoped /api/people pool (no enrolment join invented), sessions are
 *      filtered to session_type sunday_school, and the birthday rail carries
 *      month counts only — no DOB, year or age leaves the server.
 *   3. Worship templates page: table with Name/Items/Duration, expandable
 *      items, EntitySelect for branch (no manual IDs), planning reuses POST
 *      /api/services (no new collection, no new privilege, no DELETE).
 *   4. Navigation/capability: Sunday School entry requires the
 *      sunday_school_classes read grant; Worship templates requires the
 *      sunday_services read grant.
 *
 * Stated choice (see route/page headers): templates live in code like
 * task-templates (AFC-668) because staging DDL is frozen — "add template"
 * means planning a service from a template, not a new table.
 *
 * Run: node --test tests/web/sunday-school-worship-templates.contract.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const codeOf = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')

const SHARED = 'packages/shared/src/schemas/service-templates.ts'
const BARREL = 'packages/shared/src/schemas/index.ts'
const LIST_ROUTE = 'apps/web/server/api/sunday-school/index.get.ts'
const DETAIL_ROUTE = 'apps/web/server/api/sunday-school/[id].get.ts'
const LIST_PAGE = 'apps/web/pages/sunday-school/index.vue'
const DETAIL_PAGE = 'apps/web/pages/sunday-school/[id].vue'
const TEMPLATES_PAGE = 'apps/web/pages/services/templates.vue'
const NAV = 'apps/web/utils/navigation.ts'

const REQUIRED_TEMPLATES = [
  'sunday_morning',
  'midweek',
  'communion',
  'easter',
  'christmas_eve',
]

describe('AFC-870 — worship planner templates catalogue', () => {
  it('declares exactly 10 in-code templates including the five named ones', async () => {
    const mod = await import(pathToFileURL(path.join(root, SHARED)).href)
    assert.equal(mod.WORSHIP_TEMPLATES.length, 10, 'ten templates')
    const ids = mod.WORSHIP_TEMPLATES.map((t) => t.id)
    for (const id of REQUIRED_TEMPLATES) {
      assert.ok(ids.includes(id), `template ${id} is declared`)
    }
  })

  it('every item has a title and a positive duration; totals derive', async () => {
    const mod = await import(pathToFileURL(path.join(root, SHARED)).href)
    for (const template of mod.WORSHIP_TEMPLATES) {
      assert.ok(template.name.length > 0, `${template.id} has a name`)
      assert.ok(template.items.length > 0, `${template.id} has items`)
      for (const item of template.items) {
        assert.ok(item.title.length > 0, `${template.id} item has a title`)
        assert.ok(
          Number.isInteger(item.durationMin) && item.durationMin > 0,
          `${template.id} item duration is a positive integer`,
        )
      }
      assert.equal(
        mod.worshipTemplateDuration(template),
        template.items.reduce((sum, item) => sum + item.durationMin, 0),
        `${template.id} duration derives from items`,
      )
      assert.ok(
        mod.worshipTemplateNotes(template).includes(template.name),
        `${template.id} notes carry the template name`,
      )
    }
  })

  it('serviceType stays inside the §4.3 service set', async () => {
    const mod = await import(pathToFileURL(path.join(root, SHARED)).href)
    const allowed = new Set(['sunday', 'midweek', 'special', 'camp'])
    for (const template of mod.WORSHIP_TEMPLATES) {
      assert.ok(allowed.has(template.serviceType), `${template.id} serviceType is §4.3`)
    }
  })

  it('barrel re-exports the module; no template collection is introduced', () => {
    assert.match(read(BARREL), /service-templates/, 'barrel re-exports service-templates')
    const collections = read('packages/shared/src/collections.ts')
    assert.doesNotMatch(collections, /worship/i, 'no worship template collection')
    assert.doesNotMatch(
      collections,
      /service_template/i,
      'no service_template collection',
    )
  })
})

describe('AFC-870 — sunday-school routes reuse scoped helpers', () => {
  it('list route is read-only on sunday_school_classes with branch-or-null scoping', () => {
    const src = codeOf(LIST_ROUTE)
    assert.match(src, /requireCan\(scope,\s*'sunday_school_classes',\s*'read'\)/)
    assert.match(src, /branch.*_null/, 'null-branch (zonal/area) classes stay visible')
    assert.doesNotMatch(
      src,
      /defineEventHandler.*delete|deleteItems|createItem|updateItem/i,
      'no writes on the list route',
    )
  })

  it('detail route 404s cross-branch and reuses people + attendance helpers', () => {
    const src = codeOf(DETAIL_ROUTE)
    assert.match(src, /requireCan\(scope,\s*'sunday_school_classes',\s*'read'\)/)
    assert.match(src, /findScopedItem/, 'cross-branch id is a 404, never a foreign class')
    assert.match(
      src,
      /session_type.*sunday_school/,
      'sessions rail filters to sunday_school',
    )
    assert.match(src, /first_name/, 'teacher/students reuse the people name fields')
    assert.doesNotMatch(
      src,
      /\b(insert|update|delete|upsert)\s*\(/i,
      'no writes on the detail route',
    )
  })

  it('birthday rail carries month counts only — no DOB, year or age', () => {
    const src = read(DETAIL_ROUTE)
    assert.match(src, /birthdaysByMonth/, 'birthday rail exists')
    assert.match(src, /Month counts only/, 'count-only contract is stated')
    const responseShape = src.slice(src.indexOf('birthdaysByMonth'))
    assert.doesNotMatch(
      responseShape,
      /date_of_birth.*return|return.*date_of_birth/,
      'no DOB in the response',
    )
    assert.doesNotMatch(src, /ageFromDob|is_minor/, 'no age or minor flag computed')
  })
})

describe('AFC-870 — pages reuse searchable selects and permission gates', () => {
  it('sunday-school list page: search + EntitySelect + PermissionGate', () => {
    const src = read(LIST_PAGE)
    assert.match(src, /EntitySelect/, 'branch picked from a searchable select')
    assert.match(src, /sundaySchoolClasses.*read/s, 'page gates on the class read grant')
    assert.match(src, /Search classes/, 'search input present')
  })

  it('class detail page: stat cards, students pool, birthdays chart, About/Properties/Events rails', () => {
    const src = read(DETAIL_PAGE)
    for (const heading of [
      'Class at a glance',
      'Students',
      'Birthdays by month',
      'About',
      'Properties',
      'Events',
    ]) {
      assert.match(src, new RegExp(heading), `rail "${heading}" present`)
    }
    assert.match(src, /no class enrolment join/, 'no invented enrolment is stated')
    assert.match(src, /no dates, years, or ages/, 'count-only chart is stated')
    assert.match(src, /api\/people/, 'students reuse the scoped people endpoint')
  })

  it('templates page: Name/Items/Duration table, expandable items, plan-via-POST', () => {
    const src = read(TEMPLATES_PAGE)
    assert.match(src, /Name/, 'Name column')
    assert.match(src, /Items/, 'Items column')
    assert.match(src, /Duration/, 'Duration column')
    assert.match(src, /EntitySelect/, 'branch picked from a searchable select')
    assert.match(src, /\/api\/services/, 'planning reuses POST /api/services')
    assert.match(src, /staging DDL is frozen/, 'in-code choice is stated')
    assert.doesNotMatch(
      codeOf(TEMPLATES_PAGE),
      /delete|remove.*template/i,
      'no template deletion surface',
    )
  })

  it('navigation reveals each surface by capability, not role', () => {
    const src = read(NAV)
    assert.match(
      src,
      /to:\s*'\/sunday-school'[\s\S]{0,200}sunday_school_classes/,
      'Sunday School entry requires the class read grant',
    )
    assert.match(
      src,
      /to:\s*'\/services\/templates'[\s\S]{0,200}sunday_services/,
      'Worship templates entry requires the service read grant',
    )
  })
})
