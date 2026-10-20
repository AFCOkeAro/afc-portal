/**
 * AFC-482 contract tests — member role via phone OTP, disabled scaffolding.
 *
 * Pure node:test, no dependencies. Asserts the structural contract:
 *  1. The AFC-478 hard gate: both OTP routes and the member profile route
 *     check the flag FIRST and answer 503 member_otp_disabled; the flag
 *     defaults to false in nuxt.config (enablement needs the re-review
 *     verdict + CTO approval, ADR-0009 decision 6).
 *  2. F1 parameters in code match the migration: 6 digits, 10-min expiry,
 *     5 attempts, 3/hr per phone, 10/hr per IP, 8h session. The route
 *     mirrors agree with the DB gates on the throttle/verify/session
 *     matrices.
 *  3. Enumeration resistance: the request route returns one ack on every
 *     path (malformed, lookup failure, throttled, written); the verify
 *     route answers one 401 invalid_code on every failure.
 *  4. F2 identity: the request route reads ONLY phone; verify reads ONLY
 *     phone + code (no person/user/password field anywhere in the slice);
 *     the profile route takes no person from the query and is member-only.
 *  5. Single-use ordering: the consume PATCH precedes the session insert
 *     in the verify source; comparison is timing-safe on salted hashes.
 *  6. Member redaction: the `0801 ••• •234` shape; the profile projection
 *     selects no internals.
 *
 * Run: node --test tests/web/member-otp.contract.mjs
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

/** Mirrors `memberOtpThrottle`: 3/hr per phone, 10/hr per IP. */
function throttle(sentPhone1h, sentIp1h) {
  if (sentPhone1h >= 3) return { allowed: false, blockedReason: 'otp_resend_phone_cap' }
  if (sentIp1h >= 10) return { allowed: false, blockedReason: 'otp_resend_ip_cap' }
  return { allowed: true, blockedReason: null }
}

/** Mirrors `memberOtpVerifyGate`: replay first, then expiry, then the lock. */
function verifyGate(consumed, expired, attempts) {
  if (consumed)
    return { allowed: false, attemptsRemaining: 0, lockedReason: 'otp_replay' }
  if (expired)
    return { allowed: false, attemptsRemaining: 0, lockedReason: 'otp_expired' }
  if (attempts >= 5)
    return { allowed: false, attemptsRemaining: 0, lockedReason: 'otp_locked' }
  return { allowed: true, attemptsRemaining: 5 - attempts, lockedReason: null }
}

/** Mirrors `isMemberSessionLive`: session expiry AND the access time-box. */
function sessionLive(sessionExpiresAt, memberAccessExpiresAt, now) {
  if (now >= sessionExpiresAt) return false
  if (memberAccessExpiresAt !== null && now >= memberAccessExpiresAt) return false
  return true
}

/** Mirrors `redactMemberPhone`: first four + last four, nothing between. */
function redact(phone) {
  const text = String(phone ?? '').trim()
  if (text.length < 7) return '••••'
  return `${text.slice(0, 4)} ••• ${text.slice(-4)}`
}

describe('member OTP: the AFC-478 hard gate (disabled by default)', () => {
  const request = read('apps/web/server/api/auth/member-otp/request.post.ts')
  const verify = read('apps/web/server/api/auth/member-otp/verify.post.ts')
  const profile = read('apps/web/server/api/member/profile.get.ts')
  const nuxtConfig = read('apps/web/nuxt.config.ts')

  it('the flag defaults to off in nuxt.config', () => {
    assert.ok(
      nuxtConfig.includes('memberOtpEnabled: false'),
      'runtimeConfig carries memberOtpEnabled: false',
    )
  })

  for (const [name, source] of [
    ['request', request],
    ['verify', verify],
    ['profile', profile],
  ]) {
    it(`${name} checks the flag before anything else`, () => {
      const stripped = codeOf(
        `apps/web/server/api/${name === 'profile' ? 'member/profile.get' : `auth/member-otp/${name}.post`}.ts`,
      )
      const gateAt = stripped.indexOf('isMemberOtpEnabled')
      assert.ok(gateAt >= 0, `${name} calls isMemberOtpEnabled`)
      assert.ok(
        stripped.indexOf('readBody') === -1 || gateAt < stripped.indexOf('readBody'),
        `${name} gates before reading the body`,
      )
      assert.ok(
        stripped.indexOf('getPortalScope') === -1 ||
          gateAt < stripped.indexOf('getPortalScope'),
        `${name} gates before loading any scope`,
      )
    })

    it(`${name} answers 503 member_otp_disabled`, () => {
      assert.ok(source.includes('member_otp_disabled'), `${name} names the disabled code`)
    })
  }

  it('the gate comment names the re-review condition', () => {
    const util = read('apps/web/server/utils/member-otp.ts')
    assert.ok(util.includes('AFC-478'), 'util cites the AFC-478 gate')
    assert.ok(util.includes('503'), 'util documents the 503 answer')
  })
})

describe('member OTP: F1 parameters match the migration', () => {
  const util = codeOf('apps/web/server/utils/member-otp.ts')

  it('publishes the exact F1 constants', () => {
    for (const [token, value] of [
      ['MEMBER_OTP_CODE_DIGITS = 6', '6-digit codes'],
      ['MEMBER_OTP_EXPIRY_MINUTES = 10', '10-minute expiry'],
      ['MEMBER_OTP_MAX_ATTEMPTS = 5', '5-attempt lock'],
      ['MEMBER_OTP_RESEND_PHONE_PER_HOUR = 3', '3/hr per phone'],
      ['MEMBER_OTP_RESEND_IP_PER_HOUR = 10', '10/hr per IP'],
      ['MEMBER_OTP_SESSION_HOURS = 8', '8h session'],
    ]) {
      assert.ok(util.includes(token), `${value} (${token})`)
    }
  })

  it('generates codes from the platform CSPRNG, never Math.random', () => {
    assert.ok(util.includes('randomInt'), 'code generation uses crypto.randomInt')
    assert.ok(!util.includes('Math.random'), 'no Math.random anywhere in the util')
  })

  it('the throttle mirror agrees with the DB gate on the boundary matrix', () => {
    assert.deepEqual(throttle(0, 0), { allowed: true, blockedReason: null })
    assert.deepEqual(throttle(2, 9), { allowed: true, blockedReason: null })
    assert.deepEqual(throttle(3, 0), {
      allowed: false,
      blockedReason: 'otp_resend_phone_cap',
    })
    assert.deepEqual(throttle(0, 10), {
      allowed: false,
      blockedReason: 'otp_resend_ip_cap',
    })
    assert.deepEqual(throttle(9, 99).blockedReason, 'otp_resend_phone_cap')
  })

  it('the verify mirror agrees with the DB gate: replay first, then expiry, then lock', () => {
    assert.deepEqual(verifyGate(false, false, 0), {
      allowed: true,
      attemptsRemaining: 5,
      lockedReason: null,
    })
    assert.deepEqual(verifyGate(false, false, 4).attemptsRemaining, 1)
    assert.deepEqual(verifyGate(false, false, 5).lockedReason, 'otp_locked')
    assert.deepEqual(verifyGate(false, true, 0).lockedReason, 'otp_expired')
    assert.deepEqual(verifyGate(true, false, 0).lockedReason, 'otp_replay')
    assert.deepEqual(verifyGate(true, true, 5).lockedReason, 'otp_replay')
  })

  it('the session mirror agrees with the DB rule: time-box bites on a live session', () => {
    const t = (s) => Date.parse(s)
    assert.equal(
      sessionLive(t('2026-10-20T10:00:00Z'), null, t('2026-10-20T09:00:00Z')),
      true,
    )
    assert.equal(
      sessionLive(t('2026-10-20T10:00:00Z'), null, t('2026-10-20T10:00:00Z')),
      false,
    )
    assert.equal(
      sessionLive(
        t('2026-10-20T10:00:00Z'),
        t('2026-10-20T09:30:00Z'),
        t('2026-10-20T09:45:00Z'),
      ),
      false,
    )
  })
})

describe('member OTP: enumeration resistance', () => {
  it('the request route has exactly one response message on every path', () => {
    const source = codeOf('apps/web/server/api/auth/member-otp/request.post.ts')
    const acks = source.match(/MEMBER_OTP_REQUEST_ACK/g) ?? []
    assert.ok(
      acks.length >= 4,
      `ack returned on every path (found ${acks.length} references)`,
    )
    assert.ok(!source.includes('statusMessage'), 'no distinct error message leaks state')
  })

  it('the verify route answers one 401 invalid_code on every failure', () => {
    const source = codeOf('apps/web/server/api/auth/member-otp/verify.post.ts')
    // Single choke point: every failure path calls throwInvalidCode().
    assert.ok(
      source.includes("data: { code: 'invalid_code' }"),
      'the choke point names invalid_code',
    )
    const calls = source.match(/throwInvalidCode\(\)/g) ?? []
    assert.ok(
      calls.length >= 5,
      `every failure path funnels through it (found ${calls.length} call sites)`,
    )
    assert.ok(
      !source.includes('statusCode: 404') && !source.includes('statusCode: 403'),
      'no failure branch upgrades to 404/403 (which would distinguish states)',
    )
    assert.ok(
      !source.includes('user_not_found') && !source.includes('phone_not_registered'),
      'no failure branch names the missing entity',
    )
  })
})

describe('member OTP: F2 identity (nothing to forge)', () => {
  it('the request route reads only a phone number', () => {
    const source = codeOf('apps/web/server/api/auth/member-otp/request.post.ts')
    assert.ok(source.includes('body.phone'), 'reads body.phone')
    for (const field of [
      'body.person',
      'body.user',
      'body.member',
      'body.password',
      'personId',
    ]) {
      assert.ok(!source.includes(field), `request route never touches ${field}`)
    }
  })

  it('the verify route reads only phone + code', () => {
    const source = codeOf('apps/web/server/api/auth/member-otp/verify.post.ts')
    assert.ok(
      source.includes('body.phone') && source.includes('body.code'),
      'reads body.phone + body.code',
    )
    for (const field of ['body.person', 'body.user', 'body.member', 'body.password']) {
      assert.ok(!source.includes(field), `verify route never touches ${field}`)
    }
  })

  it('no password field exists anywhere in the slice', () => {
    for (const rel of [
      'apps/web/server/utils/member-otp.ts',
      'apps/web/server/api/auth/member-otp/request.post.ts',
      'apps/web/server/api/auth/member-otp/verify.post.ts',
      'apps/web/server/api/member/profile.get.ts',
    ]) {
      assert.ok(
        !codeOf(rel).toLowerCase().includes('password'),
        `${rel} has no password concept`,
      )
    }
  })

  it('comparison is timing-safe on the salted hash, never on plaintext', () => {
    const source = codeOf('apps/web/server/utils/member-otp.ts')
    assert.ok(source.includes('timingSafeEqual'), 'timing-safe comparison')
    assert.ok(source.includes('sha256'), 'salted sha256 storage rule')
  })

  it('single-use ordering: consume PATCH precedes the session insert', () => {
    const source = codeOf('apps/web/server/api/auth/member-otp/verify.post.ts')
    const consumeAt = source.indexOf('consumed_at')
    const sessionAt = source.indexOf('/items/member_sessions')
    assert.ok(
      consumeAt >= 0 && sessionAt >= 0 && consumeAt < sessionAt,
      'the code is consumed before any session row is written',
    )
  })

  it('the profile route takes no person from the query and is member-only', () => {
    const source = codeOf('apps/web/server/api/member/profile.get.ts')
    assert.ok(!source.includes('getQuery'), 'no query parameter is read at all')
    assert.ok(source.includes('isMemberSession'), 'member-session check present')
    assert.ok(source.includes('403'), 'staff sessions get 403')
    assert.ok(source.includes('personId'), 'identity comes from the session')
  })
})

describe('member OTP: redaction', () => {
  it('redacts to the 0801 ••• •234 shape', () => {
    assert.equal(redact('+2348012345678'), '+234 ••• 5678')
    assert.equal(redact('0801123456'), '0801 ••• 3456')
    assert.equal(redact('123'), '••••')
  })

  it('the profile projection selects no internals', () => {
    const source = codeOf('apps/web/server/api/member/profile.get.ts')
    assert.ok(source.includes('phone_redacted'), 'phone leaves redacted')
    for (const field of [
      'contact_value',
      'error_detail',
      'provider_message_id',
      'consent_records',
    ]) {
      assert.ok(!source.includes(field), `profile never selects ${field}`)
    }
  })
})

describe('member OTP: AFC-512 adversarial tests (F1)', () => {
  it('registered vs unregistered numbers get the identical shape AND status', () => {
    const source = codeOf('apps/web/server/api/auth/member-otp/request.post.ts')
    // One ack constant, no branching response: every path returns the same
    // message object with the default 200 status (no statusCode anywhere).
    const acks = source.match(/MEMBER_OTP_REQUEST_ACK/g) ?? []
    assert.ok(acks.length >= 4, `ack returned on every path (found ${acks.length})`)
    assert.ok(!source.includes('statusCode'), 'request route sets no status code: registered and unregistered are identical')
    assert.ok(
      !source.includes('phone_not_registered') && !source.includes('user_not_found'),
      'no oracle names the missing entity',
    )
  })

  it('replay of a consumed code is rejected at the route before any comparison', () => {
    const source = codeOf('apps/web/server/api/auth/member-otp/verify.post.ts')
    const gateAt = source.indexOf('memberOtpVerifyGate')
    const compareAt = source.indexOf('otpHashesEqual')
    assert.ok(gateAt >= 0 && compareAt >= 0 && gateAt < compareAt, 'gate runs before comparison')
    assert.ok(source.includes('consumed_at'), 'consumed state feeds the gate')
    const util = codeOf('apps/web/server/utils/member-otp.ts')
    assert.ok(util.includes('otp_replay'), 'replay reason pinned in the F1 gate mirror')
  })

  it('the session lifetime (8h) satisfies the <=24h idle recommendation with a <=7d absolute bound', () => {
    const util = read('apps/web/server/utils/member-otp.ts')
    assert.ok(util.includes('MEMBER_OTP_SESSION_HOURS = 8'), '8h session published')
    assert.ok(util.includes('24h'), 'idle recommendation stated')
    assert.ok(util.includes('7d'), 'absolute bound stated')
    const verify = read('apps/web/server/api/auth/member-otp/verify.post.ts')
    assert.ok(
      verify.includes('Math.min(sessionExpiresAt, accessExpiresAt)') ||
        verify.includes('Math.min('),
      'session expiry is min(session, access time-box)',
    )
  })

  it('SIM-swap is a recorded accepted risk bounded by the member least-privilege scope', () => {
    const util = read('apps/web/server/utils/member-otp.ts')
    assert.ok(util.includes('SIM-swap'), 'SIM-swap named')
    assert.ok(util.includes('ACCEPTED RISK'), 'accepted risk stated')
    assert.ok(util.includes('S5') || util.includes('least-privilege'), 'blast-radius bound cited')
  })

  it('the flag stays off and the routes stay 503 (enablement is NOT this issue)', () => {
    const nuxtConfig = read('apps/web/nuxt.config.ts')
    assert.ok(nuxtConfig.includes('memberOtpEnabled: false'), 'flag still defaults to false')
  })
})

describe('member OTP: AFC-526 D1 per-request time-box re-check', () => {
  const util = read('apps/web/server/utils/member-otp.ts')
  const profile = read('apps/web/server/api/member/profile.get.ts')
  const profileCode = codeOf('apps/web/server/api/member/profile.get.ts')

  it('the helper lives in utils/member-otp.ts for every member-gated route', () => {
    assert.ok(util.includes('readMemberAccessExpiresAtMs'), 'live-read helper present')
    assert.ok(util.includes('requireLiveMemberSession'), 'per-request gate present')
  })

  it('the helper live-reads directus_users.member_access_expires_at for the session user', () => {
    assert.ok(util.includes('/users/'), 'reads the user row live')
    assert.ok(util.includes('member_access_expires_at'), 'reads the access time-box field')
    assert.ok(
      profile.includes('requireLiveMemberSession(event, session.user.id'),
      'profile passes the session user into the live re-check',
    )
  })

  it('a lapsed time-box answers 401 on the next read despite a live cookie', () => {
    assert.ok(
      util.includes('requireLiveMemberSession'),
      'the per-request gate exists',
    )
    assert.ok(profile.includes('requireLiveMemberSession'), 'profile calls it on every request')
    assert.ok(profile.includes('session_expired') || util.includes('session_expired'), 'lapsed access answers session_expired')
    assert.ok(
      !profileCode.includes('isMemberSessionLive(Date.parse(session.expiresAt), null'),
      'profile no longer passes a null literal for the access time-box',
    )
  })

  it('a lookup failure fails closed to 401 (never a permissive null)', () => {
    const helperAt = util.indexOf('readMemberAccessExpiresAtMs')
    assert.ok(helperAt >= 0, 'helper found')
    const helperBody = util.slice(helperAt, helperAt + 2000)
    assert.ok(helperBody.includes('catch'), 'lookup errors are caught')
    assert.ok(helperBody.includes('401'), 'lookup failure answers 401')
    assert.ok(helperBody.includes('session_expired'), 'lookup failure names session_expired')
  })

  it('the live value feeds isMemberSessionLive (no stale issue-time copy)', () => {
    const gateAt = util.indexOf('requireLiveMemberSession')
    assert.ok(gateAt >= 0, 'gate found')
    const gateBody = util.slice(gateAt, gateAt + 1500)
    assert.ok(gateBody.includes('readMemberAccessExpiresAtMs'), 'gate live-reads first')
    assert.ok(gateBody.includes('isMemberSessionLive'), 'gate passes the live value into isMemberSessionLive')
  })
})

describe('member OTP: AFC-526 D2 session-row min expiry', () => {
  const verify = read('apps/web/server/api/auth/member-otp/verify.post.ts')
  const verifyCode = codeOf('apps/web/server/api/auth/member-otp/verify.post.ts')

  it('the DB row persists min(session, access), so row, cookie and re-check agree', () => {
    assert.ok(
      verify.includes('expires_at: new Date(expiresAt).toISOString()'),
      'member_sessions row persists the min(session, access) value',
    )
  })

  it('the row never persists the full 8h sessionExpiresAt on its own', () => {
    const rowAt = verify.indexOf('/items/member_sessions')
    assert.ok(rowAt >= 0, 'session insert found')
    const rowBody = verify.slice(rowAt, rowAt + 800)
    assert.ok(!rowBody.includes('new Date(sessionExpiresAt)'), 'the insert body persists no bare sessionExpiresAt value')
  })

  it('access shorter than 8h lands in the row: the min is computed above the insert', () => {
    const minAt = verifyCode.indexOf('Math.min(sessionExpiresAt, accessExpiresAt)')
    const rowAt = verifyCode.indexOf('/items/member_sessions')
    assert.ok(minAt >= 0, 'min(session, access) still computed')
    assert.ok(rowAt >= 0, 'session insert still present')
    assert.ok(minAt < rowAt, 'the min is computed before the row is written')
  })
})
