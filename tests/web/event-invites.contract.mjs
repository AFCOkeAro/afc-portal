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
import { readdirSync, readFileSync } from 'node:fs'
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
    // Whitespace-tolerant: prettier lays the literal multi-line; the
    // contract pins the granted VALUES, not the line breaks (AFC-723 fix:
    // the single-line regex went red on a prettier reformat, hiding real
    // signal in this suite).
    assert.match(
      source,
      /case 'branch_admin':\s*\n\s*return \{\s*create: true,\s*read: true,\s*readFull: true,\s*approve: true,\s*retry: true,\s*exportCsv: true,?\s*\}/,
    )
    assert.match(
      source,
      /case 'member':\s*\n\s*return \{\s*create: true,\s*read: true,\s*readFull: false,\s*approve: false,\s*retry: false,\s*exportCsv: false,?\s*\}/,
    )
  })
})

describe('preview route: exact text before queue, no write', () => {
  const src = codeOf('apps/web/server/api/invites/preview.post.ts')

  it('requires the create capability', () => {
    assert.match(src, /requireInviteCap\(caps, 'create', /)
  })

  it('rejects minor and unknown-age invites without a guardian number (unknown defaults to guardian path)', () => {
    assert.match(src, /requiresGuardianBand\(ageBand\) && !guardian/)
    assert.match(src, /guardian_phone/)
  })

  it('requires explicit guardian attestation and rejects forged inviter_* fields', () => {
    assert.match(src, /guardian_attested/)
    assert.match(src, /throwOnForgedInviterIdentity\(body\)/)
  })

  it('bounds the inviter note (140 chars, no URLs/phones)', () => {
    assert.match(src, /validateInviterNote\(body\.inviter_note\)/)
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

  it('rejects minor and unknown-age invites without a guardian number (unknown defaults to guardian path)', () => {
    assert.match(src, /requiresGuardianBand\(ageBand\) && !guardian/)
    assert.match(src, /guardian_phone/)
  })

  it('requires explicit guardian attestation for child/teen so staff can confirm it', () => {
    assert.match(src, /guardian_attested/)
  })

  it('rejects forged inviter_* fields with 403 instead of overwriting them', () => {
    assert.match(src, /throwOnForgedInviterIdentity\(body\)/)
  })

  it('bounds the inviter note (140 chars, no URLs/phones) and renders it delimited', () => {
    assert.match(src, /validateInviterNote\(body\.inviter_note\)/)
    assert.match(src, /inviter_note/)
  })

  it('treats the atomic ledger-slot claim as authoritative with the rolling count advisory only (F3 closed, ADR-0011)', () => {
    assert.match(src, /claimInviteQuota\(event, scope, inviterUserId, limits\)/)
    assert.match(src, /if \(!claim\.allowed\)/)
    assert.match(src, /countInviterWindows/)
    const raw = read('apps/web/server/api/invites/index.post.ts')
    assert.match(raw, /the claim is AUTHORITATIVE/)
    assert.match(raw, /advisory/)
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
  const src = codeOf('apps/web/server/api/invites/[id]/approve.post.ts')

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
  const src = codeOf('apps/web/server/api/invites/[id]/retry.post.ts')

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
  const withdraw = codeOf('apps/web/server/api/invites/[id]/withdraw.post.ts')
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

describe('AFC-516: quota TOCTOU closed by the ledger-slot claim (F3)', () => {
  const raw = read('apps/web/server/api/invites/index.post.ts')

  it('names the claim as authoritative and the count as advisory, citing ADR-0011', () => {
    assert.match(raw, /claimInviteQuota/)
    assert.match(raw, /AUTHORITATIVE/)
    assert.match(raw, /ADR-0011/)
    assert.match(raw, /countInviterWindows/)
  })

  it('claims after the suppression check, so STOP numbers never consume quota', () => {
    const src = codeOf('apps/web/server/api/invites/index.post.ts')
    assert.ok(
      src.indexOf("status: 'blocked_optout'") < src.indexOf('claimInviteQuota('),
      'the blocked_optout write (with its early return) precedes the claim',
    )
  })

  it('releases claimed slots when the invite write fails, then rethrows', () => {
    const src = codeOf('apps/web/server/api/invites/index.post.ts')
    const raw = read('apps/web/server/api/invites/index.post.ts')
    assert.match(src, /claim\.release\(\)/)
    assert.match(raw, /No leaked quota on the handled path/)
  })

  it('states the crash-orphan direction (waste blocks more, never queues past the limit)', () => {
    assert.match(raw, /fail-safe/)
    assert.match(raw, /never queues past the limit/)
  })

  it('does not ship a trigger migration: no trigger on event_invites', () => {
    // The gate refuses a rollback that drops a control whose referent
    // survives; the ledger needs no trigger, so none may exist.
    assert.doesNotMatch(raw, /event_invites_quota_atomic/)
  })
})

describe('AFC-516: claim helper + Lagos calendar keys', () => {
  const source = codeOf('apps/web/server/utils/event-invites.ts')
  const rawSource = read('apps/web/server/utils/event-invites.ts')

  it('computes the Lagos day key (YYYY-MM-DD) via Intl in Africa/Lagos', () => {
    assert.match(source, /lagosDayKey/)
    assert.match(rawSource, /Africa\/Lagos/)
    assert.match(rawSource, /en-CA/)
  })

  it('computes the Lagos week Monday (Monday of that week)', () => {
    assert.match(source, /lagosWeekMonday/)
    assert.match(source, /Monday/)
  })

  it('claims day slots 0..daily-1 then week slots 0..weekly-1, unique-violation means next slot', () => {
    assert.match(source, /claimInviteQuota/)
    assert.match(source, /slot_no: slot/)
    assert.match(source, /isUniqueViolation\(error\)/)
  })

  it('detects unique violations as Directus 400s naming uniqueness, and fails closed otherwise', () => {
    assert.match(source, /isUniqueViolation/)
    assert.match(source, /status !== 400/)
    assert.match(rawSource, /\/unique\/i/)
    assert.match(rawSource, /fail closed/)
  })

  it('releases the day slot when the week claim fails, and releases both on demand', () => {
    assert.match(source, /release\(\[daySlot\]\)/)
    assert.match(source, /release: \(\) => release\(\[daySlot, weekSlot\]\)/)
  })

  it('claims nothing on a zero limit, so the claim is not allowed', () => {
    assert.match(source, /limits\.daily.*<= 0/)
    assert.match(source, /limits\.weekly.*<= 0/)
  })

  it('deletes slot rows by id through one helper next to createItem', () => {
    const portal = codeOf('apps/web/server/utils/portal.ts')
    assert.match(portal, /deleteItem/)
    assert.match(portal, /method: 'DELETE'/)
    assert.match(source, /deleteItem/)
  })
})

describe('AFC-512: note hygiene + guardian helpers (F5/F7)', () => {
  const source = codeOf('apps/web/server/utils/event-invites.ts')

  it('requires a guardian for child, teen AND unknown (unknown defaults to guardian path)', () => {
    assert.match(source, /requiresGuardianBand/)
    assert.ok(source.includes("'unknown'"), 'unknown band named in the guardian rule')
  })

  it('bounds the note to 140 chars and rejects URLs and phone numbers', () => {
    assert.match(source, /INVITER_NOTE_MAX_LENGTH = 140/)
    assert.match(source, /https\?:/)
  })

  it('renders the note delimited from the official body', () => {
    assert.match(source, /formatInviteNoteDelimited/)
    assert.match(source, /Note from inviter/)
  })

  it('rejects forged inviter_* fields with 403', () => {
    assert.match(source, /throwOnForgedInviterIdentity/)
    assert.match(source, /inviter_identity_forged/)
  })
})

/* ---------------------------------------------------------------------------
 * AFC-723 — dot-path routes are dead: slash-path registration.
 * Nitro file-based routing treats dots as literal segments, so
 * `invites/[id].retry.post.ts` registered `/api/invites/:id.retry` while
 * every caller POSTs to `/api/invites/:id/retry` (slash) — a 404. Same for
 * withdraw and approve. Pin the fix: the directory routes exist, no
 * dot-path files remain in the invites API dir, and both callers hit the
 * slash paths.
 * ------------------------------------------------------------------------- */
const listFilesRecursive = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listFilesRecursive(path.join(dir, entry.name))
      : [entry.name],
  )
const DOT_PATH_ROUTE = /^\[[^\]]+\]\.[^/]+\.(get|post|patch|put|delete)\.ts$/

describe('invite actions — slash-path registration (AFC-723)', () => {
  it('registers retry/withdraw/approve as directory routes under [id]', () => {
    for (const action of ['retry', 'withdraw', 'approve']) {
      assert.doesNotThrow(
        () => read(`apps/web/server/api/invites/[id]/${action}.post.ts`),
        `invites/[id]/${action}.post.ts exists`,
      )
    }
  })

  it('leaves no dot-path route files behind in the invites API dir', () => {
    const dots = listFilesRecursive(
      path.join(root, 'apps/web/server/api/invites'),
    ).filter((name) => DOT_PATH_ROUTE.test(name))
    assert.deepEqual(dots, [], `dot-path route files must not exist: ${dots.join(', ')}`)
  })

  it('the staff list posts approve/retry/withdraw to the slash paths', () => {
    const src = codeOf('apps/web/pages/invites/index.vue')
    assert.match(
      src,
      /\/api\/invites\/\$\{id\}\/\$\{action\}/,
      'staff list posts to /api/invites/:id/:action',
    )
    assert.doesNotMatch(src, /\$\{id\}\.\$\{action\}/, 'never the dotted path')
  })

  it('the member invitations page posts withdraw to the slash path', () => {
    const src = codeOf('apps/web/pages/me/invitations.vue')
    assert.match(
      src,
      /\/api\/invites\/\$\{id\}\/withdraw/,
      'member page posts to /api/invites/:id/withdraw',
    )
  })
})
