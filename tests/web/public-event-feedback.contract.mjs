/**
 * AFC-828 phase 2 contract — fan feedback (public submit, staff list).
 *
 * Submissions ride the public token through a proxy that re-checks
 * visibility + published status and projects onto the submission keys.
 * The public never lists feedback; scoped staff read it on Reports.
 *
 * Run: node --test tests/web/public-event-feedback.contract.mjs
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
const sqlOf = (rel) => codeOf(rel).replace(/--[^\n]*/g, '')

const MIGRATION = 'services/directus/schema/migrations/20261028_0056_event_feedback.sql'
const DOWN =
  'services/directus/schema/migrations/rollback/20261028_0056_event_feedback.down.sql'

describe('AFC-828 phase 2 feedback register', () => {
  it('creates the submissions table with a closed rating set', () => {
    const src = sqlOf(MIGRATION)
    assert.match(src, /CREATE TABLE IF NOT EXISTS event_feedback/)
    assert.match(src, /rating IS NULL OR \(rating >= 1 AND rating <= 5\)/)
    assert.match(src, /message/)
  })

  it('grants the submission verbs and revokes PUBLIC', () => {
    const src = sqlOf(MIGRATION)
    assert.match(src, /GRANT SELECT ON event_feedback TO directus_app/)
    assert.match(
      src,
      /GRANT INSERT \(event, branch, zone, name, message, rating, contact\)/,
    )
    assert.match(src, /GRANT DELETE ON event_feedback TO directus_app/)
    assert.match(src, /REVOKE ALL ON event_feedback FROM PUBLIC/)
  })

  it('the rollback refuses with rows and drops the table when empty', () => {
    const src = sqlOf(DOWN)
    assert.match(src, /refusing to roll back event feedback/)
    assert.match(src, /DROP TABLE IF EXISTS event_feedback/)
  })
})

describe('AFC-828 phase 2 feedback surface', () => {
  it('the public route re-checks visibility and projects the body', () => {
    const src = codeOf('apps/web/server/api/public/events/[id]/feedback.post.ts')
    assert.match(src, /directusPublicToken/)
    assert.match(src, /visibility: \{ _eq: 'public' \}/)
    assert.match(src, /SUBMISSION_KEYS/)
    assert.doesNotMatch(
      src,
      /getPortalScope|requireSession/,
      'no session on the public path',
    )
  })

  it('the staff list is scoped and the public page submits', () => {
    const src = codeOf('apps/web/server/api/events/[id]/feedback.get.ts')
    assert.match(src, /findScopedItem/)
    assert.match(src, /scopeFilter/)
    const page = codeOf('apps/web/pages/p/[id].vue')
    assert.match(page, /submitFeedback/)
    assert.match(page, /Thank you/)
  })

  it('the Reports Feedback branch renders the list, not the placeholder', () => {
    const src = codeOf('apps/web/pages/events/[id].vue')
    assert.match(src, /v-else-if="reportSubtab === 'Feedback'"/)
    assert.match(src, /<FeedbackList :event-id="id" \/>/)
  })
})
