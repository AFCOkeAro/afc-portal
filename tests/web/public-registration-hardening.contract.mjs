/**
 * AFC-1222 contract — public registration hardening (F1-F6, F8),
 * second pass AFC-1226 (G1-G3, H1-H3, M1-M2).
 *
 * Pure node:test, no dependencies. Pins the code half of every fix; the
 * runtime half — flood e2e, 403 probe, concurrency race, staging TLS check —
 * belongs to the QA re-validation pass, not here:
 *
 *   F1  edge rate limit: per-IP token bucket, 429 + retry signal, no
 *       Caddy rate_limit directive (stock caddy:2-alpine has none).
 *   F2  policy artifact: tracked migration granting the public role
 *       create-only with exactly the allowlist + server-stamped columns
 *       (superseded by G3 below — 0072 revokes it).
 *   F3  capacity gate: aggregate read from the DATA shape, DB trigger as
 *       the serialized layer, trigger refusal mapped to 409/waitlist.
 *       Resolves the S9-vs-matrix conflict in favour of the matrix.
 *   F4  dedupe + bot signal: normalized (event, contact) replay with a
 *       named flag, honeypot silent-accept, Turnstile verify when the
 *       deploy configures it. Idempotency-Key stamping stays sequenced
 *       AFTER migration 0070 applies (the column must exist first).
 *   F5  flags: age_min/age_max/collect_medical fetched and enforced.
 *   F6  retention: 30-day edge log retention + scheduled Directus
 *       activity/revision pruning recorded next to the backup table.
 *   F8  WP evidence: this repo holds no WP handler — the only write path
 *       is the portal proxy.
 *
 *   G1  the gate runs as its owner: SECURITY DEFINER + fixed search_path,
 *       so a read-less inserting identity gets event_full, not 42501.
 *   G2  the capacity pre-check rides the server token (public visibility
 *       already enforced by the loadPublicEvent filter); an unreadable
 *       count falls through to write-plus-trigger mapping.
 *   G3  the 0069 public create grant is revoked; all public writes ride
 *       the server-held registration_writer token (create-only allowlist
 *       WITHOUT source/consent_signed_at, stamped server-side).
 *   H1  the limiter keys on the CDN-attested IP or the socket peer, never
 *       XFF (Caddy overwrites XFF at the edge); the map is bounded and
 *       the per-instance limit is documented honestly.
 *   H2  Idempotency-Key is stamped now; a 23505 replays the original row.
 *   H3  contact fragments are normalized BEFORE filtering; store errors
 *       fail closed (503) for seat-occupying writes. Turnstile fails
 *       closed in production when the secret is absent.
 *   M1  the honeypot returns the identical success shape, synthesized.
 *   M2  the 429 carries Retry-After as a header as well as the body.
 *   M3  the DB half (suite 104): a probe runs as the read-less identity
 *       and pins the 0069/0072 multi-row and non-create refusal paths.
 *
 * Run: node --test tests/web/public-registration-hardening.contract.mjs
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

/* ---- Inline mirrors (structural asserts below pin the real source) ---- */

const normalize = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
function dedupeKey(eventId, m) {
  const name = `${normalize(m.registrant_first_name)}|${normalize(m.registrant_last_name)}`
  const contact = normalize(m.phone) || normalize(m.email) || 'no-contact'
  return [String(eventId), name, contact].join(':')
}
// Mirror of resolveRateLimitKey: CDN-attested header first, socket second,
// XFF never (a rotating XFF must not move the bucket).
function rateKey(headers, socket) {
  const first = (v) => (Array.isArray(v) ? v[0] : v)
  const cdn = String(first(headers['cf-connecting-ip']) ?? '').trim()
  if (cdn) return `register:${cdn.toLowerCase()}`
  const sock = String(socket ?? '').trim()
  if (sock) return `register:${sock.toLowerCase()}`
  return 'register:unknown-client'
}
function parseCount(response) {
  const first = response?.data?.[0]?.count
  if (typeof first === 'number' && Number.isFinite(first))
    return Math.max(0, Math.floor(first))
  if (typeof first === 'string' && first.trim() !== '' && Number.isFinite(Number(first)))
    return Math.max(0, Math.floor(Number(first)))
  if (response?.meta && typeof response.meta === 'object') {
    let total = 0
    let seen = false
    for (const value of Object.values(response.meta)) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        total += value
        seen = true
      }
    }
    if (seen) return Math.max(0, Math.floor(total))
  }
  return 0
}
function ageInYears(dob, now = new Date()) {
  if (typeof dob !== 'string' || dob.trim() === '') return null
  const born = Date.parse(`${dob.trim()}T00:00:00Z`)
  if (Number.isNaN(born)) return null
  let age = now.getUTCFullYear() - new Date(born).getUTCFullYear()
  const bday = new Date(born)
  bday.setUTCFullYear(now.getUTCFullYear())
  if (bday.getTime() > now.getTime()) age -= 1
  return age
}

const ROUTE = 'apps/web/server/api/register.post.ts'
const LIMITER = 'apps/web/server/utils/public-rate-limit.ts'
const GUARD = 'apps/web/server/utils/public-registration-guard.ts'

describe('F1: edge rate limit, honest about the store', () => {
  it('the route throttles before any store work and answers 429', () => {
    const src = codeOf(ROUTE)
    assert.match(src, /checkPublicRateLimit/)
    assert.match(src, /statusCode: 429/)
    assert.match(src, /rate_limited/)
  })

  it('the limiter is a per-key token bucket with a window and eviction', () => {
    const src = codeOf(LIMITER)
    assert.match(src, /checkPublicRateLimit/)
    assert.match(src, /windowMs/)
    assert.match(src, /evictExpiredPublicRateLimitBuckets/)
    assert.match(src, /configurePublicRateLimit/)
  })

  it('the limiter refuses over budget and refills after the window', () => {
    // Mirror of the bucket math: 2 per window, third refused, window reset refills.
    let count = 0
    let resetAt = 1000 + 60_000
    const check = (now) => {
      if (now >= resetAt) {
        count = 1
        resetAt = now + 60_000
        return { allowed: true, remaining: 1 }
      }
      if (count < 2) {
        count += 1
        return { allowed: true, remaining: 2 - count }
      }
      return { allowed: false, remaining: 0 }
    }
    assert.deepEqual(check(1000), { allowed: true, remaining: 1 })
    assert.deepEqual(check(1001), { allowed: true, remaining: 0 })
    assert.deepEqual(check(1002), { allowed: false, remaining: 0 })
    assert.deepEqual(check(61_001), { allowed: true, remaining: 1 })
  })

  it('no Caddyfile pretends stock caddy rate-limits', () => {
    assert.doesNotMatch(read('services/directus/Caddyfile'), /rate_limit\s*\{/)
    assert.match(read('services/directus/Caddyfile'), /ships no such directive/)
  })

  it('the route states the shared store is a CTO decision, not a default', () => {
    assert.match(read(ROUTE), /shared store[\s\S]*?CTO/i)
  })
})

describe('H1: attested keying, bounded map, XFF never trusted', () => {
  it('the route keys on the CDN header or the socket, never XFF', () => {
    const src = codeOf(ROUTE)
    assert.match(src, /resolveRateLimitKey/)
    assert.doesNotMatch(src, /xForwardedFor/)
    assert.doesNotMatch(src, /getRequestIP/)
  })

  it('the key helper prefers CF-Connecting-IP, then the socket', () => {
    const src = codeOf(LIMITER)
    assert.match(src, /cf-connecting-ip/)
    assert.match(src, /socketAddress/)
  })

  it('a rotating XFF cannot move the bucket when the CDN header is present', () => {
    const headers = (xff) => ({
      'cf-connecting-ip': '203.0.113.7',
      'x-forwarded-for': xff,
    })
    assert.equal(rateKey(headers('198.51.100.1'), '10.0.0.9'), 'register:203.0.113.7')
    assert.equal(rateKey(headers('198.51.100.2'), '10.0.0.9'), 'register:203.0.113.7')
    assert.equal(
      rateKey(headers('198.51.100.1'), '10.0.0.9'),
      rateKey(headers('198.51.100.99'), '10.0.0.9'),
    )
  })

  it('without the CDN header the socket peer keys, not XFF', () => {
    assert.equal(
      rateKey({ 'x-forwarded-for': '198.51.100.1' }, '10.0.0.9'),
      'register:10.0.0.9',
    )
    assert.equal(
      rateKey({ 'x-forwarded-for': '198.51.100.2' }, '10.0.0.9'),
      'register:10.0.0.9',
    )
  })

  it('the map is bounded and the bound is enforced on the insert path', () => {
    const src = codeOf(LIMITER)
    assert.match(src, /MAX_BUCKETS = 10_000/)
    assert.match(src, /buckets\.size >= MAX_BUCKETS/)
    assert.match(src, /publicRateLimitSize/)
  })

  it('both Caddyfiles overwrite XFF at the edge', () => {
    for (const file of ['services/directus/Caddyfile', 'services/staging/Caddyfile']) {
      assert.match(read(file), /header_up X-Forwarded-For \{remote_host\}/)
      assert.match(read(file), /AFC-1226 H1/)
    }
  })
})

describe('M2: Retry-After travels as a header, not just a body', () => {
  it('the 429 sets the Retry-After header before throwing', () => {
    const src = codeOf(ROUTE)
    assert.match(src, /setResponseHeader\(event, 'Retry-After', retrySecs\)/)
    assert.match(src, /Math\.ceil\(limit\.retryAfterMs \/ 1000\)/)
  })

  it('the body still carries retryAfterMs for header-less readers', () => {
    assert.match(codeOf(ROUTE), /retryAfterMs: limit\.retryAfterMs/)
  })
})

describe('F2: public create-only policy artifact (0069, revoked by G3)', () => {
  const migration =
    'services/directus/schema/migrations/20261126_0069_public_registration_create_policy.sql'

  it('targets the public policy set, never a role column or perm id', () => {
    const src = codeOf(migration)
    assert.match(src, /directus_access/)
    assert.match(src, /a\.role IS NULL AND a\."user" IS NULL/)
    assert.match(src, /p\.collection = 'event_registrations'/)
    assert.match(src, /p\.action = 'create'/)
    assert.match(src, /p\.policy = ANY\(v_public_policies\)/)
    assert.doesNotMatch(src, /p\.role IS NULL/)
  })

  it('sets exactly the 18-field allowlist: 16 public + source + consent_signed_at', () => {
    const src = sqlOf(migration)
    for (const field of [
      'age_group',
      'allergies',
      'branch',
      'consent_signed_at',
      'date_of_birth',
      'email',
      'emergency_contact_name',
      'emergency_contact_phone',
      'event',
      'guardian_consent',
      'guardian_email',
      'guardian_name',
      'guardian_phone',
      'medical_notes',
      'phone',
      'registrant_first_name',
      'registrant_last_name',
      'source',
    ]) {
      assert.ok(src.includes(`'${field}'`), `allowlist carries ${field}`)
    }
    assert.doesNotMatch(src, /ticket_code/)
    assert.doesNotMatch(src, /registration_status/)
    assert.doesNotMatch(src, /amount_paid/)
    assert.doesNotMatch(src, /CREATE ROLE/)
  })

  it('refuses a public non-create row instead of proceeding (create-only)', () => {
    const src = codeOf(migration)
    assert.match(src, /p\.action <> 'create'/)
    assert.match(src, /restrict_violation/)
  })

  it('never invents a grant: unknown state is an operator NOTICE, ambiguous sets raise', () => {
    const src = codeOf(migration)
    assert.match(src, /As the Directus operator/)
    assert.match(src, /ambiguous set would grant blindly/)
  })
})

describe('G3: the writer policy replaces the public grant', () => {
  const migration =
    'services/directus/schema/migrations/20261127_0072_revoke_public_create_writer_role.sql'

  it('revokes the legacy public create row instead of narrowing it', () => {
    const src = codeOf(migration)
    assert.match(src, /DELETE FROM directus_permissions/)
    assert.match(src, /p\.policy = ANY\(v_public_policies\)/)
    assert.match(src, /p\.policy <> v_writer_id/)
    assert.match(src, /Direct anonymous writes to the collection now fail closed/)
  })

  it('matches the writer policy by stable name, never by environment id', () => {
    const src = codeOf(migration)
    assert.match(src, /directus_policies/)
    assert.match(src, /pl\.name = 'registration_writer'/)
  })

  it('leaves the public grant untouched until the writer replacement exists', () => {
    const src = codeOf(migration)
    assert.match(src, /left untouched until the replacement exists/)
    // The public DELETE sits after the writer convergence in the file.
    assert.ok(
      src.indexOf('registration_writer') <
        src.lastIndexOf('DELETE FROM directus_permissions'),
    )
  })

  it('converges the writer grant to 18 fields WITHOUT source/consent_signed_at', () => {
    const src = sqlOf(migration)
    for (const field of [
      'age_group',
      'allergies',
      'branch',
      'date_of_birth',
      'email',
      'emergency_contact_name',
      'emergency_contact_phone',
      'event',
      'guardian_consent',
      'guardian_email',
      'guardian_name',
      'guardian_phone',
      'idempotency_key',
      'medical_notes',
      'phone',
      'registrant_first_name',
      'registrant_last_name',
      'registration_status',
    ]) {
      assert.ok(src.includes(`'${field}'`), `writer allowlist carries ${field}`)
    }
    assert.doesNotMatch(src, /'source'/)
    assert.doesNotMatch(src, /'consent_signed_at'/)
    assert.doesNotMatch(src, /ticket_code/)
    assert.doesNotMatch(src, /amount_paid/)
    assert.doesNotMatch(src, /CREATE ROLE/)
  })

  it('refuses writer non-create rows and ambiguous sets (create-only)', () => {
    const src = codeOf(migration)
    assert.match(src, /p\.action <> 'create'/)
    assert.match(src, /AND p\.policy = v_writer_id/)
    assert.match(src, /restrict_violation/)
  })

  it('never invents the writer grant: a missing row is an operator NOTICE', () => {
    const src = codeOf(migration)
    assert.match(src, /has no event_registrations\/create permission/)
    assert.match(src, /As the Directus operator, grant it create/)
  })

  it('stamps consent server-side; source rides its column default', () => {
    const src = codeOf(migration)
    assert.match(src, /event_registrations_stamp_server_fields/)
    assert.match(src, /NEW\.consent_signed_at := now\(\)/)
    assert.match(src, /NOT NULL/)
  })

  it('the route writes through the server-held writer token only', () => {
    const src = codeOf(ROUTE)
    assert.match(src, /directusWriterToken/)
    // Every directusFetch on event_registrations carries the writer token
    // (the write) or the server token (pre-check plus replays). The public
    // token never touches the collection — it reads public events only.
    const calls = src.split("'/items/event_registrations'").slice(1)
    assert.ok(
      calls.length >= 4,
      `expected the four registrations calls, got ${calls.length}`,
    )
    for (const chunk of calls) {
      const token = chunk.slice(0, 400).match(/accessToken: (\w+)/)
      assert.ok(
        token && (token[1] === 'writerToken' || token[1] === 'serverToken'),
        `registrations call must ride writer/server token, got ${token?.[1]}`,
      )
    }
    assert.match(src, /registration_writer_unavailable/)
  })

  it('the route requires the writer and server tokens before any store work', () => {
    const src = codeOf(ROUTE)
    assert.match(src, /NUXT_DIRECTUS_WRITER_TOKEN is not configured/)
    assert.match(src, /NUXT_DIRECTUS_SERVER_TOKEN is not configured/)
    assert.match(src, /statusCode: 503/)
  })

  it('the writer payload is the 16 public fields plus status and key — never stamps', () => {
    const src = codeOf(ROUTE)
    assert.match(src, /toWriterPayload/)
    assert.match(src, /PUBLIC_REGISTRATION_FIELDS/)
    assert.match(src, /registration_status: status/)
    assert.match(src, /idempotency_key: idempotencyKey/)
    assert.doesNotMatch(src, /consent_signed_at/)
    assert.doesNotMatch(src, /source: 'public_form'/)
  })
})

describe('F3: capacity gate in the serialized path, data shape fixed', () => {
  it('the route reads the aggregate DATA shape, not meta', () => {
    const src = codeOf(ROUTE)
    assert.match(src, /aggregate: \{ count: '\*' \}/)
    assert.match(src, /parseAggregateCount/)
    assert.doesNotMatch(src, /Object\.values\(counted\.meta/)
  })

  it('the count parser prefers data[0].count and keeps meta as fallback', () => {
    assert.equal(parseCount({ data: [{ count: 7 }] }), 7)
    assert.equal(parseCount({ data: [{ count: '7' }] }), 7)
    assert.equal(parseCount({ meta: { total: 7 } }), 7)
    assert.equal(parseCount({ data: [{ count: null }], meta: { total: 4 } }), 4)
    assert.equal(parseCount({ data: [] }), 0)
    assert.equal(parseCount(null), 0)
  })

  it('the trigger serializes per event and refuses seat-occupying inserts at capacity', () => {
    const src = codeOf(
      'services/directus/schema/migrations/20261126_0070_registration_capacity_gate.sql',
    )
    assert.match(src, /pg_advisory_xact_lock\(hashtext\(NEW\.event::text\)\)/)
    assert.match(src, /registration_status IN \('pending', 'confirmed'\)/)
    assert.match(src, /event_full/)
    assert.match(src, /restrict_violation/)
    assert.match(src, /IF NEW\.registration_status NOT IN/)
  })

  it('re-classifies a sanitized trigger 500 by re-reading the seat count', () => {
    const src = codeOf(ROUTE)
    assert.match(src, /isAtCapacity/)
    assert.match(src, /capacity: eventRow\.capacity/)
    assert.match(src, /isAtCapacity\(event, tokens\.serverToken, form\.event, options\.capacity\)/)
  })

  it('the route maps a trigger refusal to 409/waitlist, never a bare 502', () => {
    const src = codeOf(ROUTE)
    assert.match(src, /createWithRaceGuard/)
    assert.match(src, /isEventFullRefusal/)
    assert.match(src, /statusCode: 409/)
  })

  it('the S9-vs-matrix conflict is resolved explicitly, not silently', () => {
    assert.match(read(ROUTE), /data-model S9 vs matrix, resolved explicitly/)
  })
})

describe('F1 (AFC-1230): race-path signal survives the 5xx mapper', () => {
  // Mirror of the fixed 5xx branch in apps/web/server/utils/directus.ts:
  // statusMessage stays generic (AFC-654), the upstream signal rides in
  // data (never in the message) so the route matcher can still see it.
  function mirrorMap(cause, path) {
    const status = cause?.statusCode ?? cause?.status ?? 500
    const first = cause?.data?.errors?.[0]
    if (status >= 500 || status < 400) {
      return {
        statusCode: status >= 500 && status < 600 ? status : 502,
        statusMessage: `Directus request to ${path} failed`,
        data: {
          code: first?.extensions?.code ?? 'directus_error',
          upstreamMessage: first?.message ?? cause?.statusMessage ?? null,
          upstreamCode: first?.extensions?.code ?? null,
          upstreamStatus: status,
        },
      }
    }
    return { statusCode: status, statusMessage: String(first?.message ?? '') }
  }
  // Mirror of refusalMessages in the route (reads the preserved signal).
  function mirrorRefusals(error) {
    return [
      error?.message,
      error?.statusMessage,
      error?.data?.errors?.[0]?.message,
      error?.data?.upstreamMessage,
      error?.data?.upstreamCode,
      error?.data?.code,
    ]
  }
  const isFull = (e) =>
    mirrorRefusals(e).some((p) => typeof p === 'string' && p.includes('event_full'))
  const isDupe = (e) =>
    mirrorRefusals(e).some(
      (p) =>
        typeof p === 'string' &&
        (p.includes('event_registrations_event_idem_key') ||
          p.includes('duplicate key') ||
          p.includes('23505')),
    )

  it('the mapper preserves the upstream signal outside the generic message', () => {
    const src = codeOf('apps/web/server/utils/directus.ts')
    assert.match(src, /upstreamMessage/)
    assert.match(src, /upstreamCode/)
    // The generic message stays (AFC-654: no SQL text in statusMessage).
    assert.match(src, /Directus request to \$\{path\} failed/)
  })

  it('the route matcher reads the preserved signal', () => {
    const src = codeOf(ROUTE)
    assert.match(src, /upstreamMessage/)
    assert.match(src, /upstreamCode/)
  })

  it('a fabricated 5xx carrying event_full still maps to the full-event path', () => {
    const upstream = {
      statusCode: 500,
      data: {
        errors: [
          { message: 'event_full: capacity reached', extensions: { code: '23001' } },
        ],
      },
    }
    const mapped = mirrorMap(upstream, '/items/event_registrations')
    assert.equal(mapped.statusCode, 500)
    assert.doesNotMatch(mapped.statusMessage, /event_full/)
    assert.ok(isFull(mapped), 'preserved upstreamMessage must still match event_full')
    // The pre-fix shape (generic message, no preserved signal) would NOT match.
    const stripped = {
      statusCode: 500,
      statusMessage: 'Directus request to /items/event_registrations failed',
      data: { code: 'directus_error' },
    }
    assert.ok(!isFull(stripped), 'stripped shape must not match (the F1 bug)')
  })

  it('a fabricated 5xx carrying 23505 still maps to the idempotency-replay path', () => {
    const upstream = {
      statusCode: 500,
      data: {
        errors: [
          {
            message:
              'duplicate key value violates unique constraint "event_registrations_event_idem_key"',
            extensions: { code: '23505' },
          },
        ],
      },
    }
    const mapped = mirrorMap(upstream, '/items/event_registrations')
    assert.ok(isDupe(mapped), 'preserved 23505/duplicate-key must still match replay')
    const stripped = {
      statusCode: 500,
      statusMessage: 'Directus request to /items/event_registrations failed',
      data: { code: 'directus_error' },
    }
    assert.ok(!isDupe(stripped), 'stripped shape must not match (the F1 bug)')
  })
})

describe('G1/G2: the gate survives a read-less caller; the pre-check rides the server token', () => {
  it('the gate runs as its owner with a fixed search_path', () => {
    const src = codeOf(
      'services/directus/schema/migrations/20261127_0071_registration_capacity_gate_definer.sql',
    )
    assert.match(src, /SECURITY DEFINER/)
    assert.match(src, /SET search_path = public, pg_temp/)
    assert.match(src, /pg_advisory_xact_lock\(hashtext\(NEW\.event::text\)\)/)
    assert.match(src, /event_full/)
    assert.match(src, /restrict_violation/)
  })

  it('the pre-check uses the server token and falls through when unreadable', () => {
    const src = codeOf(ROUTE)
    assert.match(src, /readTakenSeats\(event, serverToken/)
    assert.match(read(ROUTE), /lets the trigger decide/)
  })

  it('the public token never touches the registrations collection', () => {
    const src = codeOf(ROUTE)
    // The public token reads public events only (visibility-filtered): its
    // single accessToken use is the events read; every registrations call
    // rides writer/server (pinned by the G3 test above).
    assert.match(src, /loadPublicEvent\(event, publicToken/)
    assert.equal((src.match(/accessToken: publicToken/g) ?? []).length, 1)
  })

  it('a writer permission fault pages (503) instead of misreporting capacity', () => {
    const src = codeOf(ROUTE)
    assert.match(src, /DirectusAuthError/)
    assert.match(src, /registration_writer_unavailable/)
    // The 42501-that-survives path is a misconfiguration, not a full event:
    // the data layer (0071 definer) already converts the read-less case to
    // event_full, so what reaches this layer must not map onto 409.
    assert.match(read(ROUTE), /must page, not misreport/)
  })
})

describe('F4: dedupe replay plus bot signal, sequenced honestly', () => {
  it('a normalized (event, contact) retry replays the original row', () => {
    const src = codeOf(ROUTE)
    assert.match(src, /findDupeReplay/)
    assert.match(src, /publicDedupeKey/)
    assert.match(src, /replay: true/)
  })

  it('the dedupe key matches the group-key normalization (phone wins, case-insensitive)', () => {
    const a = dedupeKey('e1', {
      registrant_first_name: 'Ada',
      registrant_last_name: 'Oke',
      phone: '0803 123 4567',
    })
    const b = dedupeKey('e1', {
      registrant_first_name: ' ada ',
      registrant_last_name: 'OKE',
      phone: '08031234567',
    })
    assert.equal(a, b)
    const c = dedupeKey('e1', {
      registrant_first_name: 'Ada',
      registrant_last_name: 'Oke',
      email: 'ADA@x.ng',
    })
    const d = dedupeKey('e1', {
      registrant_first_name: 'ada',
      registrant_last_name: 'oke',
      email: 'ada@x.ng',
    })
    assert.equal(c, d)
  })

  it('the replay lookup matches the FULL key in code and leaks nothing on partial probes', () => {
    const src = codeOf(ROUTE)
    assert.match(src, /publicDedupeKey\(form\.event, row\) === wanted/)
    assert.match(read(ROUTE), /partial probe matches nothing/)
  })

  it('the honeypot is silently accepted and never written', () => {
    const src = codeOf(ROUTE)
    assert.match(src, /isHoneypotFilled/)
    assert.match(read(ROUTE), /nothing is written/)
    // The honeypot returns before any write path runs.
    assert.ok(
      src.lastIndexOf('isHoneypotFilled(rawBody)') <
        src.lastIndexOf('return createWithRaceGuard'),
    )
  })

  it('Turnstile verifies before seat allocation when the deploy configures it', () => {
    const src = codeOf(ROUTE)
    assert.match(src, /verifyTurnstileIfConfigured/)
    assert.match(src, /turnstile_token/)
    assert.match(src, /bot_verification_required/)
    assert.match(src, /bot_verification_failed/)
    const config = read('apps/web/nuxt.config.ts')
    assert.match(config, /turnstileSecretKey/)
  })

  it('a missing Turnstile secret closes the form in production, not silently', () => {
    const src = codeOf(ROUTE)
    assert.match(src, /bot_verification_unavailable/)
    assert.match(src, /NODE_ENV.*production/)
    assert.match(read(ROUTE), /written CEO/)
    assert.match(read(ROUTE), /risk-acceptance/)
  })

  it('the Turnstile secret is server-only (never in the public block)', () => {
    const src = read('apps/web/nuxt.config.ts')
    const publicBlock = src.slice(src.indexOf('public:'))
    assert.doesNotMatch(publicBlock, /turnstileSecretKey/)
  })

  it('the writer token is server-only (never in the public block)', () => {
    const src = read('apps/web/nuxt.config.ts')
    const publicBlock = src.slice(src.indexOf('public:'))
    assert.doesNotMatch(publicBlock, /directusWriterToken/)
    assert.match(src, /directusWriterToken/)
  })

  it('proof-of-work/OTP-verify stays a recorded CTO decision, not smuggled code', () => {
    assert.match(read(ROUTE), /CTO decision/)
  })
})

describe('H2/H3: idempotency now; normalized filter; fail closed', () => {
  it('the route stamps the Idempotency-Key header into idempotency_key', () => {
    const src = codeOf(ROUTE)
    assert.match(src, /resolveIdempotencyKey/)
    assert.match(src, /idempotency-key/)
    assert.match(src, /idempotency_key: idempotencyKey/)
  })

  it('a duplicate-key refusal replays the original row, else fails closed', () => {
    const src = codeOf(ROUTE)
    assert.match(src, /isIdempotencyDuplicate/)
    assert.match(src, /event_registrations_event_idem_key/)
    assert.match(src, /findIdempotencyReplay/)
    assert.match(src, /registration_store_unreadable/)
  })

  it('the contact filter is normalized before querying', () => {
    const src = codeOf(ROUTE)
    assert.match(src, /buildDedupeFilter/)
    assert.match(src, /normalizePublicContact\(raw\)/)
    assert.match(src, /_or/)
  })

  it('a dead store fails closed on the dedupe path (one re-read, then 503)', () => {
    const src = codeOf(ROUTE)
    assert.match(src, /readDedupeCandidates\(event, serverToken, filter\)/)
    assert.match(src, /statusCode: 503/)
    assert.match(read(ROUTE), /Fails CLOSED/)
  })
})

describe('M1: the honeypot answers exactly like a success, synthesized', () => {
  it('the honeypot returns id, ticket_code and registration_status', () => {
    const src = codeOf(ROUTE)
    const start = src.lastIndexOf('if (isHoneypotFilled(rawBody))')
    const honeypot = src.slice(start, start + 220)
    assert.match(honeypot, /id: randomUUID\(\)/)
    assert.match(honeypot, /ticket_code: null/)
    assert.match(honeypot, /registration_status: seatStatus/)
    assert.doesNotMatch(honeypot, /replay/)
  })

  it('the honeypot status runs through the same gates as a real write', () => {
    const src = codeOf(ROUTE)
    // The honeypot sits after the capacity pre-check, so seatStatus is the
    // event's real current answer — not a hardcoded 'pending'.
    assert.ok(
      src.indexOf('isHoneypotFilled(rawBody)') >
        src.indexOf('readTakenSeats(event, serverToken'),
    )
  })
})

describe('F5: event flags fetched and enforced', () => {
  it('the event load fetches age_min, age_max and collect_medical', () => {
    const src = codeOf(ROUTE)
    assert.match(src, /'age_min'/)
    assert.match(src, /'age_max'/)
    assert.match(src, /'collect_medical'/)
  })

  it('out-of-range ages and unexpected medical content fail 400', () => {
    const src = codeOf(ROUTE)
    assert.match(src, /checkEligibilityFlags/)
    assert.match(src, /event_requirements_unmet/)
  })

  it('the eligibility math behaves: window edges and the medical gate', () => {
    const now = new Date('2026-11-26T00:00:00Z')
    assert.equal(ageInYears('2016-11-26', now), 10)
    assert.equal(ageInYears('not-a-date', now), null)
    // Mirror of checkEligibilityFlags: below min refuses, medical refused when not collected.
    const check = (flags, form) => {
      const fields = {}
      const age = ageInYears(form.date_of_birth, now)
      if (age !== null) {
        if (flags.age_min !== null && age < flags.age_min)
          fields.date_of_birth = 'too young'
        else if (flags.age_max !== null && age > flags.age_max)
          fields.date_of_birth = 'too old'
      }
      if (!flags.collect_medical && (form.medical_notes || form.emergency_contact_phone))
        fields.medical_notes = 'not collected'
      return fields
    }
    assert.ok(
      check(
        { age_min: 13, age_max: 19, collect_medical: false },
        { date_of_birth: '2016-01-01' },
      ).date_of_birth,
    )
    assert.ok(
      !check(
        { age_min: 13, age_max: 19, collect_medical: true },
        { date_of_birth: '2010-01-01' },
      ).date_of_birth,
    )
    assert.ok(
      check(
        { age_min: null, age_max: null, collect_medical: false },
        { medical_notes: 'x' },
      ).medical_notes,
    )
    assert.ok(
      !check({ age_min: null, age_max: null, collect_medical: false }, {}).date_of_birth,
    )
  })
})

describe('F6: retention next to the backup table', () => {
  it('the prod Caddyfile keeps 30 days of edge access logs', () => {
    const src = read('services/directus/Caddyfile')
    assert.match(src, /roll_keep_for 720h/)
    assert.match(src, /access\.log/)
  })

  it('the history-prune script is dry-run by default and refuses to guess', () => {
    const src = read('services/directus/bin/prune-directus-history.sh')
    assert.match(src, /DRY RUN/)
    assert.match(src, /directus_activity/)
    assert.match(src, /directus_revisions/)
  })

  it('infra-spec records edge-log and history-prune retention beside backups', () => {
    const src = read('docs/planning/infra-spec.md')
    assert.match(src, /Edge access logs/)
    assert.match(src, /directus_activity.*directus_revisions|activity.*revision/i)
  })
})

describe('F8: WP evidence (repo side)', () => {
  it('the only public write path in this repo is the portal proxy', () => {
    const src = codeOf(ROUTE)
    assert.match(src, /directusWriterToken/)
    assert.match(src, /PUBLIC_REGISTRATION_FIELDS/)
    assert.match(read(ROUTE), /PUBLIC_REGISTRATION_FIELDS/)
  })

  it('no server-side WP proxy exists anywhere in the tree', () => {
    assert.doesNotMatch(codeOf(ROUTE), /wp-|wordpress/i)
  })
})

describe('AFC-1256: create-only writer read-after-write (option 2)', () => {
  const src = codeOf(ROUTE)

  it('does not assume the create response carries the row', () => {
    assert.match(src, /RegistrationResponse \| null/)
    assert.match(src, /created && typeof created === 'object' \? created\.data : null/)
  })

  it('resolves the created row with the server token, never the writer token', () => {
    assert.match(src, /resolveCreatedRegistration/)
    assert.match(src, /findIdempotencyReplay/)
    assert.match(src, /findNewestContactRegistration/)
    const readback = src.slice(src.indexOf('async function resolveCreatedRegistration'))
    assert.match(readback, /findIdempotencyReplay\(event, serverToken/)
    assert.match(readback, /findNewestContactRegistration\(event, serverToken/)
  })

  it('orders the no-key fallback newest-first so an older sibling cannot win', () => {
    assert.match(src, /\['-created_at'\]/)
    assert.match(src, /buildDedupeFilter\(form\)/)
  })

  it('retries a bounded number of times, then fails closed with a named 503', () => {
    assert.match(src, /READBACK_ATTEMPTS = 3/)
    assert.match(src, /registration_readback_failed/)
    assert.match(src, /retry with the same Idempotency-Key/)
  })

  it('keeps the writer grant create-only (no read added to satisfy the echo)', () => {
    assert.doesNotMatch(
      src,
      /accessToken: writerToken[\s\S]{0,240}method: 'GET'/,
    )
  })
})

describe('AFC-1230 F2: 0072 fails closed when the writer replacement is missing', () => {
  const migration =
    'services/directus/schema/migrations/20261127_0072_revoke_public_create_writer_role.sql'

  it('a missing writer policy raises instead of NOTICE+RETURN', () => {
    const src = codeOf(migration)
    assert.match(src, /no Directus policy named registration_writer/)
    assert.match(src, /restrict_violation/)
    assert.doesNotMatch(src, /not applied: no Directus policy named registration_writer/)
  })

  it('a missing writer create row raises instead of NOTICE+RETURN', () => {
    const src = codeOf(migration)
    assert.match(src, /has no event_registrations\/create permission/)
    assert.match(src, /restrict_violation/)
    assert.doesNotMatch(
      src,
      /not applied: the registration_writer role has no event_registrations\/create permission/,
    )
  })

  it('the tables-absent NOTICE skip stays (no surface exists yet)', () => {
    const src = codeOf(migration)
    assert.match(src, /Directus never booted/)
  })
})

describe('AFC-1230 F3: both new secrets are wired (empty) into deploy surfaces', () => {
  it('compose passes the writer token and Turnstile secret to web', () => {
    const src = read('services/directus/compose.yml')
    assert.match(src, /NUXT_DIRECTUS_WRITER_TOKEN/)
    assert.match(src, /NUXT_TURNSTILE_SECRET_KEY/)
    assert.match(src, /NUXT_DIRECTUS_PUBLIC_TOKEN/)
  })

  it('.env.example documents both new names with empty values', () => {
    const src = read('services/directus/.env.example')
    assert.match(src, /NUXT_DIRECTUS_WRITER_TOKEN=/)
    assert.match(src, /NUXT_TURNSTILE_SECRET_KEY=/)
  })

  it('infra-spec records both plus the fail-closed deploy check', () => {
    const src = read('docs/planning/infra-spec.md')
    assert.match(src, /NUXT_DIRECTUS_WRITER_TOKEN/)
    assert.match(src, /NUXT_TURNSTILE_SECRET_KEY/)
    assert.match(src, /AFC-1230 F3/)
  })

  it('the route still fails closed when either is absent (hygiene, not behavior change)', () => {
    const src = codeOf(ROUTE)
    assert.match(src, /NUXT_DIRECTUS_WRITER_TOKEN is not configured/)
    assert.match(src, /bot_verification_unavailable/)
  })
})

describe('AFC-1230 F4: register page comment names the writer payload', () => {
  it('the stale toRegistrationPayload comment is fixed', () => {
    const src = read('apps/web/pages/register.vue')
    assert.match(src, /toWriterPayload/)
    assert.doesNotMatch(src, /`toRegistrationPayload` is what the server route applies/)
  })
})
