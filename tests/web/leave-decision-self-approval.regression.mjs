/**
 * AFC-1067 regression test — a deciding officer cannot decide their own
 * leave request (separation of duties, AFC-1065 F1).
 *
 * Executes the real `apps/web/server/api/leave-requests/[id].patch.ts`
 * handler with stubbed Nuxt auto-imports, portal scope, and Directus access
 * (see `leave-decision-self-approval.hooks.mjs`), so the decision path
 * either writes the asserted patch or the test fails. The static contract
 * suite (`leave-register-cutover.contract.mjs`) is text-match only and
 * cannot observe this behaviour.
 *
 * Run: node --test tests/web/leave-decision-self-approval.regression.mjs
 */
import { describe, it, before } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const dir = path.dirname(fileURLToPath(import.meta.url))
register(pathToFileURL(path.join(dir, 'leave-decision-self-approval.hooks.mjs')))

const REQUESTER = 'requester-1'
const OFFICER = 'officer-2'

function setup({ requester = REQUESTER, actor = OFFICER, status = 'pending', body }) {
  globalThis.__leaveSelfApproval = {
    scope: { session: { user: { id: actor } } },
    row: {
      id: 'leave-1',
      status,
      requester_user: requester,
      start_date: '2026-11-10',
      end_date: '2026-11-12',
    },
    seenPatch: null,
    audits: [],
  }
  globalThis.__leaveDecisionBody = body
}

function state() {
  return globalThis.__leaveSelfApproval
}

// Nuxt server auto-imports, stubbed at the boundary.
globalThis.defineEventHandler = (handler) => handler
globalThis.getRouterParam = () => 'leave-1'
globalThis.readBody = async () => globalThis.__leaveDecisionBody
globalThis.createError = (options) => {
  const failure = new Error(options.statusMessage)
  failure.statusCode = options.statusCode
  failure.data = options.data
  throw failure
}
globalThis.useRuntimeConfig = () => ({})

let handler
before(async () => {
  const route = await import('../../apps/web/server/api/leave-requests/[id].patch.ts')
  handler = route.default
})

describe('leave decision separation of duties (AFC-1067)', () => {
  it('a deciding officer cannot approve their own request', async () => {
    setup({ actor: REQUESTER, body: { status: 'approved' } })
    await assert.rejects(handler({}), (error) => {
      assert.equal(error.statusCode, 403)
      assert.equal(error.data?.code, 'not_own_decision')
      return true
    })
    assert.equal(state().seenPatch, null)
    assert.deepEqual(
      state().audits.filter((row) => row.event_type === 'status_changed'),
      [],
    )
  })

  it('a deciding officer cannot reject their own request', async () => {
    setup({ actor: REQUESTER, body: { status: 'rejected' } })
    await assert.rejects(handler({}), (error) => {
      assert.equal(error.statusCode, 403)
      assert.equal(error.data?.code, 'not_own_decision')
      return true
    })
    assert.equal(state().seenPatch, null)
    assert.deepEqual(
      state().audits.filter((row) => row.event_type === 'status_changed'),
      [],
    )
  })

  it('another deciding officer can still approve', async () => {
    setup({ actor: OFFICER, body: { status: 'approved' } })
    const result = await handler({})
    assert.equal(state().seenPatch.status, 'approved')
    assert.equal(state().seenPatch.decided_by, OFFICER)
    assert.ok(typeof state().seenPatch.decided_at === 'string')
    assert.equal(result.data.status, 'approved')
    const changed = state().audits.filter((row) => row.event_type === 'status_changed')
    assert.equal(changed.length, 1)
    assert.equal(changed[0].actor_user, OFFICER)
  })
})
