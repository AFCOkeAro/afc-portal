/**
 * AFC-830 contract — payments hidden unless the event opts in.
 *
 * Charging is opt-in per event (events.payments_enabled, default off).
 * The programme-settings fee/currency, the dashboard payment breakdown
 * and the registration-manage payment fields render only when the flag
 * is on for that event.
 *
 * Run: node --test tests/web/event-payments.contract.mjs
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

const MIGRATION =
  'services/directus/schema/migrations/20261028_0046_event_payments_flag.sql'
const DOWN =
  'services/directus/schema/migrations/rollback/20261028_0046_event_payments_flag.down.sql'

describe('AFC-830 payments flag', () => {
  it('adds an opt-in, default-off switch on events', () => {
    const src = codeOf(MIGRATION)
    assert.match(
      src,
      /ADD COLUMN IF NOT EXISTS payments_enabled boolean NOT NULL DEFAULT false/,
    )
    assert.match(src, /No new grants/, 'inherits the table ceiling')
  })

  it('rolls back only when no event charges', () => {
    const src = codeOf(DOWN)
    assert.match(src, /WHERE payments_enabled/)
    assert.match(src, /DROP COLUMN IF EXISTS payments_enabled/)
  })

  it('the settings form gates fee and currency behind the switch', () => {
    const src = codeOf('apps/web/components/EventFormModal.vue')
    assert.match(src, /Accept payments for this event/)
    assert.match(src, /v-if="form\.payments_enabled"/)
  })

  it('the dashboard breakdown and manage modal follow the event flag', () => {
    const page = codeOf('apps/web/pages/events/[id].vue')
    assert.match(page, /event\.payments_enabled/, 'detail gates the breakdown')
    assert.match(
      page,
      /:payments-enabled="event\.payments_enabled"/,
      'flag reaches the manage modal',
    )
    const modal = codeOf('apps/web/components/RegistrationManageModal.vue')
    assert.match(
      modal,
      /v-if="props\.paymentsEnabled"/,
      'manage modal hides payment fields',
    )
  })
})
