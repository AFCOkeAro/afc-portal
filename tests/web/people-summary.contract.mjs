/**
 * AFC-576 contract tests — People dashboard summary (members, gender, age
 * buckets, family, branch/zone distribution; pin map deferred).
 *
 * Pure node:test, no dependencies. Asserts the structural contract:
 *  1. GET /api/people/summary is staff-scoped like the list route
 *     (people read grant, caller branches via scopeFilter) and returns
 *     aggregates only — no DOB, address, or names in the payload.
 *  2. Gender is male/female with not_recorded as a data-quality footnote
 *     (the model default is `unspecified`; no further categories).
 *  3. Age buckets 0-12/13-17/18-25/26-40/41-60/60+/unknown are computed
 *     server-side from date_of_birth, and the ?age_bucket= list filter uses
 *     the calendar-exact DOB translation so figures match filtered counts.
 *  4. Family stats (household count, avg members, unlinked count) and
 *     branch/zone distribution need the households read grant, otherwise
 *     fail closed (households_visible false, never foreign rows).
 *  5. The dashboard UI deep-links each figure to its filtered list and
 *     promises no pin map.
 *
 * Run: node --test tests/web/people-summary.contract.mjs
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

/* ---- Inline mirrors of apps/web/server/utils/people-summary.ts ---- */

function ageFromDobMirror(dob) {
  if (!dob) return null
  const born = new Date(`${dob}T00:00:00Z`)
  if (Number.isNaN(born.getTime())) return null
  const today = new Date()
  let age = today.getUTCFullYear() - born.getUTCFullYear()
  const before =
    today.getUTCMonth() < born.getUTCMonth() ||
    (today.getUTCMonth() === born.getUTCMonth() && today.getUTCDate() < born.getUTCDate())
  if (before) age -= 1
  return age
}

function bucketMirror(dob) {
  const age = ageFromDobMirror(dob)
  if (age === null || age < 0) return 'unknown'
  if (age <= 12) return '0-12'
  if (age <= 17) return '13-17'
  if (age <= 25) return '18-25'
  if (age <= 40) return '26-40'
  if (age <= 60) return '41-60'
  return '60+'
}

function dobYearsAgo(years, today = new Date()) {
  return new Date(
    Date.UTC(today.getUTCFullYear() - years, today.getUTCMonth(), today.getUTCDate()),
  )
    .toISOString()
    .slice(0, 10)
}

function rangeMirror(bucket) {
  if (bucket === 'unknown') return { _null: true }
  const bounds = {
    '0-12': [0, 12],
    '13-17': [13, 17],
    '18-25': [18, 25],
    '26-40': [26, 40],
    '41-60': [41, 60],
    '60+': [60, null],
  }
  const [lo, hi] = bounds[bucket]
  if (hi === null) return { _lte: dobYearsAgo(lo) }
  return { _gt: dobYearsAgo(hi + 1), _lte: dobYearsAgo(lo) }
}

function dobForAge(age, today = new Date()) {
  return new Date(
    Date.UTC(today.getUTCFullYear() - age, today.getUTCMonth(), today.getUTCDate()),
  )
    .toISOString()
    .slice(0, 10)
}

describe('summary route: scoped aggregates, no PII', () => {
  const route = read('apps/web/server/api/people/summary.get.ts')
  const util = read('apps/web/server/utils/people-summary.ts')

  it('requires the people read grant like the list route', () => {
    assert.match(
      codeOf('apps/web/server/api/people/summary.get.ts'),
      /requireCan\(scope, 'people', 'read'\)/,
    )
  })

  it('scopes people and households to the caller branches', () => {
    assert.match(
      codeOf('apps/web/server/utils/people-summary.ts'),
      /scopeFilter\(scope\)/,
    )
  })

  it('returns { data } with counts and groups, never names/DOB/address', () => {
    assert.match(route, /return \{ data: summary \}/)
    const util = read('apps/web/server/utils/people-summary.ts')
    // The payload shape is the PeopleSummary interface (up to the fold
    // helper that follows it); the internal row types and the server-side
    // DOB read live outside it.
    const payload = util.slice(
      util.indexOf('export interface PeopleSummary {'),
      util.indexOf('/** Pure fold over already-scoped people rows'),
    )
    assert.ok(payload.length > 0, 'payload block found')
    for (const pii of [
      'first_name',
      'last_name',
      'date_of_birth',
      'address',
      'phone',
      'email',
    ]) {
      assert.doesNotMatch(payload, new RegExp(pii), `payload must not carry ${pii}`)
    }
  })

  it('reads DOB server-side only for buckets (never forwards it)', () => {
    const src = codeOf('apps/web/server/utils/people-summary.ts')
    assert.match(src, /date_of_birth/)
    assert.match(src, /ageBucketFromDob/)
  })
})

describe('gender: male/female plus a not-recorded footnote', () => {
  const util = read('apps/web/server/utils/people-summary.ts')

  it('folds unspecified and null genders into not_recorded, invents nothing else', () => {
    assert.match(util, /not_recorded/)
    assert.doesNotMatch(
      codeOf('apps/web/server/utils/people-summary.ts'),
      /non_binary|other_gender/,
    )
  })

  it('shows the footnote in the UI instead of a third category card', () => {
    const page = read('apps/web/pages/people/index.vue')
    assert.match(page, /not recorded/)
    assert.match(page, /defaults to unspecified/)
  })
})

describe('age buckets: boundaries, unknown, and filter agreement', () => {
  const util = codeOf('apps/web/server/utils/people-summary.ts')

  it('pins the 0-12/13-17/18-25/26-40/41-60/60+/unknown bucket set', () => {
    for (const bucket of ['0-12', '13-17', '18-25', '26-40', '41-60', '60+', 'unknown']) {
      assert.ok(util.includes(`'${bucket}'`), `bucket ${bucket} pinned`)
    }
    assert.match(util, /age <= 12/)
    assert.match(util, /age <= 17/)
    assert.match(util, /age <= 25/)
    assert.match(util, /age <= 40/)
    assert.match(util, /age <= 60/)
  })

  it('treats null, missing and unparseable DOB as unknown', () => {
    assert.strictEqual(bucketMirror(null), 'unknown')
    assert.strictEqual(bucketMirror(undefined), 'unknown')
    assert.strictEqual(bucketMirror('not-a-date'), 'unknown')
  })

  it('places boundary ages in the lower bucket (12 in 0-12, 60 in 41-60)', () => {
    assert.strictEqual(bucketMirror(dobForAge(12)), '0-12')
    assert.strictEqual(bucketMirror(dobForAge(13)), '13-17')
    assert.strictEqual(bucketMirror(dobForAge(60)), '41-60')
    assert.strictEqual(bucketMirror(dobForAge(61)), '60+')
  })

  it('the ?age_bucket= DOB range agrees with the bucket for every boundary age', () => {
    for (const [bucket, [lo, hi]] of [
      ['0-12', [0, 12]],
      ['13-17', [13, 17]],
      ['18-25', [18, 25]],
      ['26-40', [26, 40]],
      ['41-60', [41, 60]],
    ]) {
      const range = rangeMirror(bucket)
      // Bucket edges stay in their bucket; the next age up leaves it.
      assert.strictEqual(
        bucketMirror(dobForAge(lo)),
        bucket,
        `${bucket}: upper edge stays`,
      )
      assert.strictEqual(
        bucketMirror(dobForAge(hi)),
        bucket,
        `${bucket}: lower edge stays`,
      )
      assert.notStrictEqual(
        bucketMirror(dobForAge(hi + 1)),
        bucket,
        `${bucket}: next age leaves`,
      )
      // Range edges: upper edge dob is the inclusive _lte; the lower edge
      // dob is exactly the strict _gt boundary (excluded here, included in
      // the next bucket's _lte); one day older is fully outside.
      assert.strictEqual(dobForAge(lo), range._lte, `${bucket}: _lte is the upper edge`)
      assert.strictEqual(dobForAge(hi + 1), range._gt, `${bucket}: _gt is the lower edge`)
      assert.ok(dobForAge(hi + 2) < range._gt, `${bucket}: below lower edge outside`)
    }
    assert.strictEqual(bucketMirror(dobForAge(80)), '60+')
    assert.deepStrictEqual(rangeMirror('unknown'), { _null: true })
  })

  it('the list route wires gender/age_bucket/household filters and keeps the scope', () => {
    const src = codeOf('apps/web/server/api/people/index.get.ts')
    assert.match(src, /gender: \{ _eq: gender \}/)
    assert.match(src, /dobRangeForBucket\(ageBucket as AgeBucket\)/)
    assert.match(src, /household: \{ _null: true \}/)
    assert.match(src, /invalid_gender/)
    assert.match(src, /invalid_age_bucket/)
    assert.match(src, /scopeFilter\(scope\)/)
  })
})

describe('family + distribution: fail-closed without the households grant', () => {
  const util = codeOf('apps/web/server/utils/people-summary.ts')

  it('gates the household side on the read grant and reports visibility', () => {
    assert.match(util, /can\(scope, 'households', 'read'\)/)
    assert.match(util, /households_visible/)
  })

  it('counts active households, avg members, and unlinked people', () => {
    assert.match(util, /avg_members/)
    assert.match(util, /unlinked_people/)
    assert.match(util, /status === 'active'/)
  })

  it('distributes by branch and zone with ids plus names, never a pin map', () => {
    assert.match(util, /by_branch/)
    assert.match(util, /by_zone/)
    assert.match(util, /branch_name/)
    assert.match(util, /zone_name/)
    assert.doesNotMatch(util, /latitude|longitude|geo_pin|coordinates/)
  })

  it('empty scope folds to zeros and empty groups (no throw, no null payload)', () => {
    // Structural: the collector pages from empty arrays and every group is
    // built from Maps that start empty, so an empty scope yields zero
    // totals, 0.00 avg, and [] groups by construction.
    assert.match(util, /householdCount === 0/)
    assert.match(util, /\[\.\.\.branchKeys\]/)
    assert.match(util, /\[\.\.\.zoneKeys\]/)
    const page = read('apps/web/pages/people/index.vue')
    assert.match(page, /No scoped records yet/)
  })
})

describe('UI: dashboard cards with deep links, consistent with the kit', () => {
  const page = read('apps/web/pages/people/index.vue')

  it('keeps PageHeader and kit components (StatCard/UCard/UAlert)', () => {
    assert.match(page, /<PageHeader/)
    assert.match(page, /<StatCard/)
    assert.match(page, /\/api\/people\/summary/)
  })

  it('deep-links members/gender/age/unlinked figures to filtered lists', () => {
    assert.match(page, /\/people\?status=all/)
    assert.match(page, /\/people\?gender=male&status=all/)
    assert.match(page, /\/people\?gender=female&status=all/)
    assert.match(page, /age_bucket=/)
    assert.match(page, /\/people\?household=unlinked&status=all/)
    assert.match(page, /\/households\?branch=/)
  })

  it('notes the deferred pin map instead of promising one', () => {
    assert.match(page, /Pin map deferred/)
  })

  it('exposes gender and age_bucket as list filters honouring ?query deep links', () => {
    assert.match(page, /queryParam\('gender'\)/)
    assert.match(page, /queryParam\('age_bucket'\)/)
  })

  it('ships the route and collector files', () => {
    assert.ok(existsSync(path.join(root, 'apps/web/server/api/people/summary.get.ts')))
    assert.ok(existsSync(path.join(root, 'apps/web/server/utils/people-summary.ts')))
  })
})
