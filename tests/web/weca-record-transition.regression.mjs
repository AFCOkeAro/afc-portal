/**
 * AFC-501 regression test — finance record lifecycle transition path.
 *
 * The contract suite pins the transition shape statically; it did not catch
 * an unbound `status` shorthand in the records PATCH route (ReferenceError
 * on every draft→submitted→confirmed transition). This test executes the
 * real handler with stubbed Nuxt auto-imports, portal scope, and Directus
 * access, so the transition path either writes the asserted patch or the
 * test fails.
 *
 * Run: node --test tests/web/weca-record-transition.regression.mjs
 */
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const dir = path.dirname(fileURLToPath(import.meta.url))
register(pathToFileURL(path.join(dir, 'weca-record-transition.hooks.mjs')))

const SCOPE = { session: { user: { id: 'actor-7' } } }

function setup({ current, body }) {
  globalThis.__wecaRecordTransition = {
    scope: SCOPE,
    existing: { id: 'rec-1', status: current },
    body,
    seenPatch: null,
  }
}

function seenPatch() {
  return globalThis.__wecaRecordTransition.seenPatch
}

// Nuxt server auto-imports, stubbed at the boundary.
globalThis.defineEventHandler = (handler) => handler
globalThis.getRouterParam = () => 'rec-1'
globalThis.readBody = async () => globalThis.__wecaRecordTransition.body
globalThis.createError = (options) => {
  const failure = new Error(options.statusMessage)
  failure.statusCode = options.statusCode
  failure.data = options.data
  throw failure
}

let handler
before(async () => {
  const route = await import(
    '../../apps/web/server/api/finance/records/[id].patch.ts'
  )
  handler = route.default
})

describe('record transition path (AFC-501 regression)', () => {
  it('draft submits with the next status and the submitting actor', async () => {
    setup({ current: 'draft', body: { status: 'submitted' } })
    const result = await handler({})
    assert.equal(seenPatch().status, 'submitted')
    assert.equal(seenPatch().submitted_by, 'actor-7')
    assert.ok(typeof seenPatch().updated_at === 'string')
    assert.equal(result.data.id, 'rec-1')
    assert.equal(result.data.status, 'submitted')
  })

  it('submitted confirms with the next status and the confirming actor', async () => {
    setup({ current: 'submitted', body: { status: 'confirmed' } })
    const result = await handler({})
    assert.equal(seenPatch().status, 'confirmed')
    assert.equal(seenPatch().confirmed_by, 'actor-7')
    assert.equal(result.data.status, 'confirmed')
  })

  it('a skipped step is refused, never written', async () => {
    setup({ current: 'draft', body: { status: 'confirmed' } })
    await assert.rejects(handler({}), (error) => {
      assert.equal(error.statusCode, 409)
      assert.equal(error.data?.code, 'invalid_transition')
      return true
    })
    assert.equal(seenPatch(), null)
  })
})
