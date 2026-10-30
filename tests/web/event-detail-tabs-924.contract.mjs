/**
 * AFC-924 contract — event detail tab gating order (TDZ 500 fix).
 *
 * The immediate watcher on `tab` evaluates the computed during setup, so
 * `shownTabs` (and its gate deps) must be declared above `tab`. Anything
 * `tab` touches that is declared below it is a 500 on every event page.
 *
 * Run: node --test tests/web/event-detail-tabs-924.contract.mjs
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

describe('event detail tab order', () => {
  const src = codeOf('apps/web/pages/events/[id].vue')

  it('declares the tab gates before the tab computed', () => {
    const expensesAt = src.indexOf('const canExpenses =')
    const speakersAt = src.indexOf('const canSpeakers =')
    const shownAt = src.indexOf('const shownTabs =')
    const tabAt = src.indexOf('const tab = computed')
    assert.ok(
      expensesAt >= 0 && speakersAt >= 0 && shownAt >= 0 && tabAt >= 0,
      'all four exist',
    )
    assert.ok(expensesAt < tabAt, 'expenses gate above tab')
    assert.ok(speakersAt < tabAt, 'speakers gate above tab')
    assert.ok(shownAt < tabAt, 'shownTabs above tab')
  })

  it('still loads handouts on direct checkin landing', () => {
    assert.match(src, /watch\(\s*tab/, 'watcher on tab exists')
    assert.match(src, /immediate:\s*true/, 'immediate landing preserved')
    assert.match(src, /loadHandouts/, 'checkin prefetch intact')
  })

  it('keeps grant gating on the hidden tabs', () => {
    assert.match(src, /entry\.id !== 'expenses' \|\| canExpenses/, 'expenses stays gated')
    assert.match(src, /entry\.id !== 'speakers' \|\| canSpeakers/, 'speakers stays gated')
  })
})
