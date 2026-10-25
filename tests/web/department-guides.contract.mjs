/**
 * AFC-800 contract tests — department guides (parent AFC-759).
 *
 * Guides are instructional rows owned by one department, ordered by
 * (sort_order, id): migration 0043 least-privilege grants (SELECT +
 * scoped INSERT/UPDATE, no DELETE anywhere), GET/POST/PATCH under
 * /api/departments/:id/guides with scoped reads and the writer gate
 * (departments update grant OR an active leader link), the Guides tab on
 * the department page rendering bodies through the shared XSS-safe
 * renderer, and the no-DELETE retention posture. Suite 43
 * (tests/db/43_department_guides.sql) owns the migration half; this file
 * owns the schema/route/UI half.
 *
 * Run: node --test tests/web/department-guides.contract.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const stripJs = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')
const stripSql = (src) =>
  stripJs(src)
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
const codeOf = (rel) => stripJs(read(rel))
const sqlOf = (rel) => stripSql(read(rel))

const MIGRATION =
  'services/directus/schema/migrations/20261025_0043_department_guides.sql'
const DOWN =
  'services/directus/schema/migrations/rollback/20261025_0043_department_guides.down.sql'
const SCHEMA = 'packages/shared/src/schemas/department.ts'
const MARKDOWN = 'packages/shared/src/markdown.ts'
const GET = 'apps/web/server/api/departments/[id]/guides.get.ts'
const POST = 'apps/web/server/api/departments/[id]/guides.post.ts'
const PATCH = 'apps/web/server/api/departments/[id]/guides/[guideId].patch.ts'
const PAGE = 'apps/web/pages/departments/[id].vue'

describe('department guides — migration ceiling (AFC-800 §A)', () => {
  it('creates the table idempotently with fixed names', () => {
    const src = sqlOf(MIGRATION)
    assert.match(
      src,
      /CREATE TABLE IF NOT EXISTS department_guides/,
      'table is created conditionally',
    )
    assert.match(src, /department_guides_department_fkey/, 'FK carries its fixed name')
    assert.match(
      src,
      /department_guides_title_check/,
      'title CHECK carries its fixed name',
    )
    assert.match(
      src,
      /CREATE INDEX IF NOT EXISTS department_guides_department_sort_idx/,
      'ordering index carries its fixed name',
    )
    assert.match(
      src,
      /ON DELETE RESTRICT/,
      'a department with guides is never deleted by accident',
    )
    assert.match(src, /btrim\(title\)/, 'blank titles are refused, not trimmed silently')
  })

  it('grants SELECT plus scoped INSERT/UPDATE and no DELETE anywhere', () => {
    const src = sqlOf(MIGRATION)
    assert.match(
      src,
      /GRANT SELECT ON department_guides TO directus_app/,
      'the app reads guides',
    )
    assert.match(
      src,
      /GRANT INSERT \(department, title, body, sort_order\)/,
      'INSERT is scoped to the four route-written columns',
    )
    assert.match(
      src,
      /GRANT UPDATE \(title, body, sort_order, updated_at\)/,
      'UPDATE is scoped to the editable columns',
    )
    assert.doesNotMatch(src, /GRANT DELETE/i, 'no DELETE granted')
    assert.doesNotMatch(src, /CREATE ROLE/i, 'no roles provisioned (ADR-0002)')
    assert.match(
      src,
      /REVOKE ALL ON department_guides FROM PUBLIC/,
      'PUBLIC revoked on the table',
    )
  })

  it('the down script refuses while rows exist and drops conditionally', () => {
    const src = sqlOf(DOWN)
    assert.match(
      src,
      /count\(\*\) INTO v_guides FROM department_guides/,
      'the down script counts rows',
    )
    assert.match(src, /restrict_violation/, 'a non-empty rollback fails closed')
    assert.match(
      src,
      /REVOKE ALL ON department_guides FROM directus_app/,
      'down revokes the grants',
    )
    assert.match(
      src,
      /DROP TABLE IF EXISTS department_guides/,
      'down drops the table conditionally',
    )
    assert.doesNotMatch(src, /CASCADE/i, 'no CASCADE: hidden dependents fail loudly')
  })
})

describe('department guides — schemas (AFC-800 §B)', () => {
  it('create validates title/body/sort_order with the named bounds', () => {
    const src = codeOf(SCHEMA)
    assert.match(src, /departmentGuideCreateSchema/, 'create schema exists')
    assert.match(src, /Name the guide/, 'blank titles carry the resubmit message')
    assert.match(src, /\.max\(200\)/, 'titles cap at 200')
    assert.match(src, /\.max\(20000\)/, 'bodies cap at 20000')
    assert.match(src, /\.min\(0\)\.max\(9999\)/, 'sort_order stays in 0..9999')
    assert.match(src, /sort_order: z\.number\(\)\.int\(\)/, 'sort_order is an integer')
  })

  it('patch edits title/body/sort_order only, all optional', () => {
    const src = codeOf(SCHEMA)
    assert.match(src, /departmentGuidePatchSchema/, 'patch schema exists')
    assert.match(src, /title: z\.string\(\).+?\.optional\(\)/, 'patch title is optional')
    assert.match(src, /body: z\.string\(\).+?\.optional\(\)/, 'patch body is optional')
    assert.match(
      src,
      /sort_order: z\.number\(\).+?\.optional\(\)/,
      'patch sort_order is optional',
    )
    const patchBlock = src.slice(src.indexOf('export const departmentGuidePatchSchema'))
    assert.doesNotMatch(
      patchBlock,
      /department[^G]/,
      'no placement field on the patch schema (guides never move departments)',
    )
  })
})

describe('department guides — routes (AFC-800 §B)', () => {
  it('GET reads scoped and ordered with named failures', () => {
    const src = codeOf(GET)
    assert.match(
      src,
      /requireCan\(scope, 'departments', 'read'\)/,
      'list requires the read grant',
    )
    assert.match(
      src,
      /departmentScopeFilter\(scope\)/,
      'the parent loads under the scope filter',
    )
    assert.match(
      src,
      /findScopedItem/,
      'out-of-scope parents are scoped 404s, never foreign rows',
    )
    assert.match(src, /sort_order,id/, 'guides order by (sort_order, id)')
    assert.match(
      src,
      /throwStoreUnavailable/,
      'an unreadable store names the migration, never a bare 500',
    )
    assert.doesNotMatch(src, /statusCode:\s*500/, 'no bare 500 on the list route')
  })

  it('POST gates writers: update grant or active leader link, else 403 forbidden', () => {
    const src = codeOf(POST)
    assert.match(
      src,
      /can\(scope, 'departments', 'update'\)/,
      'editors pass on the departments update grant',
    )
    assert.match(src, /people_departments/, 'the fallback checks the membership junction')
    assert.match(src, /role: \{ _eq: 'leader' \}/, 'the fallback needs the leader role')
    assert.match(src, /status: \{ _eq: 'active' \}/, 'the fallback needs an active link')
    assert.match(
      src,
      /scope\.session\.user\.personId/,
      'the fallback checks the caller, not any leader',
    )
    assert.match(src, /statusCode: 403/, 'non-writers are refused')
    assert.match(src, /code: 'forbidden'/, 'refusal carries the named forbidden code')
    assert.match(src, /throwValidation/, 'bad bodies carry fields')
    assert.match(src, /departmentGuideCreateSchema/, 'the body validates first')
    assert.doesNotMatch(src, /statusCode:\s*500/, 'no bare 500 on the create route')
  })

  it('POST writes the scoped columns onto the parent', () => {
    const src = codeOf(POST)
    assert.match(src, /createItem/, 'create persists through the portal writer')
    assert.match(src, /department: id/, 'the new guide lands on the route parent')
    assert.match(src, /title: form\.title/, 'the route writes the validated title')
    assert.match(src, /body: form\.body/, 'the route writes the validated body')
    assert.match(
      src,
      /sort_order: form\.sort_order/,
      'the route writes the validated order',
    )
  })

  it('PATCH keeps the same gate and scopes the guide to the parent', () => {
    const src = codeOf(PATCH)
    assert.match(
      src,
      /can\(scope, 'departments', 'update'\)/,
      'editors pass on the departments update grant',
    )
    assert.match(src, /people_departments/, 'the fallback checks the membership junction')
    assert.match(src, /role: \{ _eq: 'leader' \}/, 'the fallback needs the leader role')
    assert.match(src, /code: 'forbidden'/, 'refusal carries the named forbidden code')
    assert.match(
      src,
      /department: \{ _eq: id \}/,
      'the guide must belong to the route parent (else 404)',
    )
    assert.match(src, /departmentGuidePatchSchema/, 'the body validates first')
    assert.match(src, /patch\.title/, 'title is editable')
    assert.match(src, /patch\.body/, 'body is editable')
    assert.match(src, /patch\.sort_order/, 'sort_order is editable')
    assert.doesNotMatch(
      src,
      /patch\.department/,
      'placement never moves through the patch',
    )
    assert.doesNotMatch(src, /statusCode:\s*500/, 'no bare 500 on the patch route')
  })

  it('there is no DELETE route and no DELETE grant', () => {
    const apiDir = path.join(root, 'apps/web/server/api/departments/[id]/guides')
    // Only the guides scope: members.delete.ts is the pre-existing
    // status-flip unlink (its own contract), not a guide delete.
    const names = readdirSync(path.join(root, 'apps/web/server/api/departments/[id]'))
      .filter((name) => name.startsWith('guides'))
      .concat(readdirSync(apiDir).map((file) => `guides/${file}`))
    assert.ok(
      names.every((name) => !/delete/i.test(name)),
      `no DELETE route file among: ${names.join(', ')}`,
    )
    assert.doesNotMatch(codeOf(PATCH), /deleteItem/, 'the patch route deletes nothing')
    assert.doesNotMatch(codeOf(POST), /deleteItem/, 'the create route deletes nothing')
    assert.doesNotMatch(
      sqlOf(MIGRATION),
      /GRANT DELETE/i,
      'the migration grants no DELETE',
    )
  })
})

describe('department guides — UI (AFC-800 §C)', () => {
  it('the department page has Members | Guides tabs', () => {
    const src = codeOf(PAGE)
    assert.match(src, /UTabs/, 'tabs render through UTabs')
    assert.match(src, /label: 'Members'/, 'the members tab stays first')
    assert.match(src, /label: 'Guides'/, 'the guides tab is added')
    assert.match(src, /#members/, 'the members panel keeps its content')
    assert.match(src, /#guides/, 'the guides panel renders the list')
  })

  it('the list is ordered and shows when each guide changed', () => {
    const src = codeOf(PAGE)
    assert.match(
      src,
      /\/api\/departments\/\$\{departmentId\}\/guides/,
      'the list reads the new route',
    )
    assert.match(src, /guide\.title/, 'each row names its guide')
    assert.match(src, /guide\.updated_at/, 'each row shows its last change')
  })

  it('bodies render through the shared safe renderer, never raw HTML', () => {
    const src = codeOf(PAGE)
    assert.match(
      src,
      /import \{ COLLECTIONS, renderMarkdownSafe \} from '@afc\/shared'/,
      'the page reuses the shared renderer import (same as minutes/[id].vue)',
    )
    assert.match(
      src,
      /renderMarkdownSafe\(String\(guide\.body/,
      'bodies render through the safe renderer',
    )
    assert.match(
      src,
      /v-html="guideHtml\(guide\)"/,
      'the rendered HTML binds the allowlisted output',
    )
  })

  it('the XSS probe stays neutralised in the shared renderer', () => {
    const src = codeOf(MARKDOWN)
    assert.match(src, /escapeHtml/, 'raw HTML is escaped first')
    assert.match(src, /LINK_SCHEME/, 'link targets are validated against one scheme list')
    assert.match(src, /https\?:/, 'links allow http(s)')
    assert.match(src, /mailto:/, 'links allow mailto')
    assert.doesNotMatch(
      src,
      /javascript:/,
      'no script scheme anywhere (javascript: links die)',
    )
    assert.ok(src.includes('<script>') === false, '<script> is not an emitted tag')
    assert.ok(src.includes('onerror') === false, 'onerror is not an emitted handler')
  })

  it('the editor is visible only to writers, mirroring the API gate', () => {
    const src = codeOf(PAGE)
    assert.match(
      src,
      /permissions\.can\(COLLECTIONS\.departments, 'update'\)/,
      'editors pass on the departments update grant',
    )
    assert.match(
      src,
      /role === 'leader'/,
      'the fallback needs the leader role in the members list',
    )
    assert.match(src, /personId/, 'the fallback matches the signed-in caller')
    assert.match(src, /v-if="canWriteGuides"/, 'the editor renders for writers only')
    assert.match(src, /New guide/, 'the creation entry point is labelled')
    assert.match(
      src,
      /guides\/\$\{editingGuide\.value\.id\}/,
      'edits patch the scoped guide route',
    )
  })

  it('no DELETE control and no synthetic fixtures ship in the page', () => {
    const src = codeOf(PAGE)
    assert.doesNotMatch(
      src,
      /api\.remove\(`\/api\/departments\/\$\{departmentId\}\/guides/,
      'no guide unlink call',
    )
    assert.doesNotMatch(src, /INSERT INTO/i, 'no database rows in the page')
    assert.doesNotMatch(src, /lorem|Lorem|Test Guide \d/, 'no synthetic guide fixtures')
  })
})
