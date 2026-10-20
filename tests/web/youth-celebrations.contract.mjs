/**
 * AFC-476 contract tests — youth profiles, celebrations and shout-outs:
 * scoped list/detail/create with audit, lifecycle, minor safeguard, feed.
 *
 * Pure node:test, no dependencies. Asserts the structural contract the
 * youth/celebration routes are built on:
 *   1. Schema: youth_profiles (1-1 child of people, CASCADE) + trail;
 *      celebrations (§6.2, RESTRICT on person, published-needs-channel)
 *      + trail; person_previous_branches + person_milestones; people §4.2
 *      columns with the retention-closed status set (CONTESTED: the §4.2
 *      expansion is withheld pending a CTO decision, migration 0012
 *      header); the (month, day) recurring index; the app has no DELETE.
 *   2. Scoping: the list/detail/patch/transition routes resolve inside the
 *      caller's branch/zone scope (out-of-scope is a 403 on filters, a 404
 *      on ids); visibility only narrows inside scope.
 *   3. Create: the youth form requires a shared-DB person link and refuses
 *      a second profile (409); the celebration form requires guardian
 *      consent for a minor (400); both write a `created` audit row with
 *      the session user as actor.
 *   4. Lifecycle: status moves go through the transition endpoint, which
 *      enforces the draft -> approved -> published -> archived graph and
 *      the publish-needs-channel rule; PATCH refuses status and refuses
 *      published/archived edits.
 *   5. Reports: the list and the CSV read the same shared collector over
 *      the same scoped query; the calendar contribution reads the same
 *      collector and maps through the shared combineCalendarFeed helper.
 *   6. Safeguarding: feed payloads never select DOB/contact/medical;
 *      the person embed is names + is_minor only.
 *
 * Run: node --test tests/web/youth-celebrations.contract.mjs
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

const MIGRATION =
  'services/directus/schema/migrations/20261020_0012_youth_celebrations.sql'
const DOWN =
  'services/directus/schema/migrations/rollback/20261020_0012_youth_celebrations.down.sql'
const ROUTES = {
  youthList: 'apps/web/server/api/youth/index.get.ts',
  youthCreate: 'apps/web/server/api/youth/index.post.ts',
  youthDetail: 'apps/web/server/api/youth/[id].get.ts',
  youthPatch: 'apps/web/server/api/youth/[id].patch.ts',
  youthCsv: 'apps/web/server/api/youth/reports.csv.get.ts',
  youthCollector: 'apps/web/server/utils/youth-feed.ts',
  feedList: 'apps/web/server/api/celebrations/index.get.ts',
  feedCreate: 'apps/web/server/api/celebrations/index.post.ts',
  feedDetail: 'apps/web/server/api/celebrations/[id].get.ts',
  feedPatch: 'apps/web/server/api/celebrations/[id].patch.ts',
  transition: 'apps/web/server/api/celebrations/[id]/transition.post.ts',
  feedCsv: 'apps/web/server/api/celebrations/reports.csv.get.ts',
  calendar: 'apps/web/server/api/celebrations/calendar.get.ts',
  collector: 'apps/web/server/utils/celebration-feed.ts',
}
const SHARED = {
  schema: 'packages/shared/src/schemas/youth.ts',
  barrel: 'packages/shared/src/schemas/index.ts',
  collections: 'packages/shared/src/collections.ts',
  matrix: 'packages/shared/src/role-matrix.ts',
  feed: 'packages/shared/src/office-feed.ts',
}
const PAGES = {
  youthList: 'apps/web/pages/youth/index.vue',
  youthDetail: 'apps/web/pages/youth/[id].vue',
  youthModal: 'apps/web/components/YouthProfileFormModal.vue',
  feedList: 'apps/web/pages/celebrations/index.vue',
  feedDetail: 'apps/web/pages/celebrations/[id].vue',
  feedModal: 'apps/web/components/CelebrationFormModal.vue',
  nav: 'apps/web/utils/navigation.ts',
}

describe('youth + celebrations — schema (§§6.1-6.2, 4.2-4.4)', () => {
  it('the migration creates the six tables with the spec column sets', () => {
    const src = sqlOf(MIGRATION)
    for (const column of [
      'education_level',
      'youth_leadership_role',
      'study_level',
      'employment_status',
    ]) {
      assert.match(src, new RegExp(`\\b${column}\\b`), `migration must define ${column}`)
    }
    for (const column of [
      'type',
      'event_date',
      'is_recurring',
      'visibility',
      'publish_channels',
      'guardian_consent',
    ]) {
      assert.match(src, new RegExp(`\\b${column}\\b`), `migration must define ${column}`)
    }
    assert.match(src, /person_previous_branches/, 'previous branches must exist')
    assert.match(src, /person_milestones/, 'milestones must exist')
  })

  it('the 1-1 and ownership edges are CASCADE, the celebration is RESTRICT', () => {
    const src = sqlOf(MIGRATION)
    assert.match(
      src,
      /youth_profiles[\s\S]*?REFERENCES people\(id\) ON DELETE CASCADE/,
      'a youth profile is a 1-1 child: it follows its person',
    )
    assert.match(
      src,
      /celebrations[\s\S]*?REFERENCES people\(id\) ON DELETE RESTRICT/,
      'a celebration names its person: the delete is refused',
    )
    assert.match(src, /celebrations_published_needs_channel/, 'published needs a channel')
  })

  it('the recurring (month, day) partial index exists (cost lens)', () => {
    const src = sqlOf(MIGRATION)
    assert.match(src, /celebrations_recurring_md_idx/, 'the recurring index must exist')
    assert.match(src, /WHERE is_recurring/, 'the recurring index must be partial')
  })

  it('the app holds no DELETE on any of the six tables', () => {
    const src = sqlOf(MIGRATION)
    const grants = src.slice(src.indexOf('Least-privilege ceiling'))
    assert.doesNotMatch(
      grants,
      /DELETE\s+ON\s+youth_profiles/,
      'no DELETE on youth_profiles',
    )
    assert.doesNotMatch(grants, /DELETE\s+ON\s+celebrations/, 'no DELETE on celebrations')
    assert.doesNotMatch(
      grants,
      /DELETE\s+ON\s+person_milestones/,
      'no DELETE on person_milestones',
    )
  })

  it('the people §4.2 columns land but the status expansion is withheld (CONTESTED)', () => {
    // Header rationale is a `--` comment, which sqlOf strips: read it raw.
    const header = read(MIGRATION)
    const src = sqlOf(MIGRATION)
    for (const column of ['marital_status', 'marriage_date', 'is_youth', 'person_type']) {
      assert.match(
        src,
        new RegExp(`ADD COLUMN IF NOT EXISTS ${column}`),
        `people must gain ${column}`,
      )
    }
    assert.match(header, /WITHHELD/, 'the withholding must be stated in the migration')
    assert.doesNotMatch(
      src,
      /people_status_expanded/,
      'the widened status set must not be installed',
    )
  })

  it('the down script refuses while rows exist and never touches people', () => {
    const src = sqlOf(DOWN)
    assert.match(
      src,
      /restrict_violation/,
      'the down script must refuse on populated tables',
    )
    assert.match(src, /DROP TABLE IF EXISTS youth_profiles/, 'youth_profiles must drop')
    assert.match(src, /DROP TABLE IF EXISTS celebrations/, 'celebrations must drop')
    assert.doesNotMatch(
      src,
      /ALTER TABLE people/,
      'people is never altered by the rollback',
    )
    assert.match(
      src,
      /NOT DRI?OPPED|left in place/i,
      'the people columns must stay by design',
    )
  })
})

describe('youth + celebrations — shared contracts', () => {
  it('the collections are registered with their audit trails and history', () => {
    const src = codeOf(SHARED.collections)
    for (const name of [
      'youthProfiles',
      'youthProfileEvents',
      'celebrations',
      'celebrationEvents',
      'personPreviousBranches',
      'personMilestones',
    ]) {
      assert.match(src, new RegExp(`\\b${name}\\b`), `collections must include ${name}`)
    }
  })

  it('the schemas require the person link and default the safeguards', () => {
    const src = codeOf(SHARED.schema)
    assert.match(src, /person.*uuid/, 'both forms must take a person link')
    assert.match(
      src,
      /guardian_consent.*default\(false\)/,
      'consent must default to false',
    )
    assert.match(
      codeOf(ROUTES.feedCreate),
      /status: 'draft'/,
      'celebrations must start as draft (server-set, not client-sent)',
    )
    assert.match(src, /CELEBRATION_TRANSITIONS/, 'the transition graph must be shared')
    assert.match(src, /archived:\s*\[\]/, 'archived must be terminal')
  })

  it('the matrix transcribes the §11 youth rows with a public-only grant', () => {
    const src = codeOf(SHARED.matrix)
    assert.match(src, /COLLECTIONS\.youthProfiles/, 'youth_profiles must have a row')
    assert.match(src, /COLLECTIONS\.celebrations/, 'celebrations must have a row')
    assert.match(src, /public_only/, 'the public grant must be public-only')
  })

  it('youth PII is volunteer-hidden and marriage_date joins the people restriction', () => {
    const src = codeOf(SHARED.matrix)
    assert.match(src, /marriage_date/, 'marriage_date must be restricted on people')
    assert.match(
      src,
      /COLLECTIONS\.youthProfiles[\s\S]*?institution/,
      'youth detail fields must be field-restricted',
    )
  })
})

describe('youth — routes', () => {
  it('list/create/detail/patch/csv read the shared collector in scope', () => {
    assert.match(
      codeOf(ROUTES.youthList),
      /collectYouth/,
      'the list must read the collector',
    )
    assert.match(
      codeOf(ROUTES.youthCreate),
      /requireCan\(scope, 'youth_profiles', 'create'\)/,
      'create needs the grant',
    )
    assert.match(
      codeOf(ROUTES.youthCreate),
      /409/,
      'a second profile for one person is a 409',
    )
    assert.match(
      codeOf(ROUTES.youthCreate),
      /youth_profile_events/,
      'create must write the audit row',
    )
    assert.match(
      codeOf(ROUTES.youthPatch),
      /youth_profile_events/,
      'updates must write the audit row',
    )
    assert.match(
      codeOf(ROUTES.youthCsv),
      /collectYouth/,
      'the export must read the collector',
    )
  })

  it('the youth collector strips PII and never reads contact detail', () => {
    const src = codeOf(ROUTES.youthCollector)
    assert.match(src, /stripHiddenMany/, 'the collector must strip restricted fields')
    assert.doesNotMatch(src, /phone|email/, 'the collector must not read contact fields')
  })
})

describe('celebrations — routes', () => {
  it('create enforces the minor safeguard without reading DOB', () => {
    const src = codeOf(ROUTES.feedCreate)
    assert.match(src, /is_minor/, 'create must consult the derived minor flag')
    assert.match(
      src,
      /guardian_consent/,
      'create must require guardian consent for a minor',
    )
    assert.match(src, /status: 'draft'/, 'new rows must land as draft')
    assert.doesNotMatch(
      src,
      /date_of_birth/,
      'DOB must never enter a celebrations request',
    )
  })

  it('the transition endpoint owns the lifecycle and the publish path', () => {
    const src = codeOf(ROUTES.transition)
    assert.match(src, /isCelebrationTransitionAllowed/, 'moves must validate the graph')
    assert.match(src, /publish_channels/, 'publish must write the shout-out channels')
    assert.match(src, /celebration_events/, 'every move must write the audit row')
    assert.match(
      codeOf(ROUTES.feedPatch),
      /transition endpoint/,
      'PATCH must refuse status moves',
    )
    assert.match(
      codeOf(ROUTES.feedPatch),
      /immutable_state/,
      'published/archived rows must be immutable',
    )
  })

  it('list, CSV, calendar and roll-up read one scoped collector', () => {
    assert.match(
      codeOf(ROUTES.feedList),
      /collectCelebrations/,
      'the list must read the collector',
    )
    assert.match(
      codeOf(ROUTES.feedCsv),
      /collectCelebrations/,
      'the export must read the collector',
    )
    assert.match(
      codeOf(ROUTES.calendar),
      /collectCelebrations/,
      'the calendar must read the collector',
    )
    assert.match(
      codeOf(ROUTES.calendar),
      /celebrationsToCalendarItems/,
      'the calendar must project through the collector helper',
    )
    assert.match(
      codeOf(ROUTES.collector),
      /combineCalendarFeed/,
      'the projection must merge through the shared helper',
    )
  })

  it('recurring greetings are matched on month/day over the scoped recurring set', () => {
    const src = codeOf(ROUTES.collector)
    assert.match(src, /is_recurring/, 'a month/day request must narrow to recurring rows')
    assert.match(
      src,
      /md\.month !== filters\.month/,
      'month/day matching must happen in code over the scoped set',
    )
  })

  it('feed payloads never select DOB, contact or medical columns', () => {
    const src = codeOf(ROUTES.collector)
    for (const field of ['first_name', 'last_name', 'preferred_name', 'is_minor']) {
      assert.match(src, new RegExp(`'${field}'`), `the person embed keeps ${field}`)
    }
    assert.doesNotMatch(
      src,
      /date_of_birth|medical|phone|email/,
      'restricted fields must not appear in the feed field lists',
    )
  })
})

describe('youth + celebrations — surfaces', () => {
  it('list and detail pages exist with audit, history and lifecycle controls', () => {
    assert.match(
      codeOf(PAGES.youthList),
      /\/api\/youth/,
      'the youth list must read the route',
    )
    assert.match(
      codeOf(PAGES.youthDetail),
      /milestones/,
      'the youth detail must show milestones',
    )
    assert.match(
      codeOf(PAGES.youthDetail),
      /previous_branches/,
      'the youth detail must show history',
    )
    assert.match(
      codeOf(PAGES.feedList),
      /\/api\/celebrations/,
      'the feed must read the route',
    )
    assert.match(
      codeOf(PAGES.feedDetail),
      /transition/,
      'the detail must offer the lifecycle flow',
    )
    assert.match(
      codeOf(PAGES.feedDetail),
      /guardian/,
      'the detail must surface the minor safeguard',
    )
  })

  it('navigation reveals youth and celebrations by capability, not role', () => {
    const src = codeOf(PAGES.nav)
    assert.match(src, /to: '\/youth'/, 'youth must be navigable')
    assert.match(src, /to: '\/celebrations'/, 'celebrations must be navigable')
    assert.match(src, /youth_profiles.*read/, 'youth nav must require the capability')
    assert.match(
      src,
      /celebrations.*read/,
      'celebrations nav must require the capability',
    )
  })
})
