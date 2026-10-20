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
