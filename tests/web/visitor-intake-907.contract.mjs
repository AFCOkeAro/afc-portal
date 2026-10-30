/**
 * AFC-907 contract — visitor intake extras: user pickers, address,
 * campaign dropdown, source, cross-branch first-visit flag.
 *
 * Run: node --test tests/web/visitor-intake-907.contract.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register(
  pathToFileURL(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      'visitor-intake-resolve-hook.mjs',
    ),
  ),
)

const { VISITOR_SOURCES, visitorFormSchema } =
  await import('../../packages/shared/src/schemas/operations.ts')

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const codeOf = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*/g, '')

describe('intake schema', () => {
  it('declares the source vocabulary matching the 0063 CHECK', () => {
    assert.deepEqual(
      [...VISITOR_SOURCES],
      ['outreach', 'referral', 'social_media', 'event', 'walk_in', 'website', 'other'],
    )
  })

  it('accepts address, campaign, source and still requires names + date', () => {
    const base = {
      visit_date: '2026-10-30',
      visitor_first_name: 'Ada',
      visitor_last_name: 'Okafor',
    }
    assert.equal(
      visitorFormSchema.safeParse({
        ...base,
        address: '12 Allen Avenue, Ikeja',
        campaign: '00000000-0000-4000-8000-000000000000',
        source: 'referral',
      }).success,
      true,
    )
    assert.equal(
      visitorFormSchema.safeParse({ ...base, source: 'pigeon' }).success,
      false,
    )
    assert.equal(visitorFormSchema.safeParse({ visit_date: '2026-10-30' }).success, false)
  })
})

describe('server: users, campaigns, member check', () => {
  it('the users lookup is read-gated, scoped and minimal', () => {
    const src = codeOf('apps/web/server/api/users/lookup.get.ts')
    assert.match(
      src,
      /visitors.*read.*visitors.*create|create.*read/,
      'intake roles only',
    )
    assert.match(src, /directusAdminToken/, 'reads as admin, never caller token')
    assert.match(
      src,
      /fields: 'id,first_name,last_name,email,staff_role,branch'/,
      'exactly the minimal directory fields, nothing secret-adjacent',
    )
    assert.doesNotMatch(src, /requireArea/, 'volunteers can intake')
  })

  it('campaign options are active-only, scoped, id + key + name', () => {
    const src = codeOf('apps/web/server/api/visitors/campaign-options.get.ts')
    assert.match(src, /status.*active/, 'active campaigns only')
    assert.match(src, /'id', 'key', 'name'|"id.*key.*name/, 'minimal fields')
  })

  it('the member check discloses boolean + branch name only', () => {
    const src = codeOf('apps/web/server/utils/member-check.ts')
    assert.match(src, /matchDuplicates/, 'reuses the duplicate matcher')
    assert.match(src, /branchName/, 'only the branch display name leaves')
    assert.doesNotMatch(src, /first_name|last_name/, 'no names are ever read')
    assert.match(src, /fields: 'id,phone,email,branch'/, 'probe reads only match keys')
    const route = codeOf('apps/web/server/api/visitors/member-check.get.ts')
    assert.match(route, /is_cross_branch/, 'boolean plus branch name')
  })

  it('create stamps the flag; update recomputes only on contact/branch moves', () => {
    const post = codeOf('apps/web/server/api/visitors/index.post.ts')
    assert.match(post, /checkCrossBranchVisit/, 'create probes')
    assert.match(post, /is_cross_branch_visit/, 'create stores the stamp')
    assert.doesNotMatch(
      post,
      /body\.is_cross_branch_visit|form\.is_cross_branch/,
      'never client-set',
    )
    const patch = codeOf('apps/web/server/api/visitors/[id].patch.ts')
    assert.match(patch, /'phone' in rawBody/, 'recompute is conditional')
    assert.match(
      patch,
      /is_cross_branch_visit: crossBranch/,
      'stored stamp otherwise stands',
    )
  })
})

describe('intake UI', () => {
  it('Invited by / owner are user pickers with inline person fallback', () => {
    const src = codeOf('apps/web/components/UserPicker.vue')
    assert.match(src, /\/api\/users\/lookup/, 'searches the user list')
    assert.match(src, /\/api\/people/, 'creates a directory person when missing')
    assert.match(src, /allowCreatePerson/, 'person fallback is opt-in per field')
    const modal = codeOf('apps/web/components/VisitorFormModal.vue')
    assert.match(modal, /UserPicker/, 'modal uses the picker twice')
    assert.match(modal, /allow-create-person/, 'invited-by can add a person')
    const patch = codeOf('apps/web/server/api/visitors/[id].patch.ts')
    assert.match(
      patch,
      /validateWelfareOfficer/,
      'owner assignment still gated server-side',
    )
    assert.doesNotMatch(
      modal,
      /<UInput[\s\S]{0,120}?form\.(invited_by|follow_up_owner)/,
      'no free-text user fields',
    )
  })

  it('intake captures address, campaign and source', () => {
    const src = codeOf('apps/web/components/VisitorFormModal.vue')
    assert.match(src, /form\.address/, 'address field')
    assert.match(src, /campaign-options/, 'campaign dropdown')
    assert.match(src, /sourceOptions|form\.source/, 'source dropdown')
  })

  it('cross-branch first visits surface in form, list and detail', () => {
    const modal = codeOf('apps/web/components/VisitorFormModal.vue')
    assert.match(modal, /member-check/, 'intake probes live')
    assert.match(
      modal,
      /Member of another branch visiting for the first time/,
      'warns before save',
    )
    const list = codeOf('apps/web/pages/visitors/index.vue')
    assert.match(list, /Cross-branch visit/, 'list badges the follow-up cell')
    const detail = codeOf('apps/web/pages/visitors/[id].vue')
    assert.match(
      detail,
      /Member of another branch visiting for the first time/,
      'detail banners',
    )
    assert.match(detail, /campaign_name/, 'campaign renders by name')
  })
})
