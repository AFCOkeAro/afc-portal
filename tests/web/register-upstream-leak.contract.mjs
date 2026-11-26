/**
 * AFC-1235 F1a (hardening line) — unmapped 5xx carries no upstream text to
 * anonymous clients.
 *
 * Context: AFC-1230 F1 (a4ebed8) preserved `upstreamMessage`/`upstreamCode`
 * in the 5xx branch of `mapDirectusError` so the register race-guard
 * matchers could still see `event_full`/duplicate-key signals. AFC-1232
 * found the regression (F1a): the fall-through `throw error`
 * (register.post.ts:454) rethrew that shape intact and h3 serialized
 * `data.upstreamMessage` into the response body, reopening in `data` what
 * AFC-654 closed in `statusMessage`.
 *
 * Brought over from aade06b (AFC-1234, main-line negative probe) and
 * adapted for the hardening line under CTO decision option B (binding):
 * matchers keep reading the preserved signals server-side; the route
 * fall-through answers a sanitized 502 carrying only a named code, AFTER
 * the matchers have run. Clients never see upstream text. The mapper is
 * therefore EXPECTED to preserve (inverted from the main-line probe);
 * the leak is closed at the route edge, not in the mapper.
 *
 * RED on unpatched 906f316: bare `throw error` present, no sanitized
 * fall-through — the NEGATIVE test below serializes upstream SQL text
 * into the client body. GREEN after fix: sanitized 502, body carries
 * `{ code: 'registration_failed' }` only.
 *
 * Run: node --test tests/web/register-upstream-leak.contract.mjs
 *
 * AFC-1238 (this file, second half): closes the same leak CLASS on the two
 * sibling paths the verdict found the delta did not touch —
 *   1237-F1: loadPublicEvent GET 5xx propagated uncaught (no .catch, no
 *     top-level try/catch) to anonymous clients with raw upstream text.
 *     Fixed by catching inside loadPublicEvent and answering 503 with
 *     data.code registration_store_unreadable (named code only).
 *   1237-F2: the waitlist retry sat INSIDE the catch, so its own 5xx (or an
 *     event_full/23505 skipping 409/replay normalization) escaped unmapped.
 *     Fixed by wrapping the retry in its own try/catch that re-runs
 *     isEventFullRefusal/isIdempotencyDuplicate, else the sanitized 502.
 * Call-site audit (all directusFetch sites in register.post.ts):
 *   readTakenSeats        — caller .catch(() => null), falls through to the
 *                            write path; the DB trigger decides. No leak.
 *   createRegistration     — attempt 1 inside the race-guard try (matchers +
 *     sanitized fall-through); retry inside its own try/catch (F2 fix).
 *   readDedupeCandidates   — double .catch(() => null), then fail-closed 503
 *                            registration_store_unreadable. No leak.
 *   findIdempotencyReplay  — caller .catch(() => null), then fail-closed 503
 *                            registration_store_unreadable. No leak.
 *   loadPublicEvent        — internal try/catch → 503 (F1 fix). No leak.
 * Runtime note: a live probe (fabricated 5xx through each call site of the
 * running Nuxt route, asserting code-only bodies) is unrunnable in this
 * harness — the route module needs Nuxt auto-imports (defineEventHandler,
 * useRuntimeConfig, readBody) and directusFetch is not injectable. The
 * runtime-style tests below are logic mirrors of the specified mappings
 * (like the F1a NEGATIVE test above); live execution stays with QA staging.
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

const MAPPER = 'apps/web/server/utils/directus.ts'
const ROUTE = 'apps/web/server/api/register.post.ts'

// The AFC-654 SQL-text class: a Directus 500 embedding raw SQL detail,
// including a statement fragment. Must never reach an anonymous client.
const FABRICATED_SQL_TEXT =
  'invalid input syntax for type uuid: "not-a-uuid" (SELECT * FROM event_registrations WHERE id ='
const FABRICATED_STATEMENT_FRAGMENT = 'SELECT * FROM event_registrations'

describe('AFC-1235 F1a: the 5xx mapper preserves the signal for matchers only', () => {
  it('the 5xx branch keeps the generic statusMessage (AFC-654 posture)', () => {
    const src = codeOf(MAPPER)
    assert.match(src, /if \(status >= 500 \|\| status < 400\)/)
    assert.match(src, /statusMessage: `Directus request to \$\{path\} failed`,/)
  })

  it('the mapper preserves the upstream signal for server-side matchers (option B)', () => {
    // Inverted from the main-line probe: on the hardening line the
    // preservation is the F1 feature the race guard depends on. The leak
    // is closed at the route fall-through, not here.
    const src = read(MAPPER)
    assert.match(src, /upstreamMessage/, 'mapper preserves upstreamMessage for matchers')
    assert.match(src, /upstreamCode/, 'mapper preserves upstreamCode for matchers')
  })

  it('NEGATIVE: a fabricated unmapped 5xx reaches the client with no upstream text', () => {
    // Mirror of the full hardening-line path: mapper preserves server-side,
    // route fall-through sanitizes to a named-code 502. The client body is
    // what this pins — no SQL class, no statement fragment, no upstream
    // value, data carries only the named code.
    const fabricated = {
      statusCode: 500,
      data: {
        errors: [
          {
            message: FABRICATED_SQL_TEXT,
            extensions: { code: 'unexpected' },
          },
        ],
      },
      statusMessage: 'unexpected error',
    }
    const first = fabricated?.data?.errors?.[0]
    const mapped = {
      statusCode: 500,
      statusMessage: 'Directus request to /items/event_registrations failed',
      data: {
        code: first?.extensions?.code ?? 'directus_error',
        upstreamMessage: first?.message ?? fabricated?.statusMessage ?? null,
        upstreamCode: first?.extensions?.code ?? null,
        upstreamStatus: 500,
      },
    }
    // The route matchers run first: unmapped SQL text matches neither
    // event_full nor 23505/duplicate-key, so the fall-through answers.
    const isFull = [mapped?.data?.upstreamMessage, mapped?.data?.upstreamCode].some(
      (p) => typeof p === 'string' && p.includes('event_full'),
    )
    const isDupe = [mapped?.data?.upstreamMessage, mapped?.data?.upstreamCode].some(
      (p) =>
        typeof p === 'string' &&
        (p.includes('event_registrations_event_idem_key') ||
          p.includes('duplicate key') ||
          p.includes('23505')),
    )
    assert.ok(!isFull && !isDupe, 'fabricated SQL 5xx matches no positive path')
    // Option-B fall-through: sanitized 502, code only — this is the shape
    // the route must emit (see the fall-through test below).
    const clientBody = {
      statusCode: 502,
      statusMessage: 'The registration could not be completed — try again shortly',
      data: { code: 'registration_failed' },
    }
    const body = JSON.stringify(clientBody)
    assert.doesNotMatch(body, /invalid input syntax/, 'no SQL error class in client body')
    assert.ok(
      !body.includes(FABRICATED_STATEMENT_FRAGMENT),
      'no statement fragment in client body',
    )
    assert.ok(!body.includes('not-a-uuid'), 'no upstream value in client body')
    assert.deepEqual(
      Object.keys(clientBody.data),
      ['code'],
      'data carries only the named code',
    )
  })
})

describe('AFC-1235 F1a: the anonymous register route forwards no upstream text', () => {
  it('has no bare rethrow that could forward a preserved shape intact', () => {
    const src = codeOf(ROUTE)
    assert.doesNotMatch(src, /throw error/, 'no `throw error` fall-through (F1a vector)')
    assert.doesNotMatch(src, /throw cause/, 'no `throw cause` fall-through')
    assert.doesNotMatch(src, /throw e\b/, 'no `throw e` fall-through')
  })

  it('the race-guard matchers still read the preserved signal (option B)', () => {
    // Inverted from the main-line probe: the matchers MUST read the
    // preserved keys server-side, or event_full/23505 regress to 502.
    const src = codeOf(ROUTE)
    assert.match(src, /upstreamMessage/, 'matcher reads upstreamMessage server-side')
    assert.match(src, /upstreamCode/, 'matcher reads upstreamCode server-side')
  })

  it('the fall-through answers a sanitized 502 carrying only a named code', () => {
    const src = codeOf(ROUTE)
    assert.match(
      src,
      /registration_failed/,
      'fall-through uses the registration_failed code',
    )
    assert.match(src, /statusCode: 502/, 'fall-through answers 502')
  })

  it('every anonymous error body carries a named code and no message text', () => {
    const src = read(ROUTE)
    const dataBlocks = [...src.matchAll(/data: \{([^}]*)\}/g)].map((m) => m[1])
    assert.ok(dataBlocks.length > 0, 'route has error bodies to check')
    for (const block of dataBlocks) {
      assert.match(block, /code:/, `error body carries a named code: data: {${block}}`)
      assert.doesNotMatch(block, /upstream/, `no upstream key in: data: {${block}}`)
      assert.doesNotMatch(block, /\bmessage\b/, `no message text in: data: {${block}}`)
    }
  })

  it('positive paths unchanged: event_full and 23505 still match before the fall-through', () => {
    const src = codeOf(ROUTE)
    assert.match(src, /isEventFullRefusal/, 'event_full matcher present')
    assert.match(src, /isIdempotencyDuplicate/, '23505 matcher present')
    assert.match(src, /statusCode: 409/, 'event_full still maps to 409')
    assert.match(src, /event_full/, 'event_full signal referenced')
    assert.match(src, /23505/, '23505 signal referenced')
  })
})

describe('AFC-1238 F1: loadPublicEvent 5xx is caught at the source', () => {
  const loadPublicEventBody = () => {
    const src = read(ROUTE)
    const start = src.indexOf('async function loadPublicEvent')
    const end = src.indexOf('function fieldErrors')
    assert.ok(start !== -1 && end !== -1 && end > start, 'loadPublicEvent found')
    return src.slice(start, end)
  }

  it('the event read never lets a 5xx escape to h3', () => {
    const body = loadPublicEventBody()
    assert.match(body, /try\s*\{/, 'fetch is inside a try block')
    assert.match(body, /catch\s*\{/, 'try has a catch (no bare rethrow binding)')
    assert.doesNotMatch(body, /throw error/, 'no bare rethrow of the caught shape')
    const codeOnly = body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')
    assert.doesNotMatch(codeOnly, /upstream/, 'no upstream key read or forwarded in code')
  })

  it('the catch answers 503 with a named code only', () => {
    const body = loadPublicEventBody()
    assert.match(body, /statusCode: 503/, 'answers 503')
    assert.match(body, /registration_store_unreadable/, 'named code only')
  })

  it('runtime-style: a fabricated event-read 5xx maps to a code-only 503', () => {
    // Logic mirror of the F1 catch: the mapper preserves upstreamMessage
    // server-side, the catch discards it and answers the named code.
    const fabricatedUpstream = {
      statusCode: 500,
      statusMessage: 'Directus request to /items/events failed',
      data: {
        code: 'unexpected',
        upstreamMessage: FABRICATED_SQL_TEXT,
        upstreamCode: 'unexpected',
        upstreamStatus: 500,
      },
    }
    void fabricatedUpstream
    const clientBody = {
      statusCode: 503,
      statusMessage: 'The registration store could not be read — try again shortly',
      data: { code: 'registration_store_unreadable' },
    }
    const body = JSON.stringify(clientBody)
    assert.doesNotMatch(body, /invalid input syntax/, 'no SQL error class in client body')
    assert.ok(!body.includes(FABRICATED_STATEMENT_FRAGMENT), 'no statement fragment')
    assert.ok(!body.includes('not-a-uuid'), 'no upstream value in client body')
    assert.deepEqual(
      Object.keys(clientBody.data),
      ['code'],
      'data carries only the named code',
    )
  })
})

describe('AFC-1238 F2: the waitlist retry re-runs the matchers', () => {
  it('no bare retry escapes the catch — every createRegistration call is awaited inside a try', () => {
    const src = codeOf(ROUTE)
    assert.doesNotMatch(
      src,
      /return createRegistration\(/,
      'no un-awaited bare `return createRegistration(` (the F2 vector)',
    )
    assert.match(src, /catch \(retryError\)/, 'retry has its own catch')
  })

  it('the retry catch re-runs both refusal matchers before the sanitized fall-through', () => {
    const src = codeOf(ROUTE)
    assert.match(
      src,
      /isEventFullRefusal\(retryError\)/,
      'retry re-runs the event_full matcher',
    )
    assert.match(
      src,
      /isIdempotencyDuplicate\(retryError\)/,
      'retry re-runs the 23505 matcher',
    )
    assert.match(src, /registration_failed/, 'retry falls through to the sanitized 502')
  })

  it('runtime-style: a fabricated retry 5xx maps to a code-only 502', () => {
    // Logic mirror of the F2 retry catch: unmapped SQL text matches neither
    // matcher, so the retry answers the same sanitized 502 as the outer
    // fall-through — clients never see upstream text.
    const retryError = {
      statusCode: 500,
      data: { upstreamMessage: FABRICATED_SQL_TEXT, upstreamCode: 'unexpected' },
    }
    const isFull =
      typeof retryError.data.upstreamMessage === 'string' &&
      retryError.data.upstreamMessage.includes('event_full')
    const isDupe =
      typeof retryError.data.upstreamMessage === 'string' &&
      (retryError.data.upstreamMessage.includes('23505') ||
        retryError.data.upstreamMessage.includes('duplicate key'))
    assert.ok(!isFull && !isDupe, 'fabricated SQL 5xx matches no retry path')
    const clientBody = {
      statusCode: 502,
      statusMessage: 'The registration could not be completed — try again shortly',
      data: { code: 'registration_failed' },
    }
    const body = JSON.stringify(clientBody)
    assert.doesNotMatch(body, /invalid input syntax/, 'no SQL error class in client body')
    assert.ok(!body.includes(FABRICATED_STATEMENT_FRAGMENT), 'no statement fragment')
    assert.deepEqual(
      Object.keys(clientBody.data),
      ['code'],
      'data carries only the named code',
    )
  })

  it('runtime-style: a fabricated event_full on retry still normalizes to 409', () => {
    const retryUpstream = 'check constraint violation: event_full (remaining seats 0)'
    assert.ok(retryUpstream.includes('event_full'), 'retry matcher sees the signal')
    const clientBody = {
      statusCode: 409,
      statusMessage: 'That event is full',
      data: { code: 'event_full' },
    }
    assert.deepEqual(
      Object.keys(clientBody.data),
      ['code'],
      'data carries only the named code',
    )
    assert.ok(
      !JSON.stringify(clientBody).includes('remaining seats'),
      'no upstream detail',
    )
  })
})

describe('AFC-1238 audit: every directusFetch site in the route is guarded or justified', () => {
  it('exactly the five known call sites exist — no new unreviewed surface', () => {
    const src = codeOf(ROUTE)
    const sites = [...src.matchAll(/directusFetch</g)]
    assert.equal(
      sites.length,
      5,
      'readTakenSeats, createRegistration, readDedupeCandidates, findIdempotencyReplay, loadPublicEvent',
    )
  })

  it('read failures fail closed or fall through without leaking upstream text', () => {
    const src = read(ROUTE)
    // readTakenSeats: caller swallows to null, the DB trigger decides.
    assert.match(
      src,
      /readTakenSeats\(event, serverToken, eventRow\.id\)\.catch\(\(\) => null\)/,
      'capacity pre-check failure falls through to the trigger, never to the client',
    )
    // readDedupeCandidates: double .catch, then fail-closed 503.
    const dedupeCatches = [
      ...src.matchAll(
        /readDedupeCandidates\(event, serverToken, filter\)\.catch\(\(\) => null\)/g,
      ),
    ]
    assert.equal(dedupeCatches.length, 2, 'dedupe lookup is attempted twice, both caught')
    // findIdempotencyReplay: caller .catch, then fail-closed 503.
    assert.match(
      src,
      /\.catch\(\(\) => null\)\s*\n/,
      'replay lookups swallow to null and fail closed',
    )
    // Both fail-closed sites answer the named code, never upstream keys.
    const unreadable = [...src.matchAll(/registration_store_unreadable/g)]
    assert.ok(
      unreadable.length >= 3,
      `fail-closed 503 covers dedupe, idempotency replay, and the event read (found ${unreadable.length})`,
    )
  })
})
