/**
 * AFC-1089 contract — demo seed hardening: fail-closed audit actor,
 * transactional audit, web contract (F1-F3).
 *
 * Follow-up to AFC-1084 (review AFC-1088, ship-with-fixes, non-blocking).
 * Scope: apps/web/server/utils/demo-admin.ts + routes.
 *
 * - F1: audit insert failed open to NULL actor. actorId() returned null for
 *   a non-UUID scope user id and the INSERT still ran with NULL. Now the
 *   util throws fail-closed (demo_actor_invalid) before any SQL runs.
 * - F2: seed/clear + audit row were not atomic. Now script + counts + audit
 *   insert run inside an explicit BEGIN/COMMIT with ROLLBACK on error.
 * - F3: HTTP half unpinned. This file pins it AFC-1077-style:
 *   requireSuperAdmin-first on both routes, the exact DELETE DEMO DATA
 *   phrase, and the audit insert on success.
 *
 * Run: node --test tests/web/demo-admin-1089.contract.mjs
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

const UTIL = 'apps/web/server/utils/demo-admin.ts'
const SEED = 'apps/web/server/api/admin/demo/seed.post.ts'
const CLEAR = 'apps/web/server/api/admin/demo/clear.post.ts'

describe('AFC-1089 F1 fail-closed audit actor', () => {
  it('throws instead of returning null for a non-UUID actor', () => {
    const src = codeOf(UTIL)
    assert.doesNotMatch(src, /string \| null/)
    assert.match(src, /demo_actor_invalid/)
    assert.match(src, /statusCode: 500/)
  })

  it('resolves the actor before opening the pool connection work', () => {
    const src = codeOf(UTIL)
    for (const fn of ['runDemoSeed', 'runDemoClear']) {
      const at = src.indexOf(`export async function ${fn}`)
      assert.ok(at !== -1, `${fn} exists`)
      const body = src.slice(at, at + 400)
      assert.match(body, /actorId\(scopeUserId\)/)
    }
  })

  it('never inserts a NULL actor (no nullable actorId passthrough)', () => {
    const src = codeOf(UTIL)
    assert.doesNotMatch(src, /actorId\(scopeUserId\)\s*\]/)
    assert.match(src, /\[actor, JSON\.stringify/)
  })
})

describe('AFC-1089 F2 transactional seed/clear + audit', () => {
  for (const fn of ['runDemoSeed', 'runDemoClear']) {
    it(`${fn} wraps script + counts + audit in BEGIN/COMMIT with ROLLBACK`, () => {
      const src = codeOf(UTIL)
      const at = src.indexOf(`export async function ${fn}`)
      const next = src.indexOf('export async function', at + 10)
      const body = next === -1 ? src.slice(at) : src.slice(at, next)
      const begin = body.indexOf("'BEGIN'")
      const commit = body.indexOf("'COMMIT'")
      const rollback = body.indexOf("'ROLLBACK'")
      const audit = body.indexOf('demo_admin_actions')
      assert.ok(begin !== -1, `${fn}: BEGIN`)
      assert.ok(commit !== -1, `${fn}: COMMIT`)
      assert.ok(rollback !== -1, `${fn}: ROLLBACK`)
      assert.ok(audit !== -1, `${fn}: audit insert`)
      assert.ok(begin < audit && audit < commit, `${fn}: audit inside the transaction`)
      assert.ok(begin < rollback, `${fn}: rollback after BEGIN`)
    })
  }
})

describe('AFC-1089 F3 web contract (AFC-1077 pattern)', () => {
  it('both routes call requireSuperAdmin(event)', () => {
    for (const rel of [SEED, CLEAR]) {
      const src = codeOf(rel)
      assert.match(src, /requireSuperAdmin\(event\)/)
    }
  })

  it('the gate runs before any demo work on both routes', () => {
    const seedSrc = codeOf(SEED)
    const gate = seedSrc.indexOf('requireSuperAdmin(event)')
    const work = seedSrc.indexOf('runDemoSeed(event')
    assert.ok(gate !== -1 && work !== -1 && gate < work, 'seed: gate precedes runDemoSeed')

    const clearSrc = codeOf(CLEAR)
    const gateC = clearSrc.indexOf('requireSuperAdmin(event)')
    const body = clearSrc.indexOf('readBody(event)')
    const workC = clearSrc.indexOf('runDemoClear(')
    assert.ok(gateC !== -1 && body !== -1 && gateC < body, 'clear: gate precedes readBody')
    assert.ok(gateC < workC, 'clear: gate precedes runDemoClear')
  })

  it('pins the exact DELETE DEMO DATA confirmation phrase', () => {
    const src = codeOf(UTIL)
    assert.match(src, /DELETE DEMO DATA/)
    assert.match(src, /confirmation_required/)
    const clearSrc = codeOf(CLEAR)
    assert.match(clearSrc, /confirmPhrase/)
  })

  it('both actions write a demo_admin_actions audit row on success', () => {
    const src = codeOf(UTIL)
    assert.match(src, /INSERT INTO demo_admin_actions/)
    assert.match(src, /'seed'/)
    assert.match(src, /'clear'/)
  })
})
