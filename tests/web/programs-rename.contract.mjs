/**
 * AFC-845 contract — Events section renamed to Programs.
 *
 * The nav group label reads Programs; the key and routes stay `events`
 * (no URL churn, no grant changes). Page headings already use the
 * programme wording.
 *
 * Run: node --test tests/web/programs-rename.contract.mjs
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

const NAV = 'apps/web/utils/navigation.ts'

describe('AFC-845 programs rename', () => {
  it('the nav group reads Programs on the stable events key', () => {
    const src = codeOf(NAV)
    assert.match(src, /key: 'events', label: 'Programs'/)
    assert.match(src, /to: '\/events'/)
  })
})
