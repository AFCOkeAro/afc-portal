/**
 * AFC-866 contract tests — Profile + Household pages follow the ChurchCRM sample.
 *
 * Pure node:test, no dependencies. Asserts the structural contract:
 *  1. Household detail follows the Family Profile shape: Family members +
 *     Key people tables in the main column, timeline with member links,
 *     right-rail photo/status/phone + Properties, anchors preserved.
 *  2. Household link-member uses the searchable EntitySelect server-search
 *     path (no manual UInput list), with named failure shapes.
 *  3. New Family editor carries Family Info + Location & Contact + Members
 *     grid with Save / Save-and-add-new.
 *  4. Person profile carries the Notes/Events/System timeline filter plus
 *     the right-rail person summary and Properties, with capability gates
 *     and failure shapes unchanged.
 *
 * Run: node --test tests/web/profile-household-churchcrm.contract.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const codeOf = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')

describe('AFC-866 household detail: Family Profile parity', () => {
  const page = codeOf('apps/web/pages/households/[id].vue')
  const raw = read('apps/web/pages/households/[id].vue')

  it('keeps the shell anchors and capability gates', () => {
    for (const anchor of ['overview', 'members', 'contact']) {
      assert.ok(raw.includes(`id="${anchor}"`), `household page must declare #${anchor}`)
    }
    assert.ok(raw.includes('SectionNav'), 'must use the shell')
    assert.ok(
      page.includes('permissions.can(COLLECTIONS.'),
      'must gate on capabilities, never role names',
    )
    for (const role of ['volunteer', 'branch_admin', 'area_admin', 'super_admin']) {
      assert.ok(
        !raw.includes(`'${role}'`) && !raw.includes(`"${role}"`),
        `must not name role ${role}`,
      )
    }
  })

  it('renders Family members plus a Key people table', () => {
    assert.match(page, /Family members/)
    assert.match(page, /Key people/)
    assert.match(page, /household_role/)
  })

  it('shows a right-rail summary with Properties', () => {
    assert.match(page, /Household summary/)
    assert.match(page, /Properties/)
    assert.match(page, /Wedding date/)
    assert.match(page, /Map pin/)
  })

  it('explains the timeline as member links, inventing no household events', () => {
    assert.match(page, /Timeline/)
    assert.match(page, /lives on the person timelines/)
    assert.match(page, /timeline/)
    assert.doesNotMatch(page, /welfare_cases.*timeline|timeline.*welfare_cases/s)
  })

  it('links members through the searchable EntitySelect server-search path', () => {
    assert.match(page, /<EntitySelect/)
    assert.match(page, /server-search/)
    assert.match(page, /update:search-term/)
    assert.match(page, /onLinkSearchTerm/)
    assert.match(page, /Link member/)
  })

  it('surfaces named link failures instead of a bare message', () => {
    assert.match(page, /fields\?\.person/)
  })
})

describe('AFC-866 family editor: Save / Save-and-add-new', () => {
  const page = codeOf('apps/web/pages/households/new.vue')
  const raw = read('apps/web/pages/households/new.vue')

  it('is staff-only and posts to the wizard route', () => {
    assert.match(page, /middleware: 'staff'/)
    assert.match(page, /\/api\/households\/wizard/)
  })

  it('carries Family Info, Location & Contact, and the Members grid', () => {
    assert.match(page, /Household/)
    assert.match(page, /weddingDate/)
    assert.match(page, /address1/)
    assert.match(page, /latitude/)
    assert.match(page, /Add person/)
  })

  it('offers Save family plus Save and add new', () => {
    assert.match(raw, /Save family/)
    assert.match(raw, /Save and add new/)
    assert.match(page, /saveAndNew/)
    assert.match(page, /resetWizard/)
  })

  it('keeps searchable selects for branch and centre', () => {
    assert.match(page, /EntitySelect/)
    assert.match(page, /bscOptions/)
    assert.match(page, /\/api\/bscs/)
  })

  it('surfaces named field errors per member row', () => {
    assert.match(page, /fieldErrors/)
    assert.match(page, /members\.\$\{index\}\.\$\{field\}/)
  })
})

describe('AFC-866 person profile: timeline filter + right rail', () => {
  const page = codeOf('apps/web/pages/people/[id].vue')
  const raw = read('apps/web/pages/people/[id].vue')

  it('keeps the contract anchors and welfare gate', () => {
    for (const anchor of [
      'overview',
      'attendance',
      'registrations',
      'follow-ups',
      'welfare-with-scope',
      'leadership',
      'timeline',
    ]) {
      assert.ok(raw.includes(`id="${anchor}`), `person page must declare #${anchor}`)
    }
    assert.ok(
      page.includes("COLLECTIONS.welfareCases, 'read'"),
      'welfare section must gate on welfare_cases:read',
    )
    assert.ok(
      page.includes('v-if="canWelfare"'),
      'gated sections must be absent, not disabled',
    )
  })

  it('filters the timeline by Notes / Events / System over existing kinds', () => {
    assert.match(page, /timelineFilter/)
    assert.match(page, /Notes/)
    assert.match(page, /Events/)
    assert.match(page, /System/)
    assert.match(page, /filteredTimeline/)
    assert.match(page, /visitor/)
    assert.match(page, /attendance/)
    assert.match(page, /registration/)
    assert.match(page, /welfare/)
  })

  it('shows a right-rail person summary with Properties', () => {
    assert.match(page, /Person summary/)
    assert.match(page, /Properties/)
    assert.match(page, /Newsletter/)
  })

  it('names no role and keeps the restricted-field messaging', () => {
    for (const role of ['volunteer', 'branch_admin', 'area_admin', 'super_admin']) {
      assert.ok(
        !raw.includes(`'${role}'`) && !raw.includes(`"${role}"`),
        `must not name role ${role}`,
      )
    }
    assert.match(page, /restricted|Restricted/)
  })
})
