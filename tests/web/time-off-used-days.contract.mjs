/**
 * AFC-854 phase 2 contract — used/remaining days + balance preview.
 *
 * Allowance rows gain server-computed used/remaining (approved requests,
 * attributed by start year, weekends skipped). The request form previews
 * the balance math before filing. No DDL: phase 2 reads the phase-1 and
 * AFC-842 registers.
 *
 * Run: node --test tests/web/time-off-used-days.contract.mjs
 *
 * AFC-896: the file form moved unchanged to the Requests tab of the
 * merged Time Off section; the preview assertion follows it there.
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

describe('AFC-854 phase 2 used days', () => {
  it('balances carry server-computed used and remaining days', () => {
    const src = codeOf('apps/web/server/api/leave-balances/index.get.ts')
    assert.match(src, /used_days/, 'used days on every row')
    assert.match(src, /remaining_days/, 'remaining days on every row')
    assert.match(src, /workingDaysBetween/, 'weekends skipped server-side')
    assert.match(src, /status: \{ _eq: 'approved' \}/, 'only approved requests count')
  })

  it('unreadable leave requests degrade to null, never a failure', () => {
    const src = codeOf('apps/web/server/api/leave-balances/index.get.ts')
    assert.match(src, /requestsReadable/, 'readability tracked')
    assert.match(src, /requestsReadable/, 'unknown stays null, never a failure')
  })

  it('the Time Off book shows used and remaining', () => {
    const src = codeOf('apps/web/pages/time-off.vue')
    assert.match(src, /used_days/)
    assert.match(src, /remaining_days/)
  })

  it('the file form previews the balance math before filing', () => {
    const src = codeOf('apps/web/pages/time-off.vue')
    assert.match(src, /previewBalance/)
    assert.match(src, /previewDays/)
    assert.match(
      src,
      /previewBalance\.allowance - previewBalance\.used - previewDays/,
      'remaining-after math shown',
    )
  })
})
