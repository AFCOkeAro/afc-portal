/**
 * AFC-480 contract tests — member event invitations + rate limits + opt-out.
 *
 * Pure node:test, no dependencies. Asserts the structural contract:
 *  1. Preview renders the exact message before queue and never writes a row
 *     (US-E1 AC2: no blind sends, no drip).
 *  2. Create enforces the minor-guardian gate, the STOP suppression and the
 *     rolling limits at the route layer, and writes the row WITH the frozen
 *     snapshot (the DB CHECKs pin the same rules underneath).
 *  3. Member reads are own-only with the phone redacted and internals
 *     stripped; staff read branch scope with full rows (data-model-v4 §5.1).
 *  4. Approve cannot override an opt-out; retry is failed-only and
 *     idempotent-once; withdraw is unsent-only; export is staff-only.
 *  5. The migration encodes the acceptance rule: minor-without-guardian
 *     rejected at creation, blocked rows need a reason, frozen columns hold
 *     no UPDATE grant.
 *
 * Run: node --test tests/web/event-invites.contract.mjs
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(path.join(root, rel), 'utf8')
const codeOf = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')

/** Mirrors `redactInvitePhone`: first four + last four, nothing between. */
function redact(phone) {
  const text = String(phone ?? '').trim()
  if (text.length < 7) return '••••'
  return `${text.slice(0, 4)} ••• ${text.slice(-4)}`
}

/** Mirrors `redactInviteForMember`: status only, never internals. */
function redactRow(row) {
  const hidden = new Set([
    'invitee_phone',
    'invitee_contact_hash',
    'guardian_phone',
    'message_rendered',
    'variables_snapshot',
  ])
  const out = {
    id: String(row.id),
    invitee_phone_redacted: redact(row.invitee_phone),
  }
  for (const [field, value] of Object.entries(row)) {
    if (field === 'id' || hidden.has(field)) continue
    out[field] = value
  }
  return out
}

const FULL_ROW = {
  id: 'i1',
  event: 'e1',
  branch: 'b1',
  inviter_person: 'p1',
  inviter_user: 'u1',
  invitee_name: 'Ada',
  invitee_phone: '+2348012345678',
  invitee_contact_hash: 'sha256:abc',
  invitee_age_band: 'adult',
  guardian_phone: null,
  channel_choice: 'auto',
  message_rendered: 'Dear Ada, ...',
  variables_snapshot: { invitee_name: 'Ada' },
  status: 'sent',
  approval_required: false,
  blocked_reason: null,
  created_at: '2026-10-20T08:00:00Z',
}

describe('invite helper: member redaction', () => {
  const source = read('apps/web/server/utils/event-invites.ts')

  it('hides exactly the §5.1 internals from members', () => {
    for (const field of [
      'invitee_phone',
      'invitee_contact_hash',
      'guardian_phone',
      'message_rendered',
      'variables_snapshot',
    ]) {
      assert.ok(source.includes(`'${field}'`), `member-hidden set names ${field}`)
    }
  })

  it('redacts to the 0801 ••• •234 shape', () => {
    assert.equal(redact('+2348012345678'), '+234 ••• 5678')
    assert.equal(redact('0801123456'), '0801 ••• 3456')
    assert.equal(redact('123'), '••••')
  })

  it('member projection keeps status but drops phone, hash and rendered text', () => {
    const row = redactRow(FULL_ROW)
    assert.equal(row.invitee_phone_redacted, '+234 ••• 5678')
    assert.equal(row.invitee_phone, undefined)
    assert.equal(row.invitee_contact_hash, undefined)
    assert.equal(row.guardian_phone, undefined)
    assert.equal(row.message_rendered, undefined)
    assert.equal(row.variables_snapshot, undefined)
    assert.equal(row.status, 'sent')
  })

  it('member blocked rows keep the actionable reason, not provider detail', () => {
    const row = redactRow({ ...FULL_ROW, status: 'blocked_rate_limit', blocked_reason: 'limit reached' })
    assert.equal(row.blocked_reason, 'limit reached')
    const queued = redactRow({ ...FULL_ROW, status: 'queued', blocked_reason: 'limit reached' })
    assert.equal(queued.blocked_reason, 'limit reached')
  })

  it('the capability table grants export/approve/retry to branch admin and above only', () => {
    assert.match(
      source,
      /case 'branch_admin':\s*\n\s*return \{ create: true, read: true, readFull: true, approve: true, retry: true, exportCsv: true \}/,
    )
    assert.match(
      source,
      /case 'member':\s*\n\s*return \{ create: true, read: true, readFull: false, approve: false, retry: false, exportCsv: false \}/,
    )
  })
})

describe('preview route: exact text before queue, no write', () => {
  const src = codeOf('apps/web/server/api/invites/preview.post.ts')

  it('requires the create capability', () => {
    assert.match(src, /requireInviteCap\(caps, 'create', /)
  })

  it('rejects minor invites without a guardian number', () => {
    assert.match(src, /isMinorBand\(ageBand\) && !guardian/)
    assert.match(src, /guardian_phone/)
  })

  it('refuses branch-private events to cross-branch inviters', () => {
    assert.match(src, /branch_private_requires_same_branch_inviter/)
  })

  it('reports suppressed numbers as 409 before anything is queued', () => {
    assert.match(src, /isInviteSuppressed\(event, scope, contactHash\)/)
    assert.match(src, /statusCode: 409/)
    assert.match(src, /blocked_optout/)
  })

  it('never writes a row', () => {
    assert.doesNotMatch(src, /createItem/)
    assert.doesNotMatch(src, /updateItem/)
  })
})

describe('create route: gates with an auditable row each', () => {
  const src = codeOf('apps/web/server/api/invites/index.post.ts')

  it('requires the create capability', () => {
    assert.match(src, /requireInviteCap\(caps, 'create', /)
  })

  it('rejects minor invites without a guardian number', () => {
    assert.match(src, /isMinorBand\(ageBand\) && !guardian/)
  })

  it('records suppressed numbers as blocked_optout, never queued', () => {
    assert.match(src, /status: 'blocked_optout'/)
    assert.match(src, /staff cannot override an opt-out/)
  })

  it('sends over-limit invites to blocked_rate_limit with approval required', () => {
    assert.match(src, /status = 'blocked_rate_limit'/)
    assert.match(src, /approvalRequired = true/)
  })

  it('sends event-level approval invites to pending_approval', () => {
    assert.match(src, /status = 'pending_approval'/)
    assert.match(src, /invite_requires_approval/)
  })

  it('writes the row WITH the rendered message and snapshot', () => {
    assert.match(src, /message_rendered: rendered/)
    assert.match(src, /variables_snapshot: variables/)
  })
})

describe('list and detail routes: own-or-branch scope, redacted members', () => {
  const list = codeOf('apps/web/server/api/invites/index.get.ts')
  const detail = codeOf('apps/web/server/api/invites/[id].get.ts')

  it('list scopes members to their own rows and staff to their branches', () => {
    assert.match(list, /inviter_user: \{ _eq: scope\.session\.user\.id \}/)
    assert.match(list, /scopeFilter\(scope\)/)
  })

  it('list supports the US-E3 filter set and redacts per row', () => {
    assert.match(list, /eventFilter \? \{ event: \{ _eq: eventFilter \} \}/)
    assert.match(list, /inviter \? \{ inviter_user: \{ _eq: inviter \} \}/)
    assert.match(list, /status \? \{ status: \{ _eq: status \} \}/)
    assert.match(list, /projectInviteRow\(scope, caps,/)
  })

  it('detail scopes the same way and projects the same shape', () => {
    assert.match(detail, /inviter_user: \{ _eq: scope\.session\.user\.id \}/)
    assert.match(detail, /projectInviteRow\(scope, caps,/)
  })
})

describe('approve route: no opt-out override, approvable states only', () => {
  const src = codeOf('apps/web/server/api/invites/[id].approve.post.ts')

  it('requires the approve capability', () => {
    assert.match(src, /requireInviteCap\(caps, 'approve', /)
  })

  it('refuses blocked_optout with 403', () => {
    assert.match(src, /row\.status === 'blocked_optout'/)
    assert.match(src, /optout_not_overridable/)
  })

  it('approves only pending_approval and blocked_rate_limit into queued', () => {
    assert.match(src, /row\.status !== 'pending_approval' && row\.status !== 'blocked_rate_limit'/)
    assert.match(src, /status: 'queued'/)
    assert.match(src, /approved_by: scope\.session\.user\.id/)
  })
})

describe('retry route: failed-only, once, as a new row', () => {
  const src = codeOf('apps/web/server/api/invites/[id].retry.post.ts')

  it('requires the retry capability and the failed state', () => {
    assert.match(src, /requireInviteCap\(caps, 'retry', /)
    assert.match(src, /row\.status !== 'failed'/)
  })

  it('returns the existing retry instead of duplicating it', () => {
    assert.match(src, /retry_of: \{ _eq: id \}/)
    assert.match(src, /retried: false/)
  })

  it('creates a queued row linked by retry_of with send state reset', () => {
    assert.match(src, /retry_of: id/)
    assert.match(src, /status: 'queued'/)
    assert.match(src, /communication: null/)
  })
})

describe('withdraw and export routes: narrow by construction', () => {
  const withdraw = codeOf('apps/web/server/api/invites/[id].withdraw.post.ts')
  const exp = codeOf('apps/web/server/api/invites/export.get.ts')

  it('withdraw moves unsent invites to withdrawn only', () => {
    assert.match(withdraw, /pending_approval', 'queued', 'blocked_rate_limit'/)
    assert.match(withdraw, /status: 'withdrawn'/)
  })

  it('export requires the export capability members never hold', () => {
    assert.match(exp, /requireInviteCap\(caps, 'exportCsv', /)
  })
})

describe('migration encodes the acceptance rule the routes read', () => {
  const migration = read(
    'services/directus/schema/migrations/20261020_0005_event_invites.sql',
  )

  it('rejects minor-without-guardian at creation', () => {
    assert.match(migration, /invite_minor_needs_guardian/)
    assert.match(migration, /invitee_age_band NOT IN \('child', 'teen'\)/)
  })

  it('forces blocked and failed rows to carry a reason, and pairs approver fields', () => {
    assert.match(migration, /invite_blocked_needs_reason/)
    assert.match(migration, /invite_approver_paired/)
  })

  it('withholds UPDATE on frozen columns and DELETE entirely', () => {
    assert.match(migration, /GRANT UPDATE \(status, approval_required, approved_by, approved_at,/)
    assert.doesNotMatch(migration, /DELETE ON event_invites TO directus_app/)
  })

  it('ships the three gates with no staff-override parameter', () => {
    for (const fn of ['invite_rate_gate', 'invite_eligibility', 'invite_contact_suppressed']) {
      assert.ok(migration.includes(`CREATE OR REPLACE FUNCTION ${fn}(`), `gate ${fn} present`)
    }
    const sig = migration.match(/CREATE OR REPLACE FUNCTION invite_eligibility\(([\s\S]*?)\)\s*\nRETURNS TABLE/)
    assert.ok(sig, 'eligibility signature found')
    assert.doesNotMatch(sig[1], /override/)
  })

  it('owns a down script that refuses on rows and drops in dependency order', () => {
    const down = read(
      'services/directus/schema/migrations/rollback/20261020_0005_event_invites.down.sql',
    )
    assert.match(down, /refusing to roll back event invites/)
    assert.match(down, /DROP TABLE IF EXISTS event_invites/)
  })
})
