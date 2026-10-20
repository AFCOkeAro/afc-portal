/**
 * AFC-461b contract tests — single-page profile/dashboard shell with anchors.
 *
 * Pure node:test, no dependencies. Asserts the structural contract:
 *  1. SectionNav: sticky anchor nav, keyboard-operable, aria-current, skip
 *     link, hash deep-links with focus, print CSS.
 *  2. Person profile, dashboard and branch pages render anchored sections
 *     gated by capability (volunteer sees no welfare section; never role
 *     names) with the contract anchors.
 *  3. Drill-down contract: every count links to the filtered list.
 *  4. Branch detail endpoint stays scope-filtered (no cross-branch totals).
 *  5. Zone / area / BSC / household stubs exist behind the same gates.
 *
 * Run: node --test tests/web/profile-shell.contract.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')

/**
 * Mirrors the computed `sections` in the converted pages: a section renders
 * only when the session holds the capability. Role names never appear.
 */
function visibleSections(sections, can) {
  return sections.filter((section) => {
    if (!section.requires) return true
    const [collection, action] = section.requires
    return can(collection, action)
  })
}

/** Mirrors `scrollToHash`: a deep link lands only on a visible section. */
function resolveHashTarget(hash, visibleIds) {
  const id = String(hash ?? '').replace(/^#/, '')
  if (!id) return null
  return visibleIds.includes(id) ? id : null
}

// Grants transcribed from the §10 matrix for the two contract roles. The
// volunteer row holds no welfare grant; the branch admin holds own-branch
// grants only (cross-branch totals come from the scope-filtered API).
const VOLUNTEER_GRANTS = new Set(['branches:read', 'people:read'])
const BRANCH_ADMIN_GRANTS = new Set([
  'branches:read',
  'people:read',
  'welfare_cases:read',
  'attendance_sessions:read',
  'events:read',
  'visitors:read',
  'households:read',
  'departments:read',
])
const canWith = (grants) => (collection, action) => grants.has(`${collection}:${action}`)

const PERSON_SECTIONS = [
  { id: 'overview' },
  { id: 'attendance', requires: ['attendance_sessions', 'read'] },
  { id: 'registrations', requires: ['events', 'read'] },
  { id: 'follow-ups', requires: ['visitors', 'read'] },
  { id: 'welfare-with-scope', requires: ['welfare_cases', 'read'] },
  { id: 'leadership', requires: ['departments', 'read'] },
  { id: 'timeline' },
]

describe('capability gating (volunteer sees no welfare section)', () => {
  it('volunteer: welfare + attendance + follow-ups absent', () => {
    const ids = visibleSections(PERSON_SECTIONS, canWith(VOLUNTEER_GRANTS)).map((s) => s.id)
    assert.ok(ids.includes('overview'))
    assert.ok(ids.includes('timeline'))
    for (const gated of [
      'attendance',
      'registrations',
      'follow-ups',
      'welfare-with-scope',
      'leadership',
    ]) {
      assert.ok(!ids.includes(gated), `volunteer must not see #${gated}`)
    }
  })

  it('branch admin: all person sections visible', () => {
    const ids = visibleSections(PERSON_SECTIONS, canWith(BRANCH_ADMIN_GRANTS)).map(
      (s) => s.id,
    )
    for (const section of PERSON_SECTIONS) {
      assert.ok(ids.includes(section.id), `branch admin must see #${section.id}`)
    }
  })

  it('no role names in the shell or the converted pages', () => {
    for (const file of [
      'apps/web/components/SectionNav.vue',
      'apps/web/pages/people/[id].vue',
      'apps/web/pages/dashboard.vue',
      'apps/web/pages/branches/[id].vue',
    ]) {
      const src = read(file)
      for (const role of ['volunteer', 'branch_admin', 'area_admin', 'super_admin']) {
        assert.ok(
          !src.includes(`'${role}'`) && !src.includes(`"${role}"`),
          `${file} must not name role ${role}`,
        )
      }
    }
  })
})

describe('hash deep links', () => {
  it('visit #follow-ups lands on the section; unknown hashes are ignored', () => {
    assert.equal(resolveHashTarget('#follow-ups', ['overview', 'follow-ups']), 'follow-ups')
    assert.equal(resolveHashTarget('#nope', ['overview', 'follow-ups']), null)
    assert.equal(resolveHashTarget('', ['overview']), null)
  })

  it('a gated section is not a hash target for a session that cannot see it', () => {
    const volunteerIds = visibleSections(PERSON_SECTIONS, canWith(VOLUNTEER_GRANTS)).map(
      (s) => s.id,
    )
    assert.equal(resolveHashTarget('#welfare-with-scope', volunteerIds), null)
    const adminIds = visibleSections(PERSON_SECTIONS, canWith(BRANCH_ADMIN_GRANTS)).map(
      (s) => s.id,
    )
    assert.equal(resolveHashTarget('#welfare-with-scope', adminIds), 'welfare-with-scope')
  })

  it('SectionNav wires route.hash to scroll + focus', () => {
    const src = read('apps/web/components/SectionNav.vue')
    assert.ok(src.includes('route.hash'), 'must react to the Nuxt route hash')
    assert.ok(src.includes('scrollToHash'), 'must scroll on hash')
    assert.ok(src.includes('focus'), 'must move focus to the section heading')
    assert.ok(src.includes('aria-current'), 'active tab must carry aria-current')
  })
})

describe('shell structure', () => {
  it('SectionNav: sticky nav, keyboard-operable, skip link', () => {
    const src = read('apps/web/components/SectionNav.vue')
    assert.ok(src.includes('sticky'), 'tab strip must stay pinned while scrolling')
    assert.ok(src.includes('<nav'), 'must use nav + anchor semantics, not an ARIA tablist')
    assert.ok(!src.includes('role="tablist"'), 'must not use tablist semantics')
    assert.ok(src.includes('Skip to content'), 'must offer a skip link')
  })

  it('print CSS hides the tab strip (US-S3 minimum)', () => {
    const src = read('apps/web/assets/css/main.css')
    assert.ok(src.includes('@media print'), 'must carry the US-S3 print stylesheet')
    assert.ok(src.includes('.section-nav'), 'print must omit the tab strip')
  })

  it('person profile exposes the contract anchors with gates', () => {
    const src = read('apps/web/pages/people/[id].vue')
    for (const anchor of [
      'overview',
      'attendance',
      'registrations',
      'follow-ups',
      'welfare-with-scope',
      'leadership',
      'timeline',
    ]) {
      assert.ok(src.includes(`id="${anchor}"`), `person page must declare #${anchor}`)
    }
    assert.ok(src.includes('SectionNav'), 'person page must render inside the shell')
    assert.ok(
      src.includes("COLLECTIONS.welfareCases, 'read'"),
      'welfare section must gate on welfare_cases:read',
    )
    assert.ok(
      src.includes('v-if="canWelfare"'),
      'gated sections must be absent, not disabled',
    )
  })

  it('dashboard exposes anchored sections with drill-down links', () => {
    const src = read('apps/web/pages/dashboard.vue')
    for (const anchor of ['overview', 'attendance', 'events', 'follow-ups', 'welfare-with-scope']) {
      assert.ok(src.includes(`id="${anchor}"`), `dashboard must declare #${anchor}`)
    }
    for (const link of ['/people', '/events', '/attendance', '/visitors?status=open', '/welfare?status=open']) {
      assert.ok(src.includes(link), `dashboard count must drill into ${link}`)
    }
  })

  it('branch profile gates welfare on capability with branch-filtered drill-downs', () => {
    const src = read('apps/web/pages/branches/[id].vue')
    assert.ok(
      src.includes("COLLECTIONS.welfareCases, 'read'"),
      'branch welfare must gate on welfare_cases:read, not on data length',
    )
    for (const link of [
      '`/people?branch=',
      '`/attendance?branch=',
      '`/events?branch=',
      '`/visitors?status=open&branch=',
      '`/welfare?status=open&branch=',
    ]) {
      assert.ok(src.includes(link), `branch page must link ${link}…`)
    }
  })

  it('list pages honour the drill-down query', () => {
    for (const file of [
      'apps/web/pages/people/index.vue',
      'apps/web/pages/visitors/index.vue',
      'apps/web/pages/welfare/index.vue',
      'apps/web/pages/events/index.vue',
      'apps/web/pages/attendance/index.vue',
    ]) {
      assert.ok(read(file).includes('route.query'), `${file} must seed filters from route.query`)
    }
  })

  it('branch detail endpoint stays scope-filtered (no cross-branch totals)', () => {
    const src = read('apps/web/server/api/branches/[id].get.ts')
    assert.ok(src.includes('findScopedItem'), 'must scope the branch lookup')
    assert.ok(
      src.includes("can(scope, 'welfare_cases', 'read')"),
      'welfare data must stay capability-gated',
    )
  })

  it('zone / area / BSC / household stubs exist behind gates', () => {
    for (const file of [
      'apps/web/pages/zones/[id].vue',
      'apps/web/pages/areas/[id].vue',
      'apps/web/pages/bscs/[id].vue',
      'apps/web/pages/households/[id].vue',
    ]) {
      assert.ok(existsSync(path.join(root, file)), `${file} must exist`)
      const src = read(file)
      assert.ok(src.includes('SectionNav'), `${file} must use the shell`)
      assert.ok(
        src.includes('permissions.can(COLLECTIONS.'),
        `${file} must gate sections on capabilities, never role names`,
      )
    }
    for (const file of [
      'apps/web/pages/zones/[id].vue',
      'apps/web/pages/areas/[id].vue',
      'apps/web/pages/households/[id].vue',
    ]) {
      assert.ok(
        read(file).includes('welfareCases'),
        `${file} must gate welfare on capability`,
      )
    }
  })
})
