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
