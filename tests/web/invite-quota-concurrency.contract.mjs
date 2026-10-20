/**
 * AFC-516 concurrency proof — ledger-slot atomic invite quota (ADR-0011).
 *
 * Pure node:test + the repo's PGlite devDependency. Opens an in-process DB,
 * creates the bootstrap roles first (mirroring scripts/run-db-tests.mjs:
 * migrations assume directus_migrator/directus_app exist and never create
 * them), applies ONLY 20261020_0016_invite_quota_slots.sql, then fires 20
 * parallel claim loops replicating the helper protocol (day D=10, week
 * W=50): exactly 10 claim `allowed`, the remainder blocked. Then a week
 * miniature (W=2, second grain) allows exactly 2.
 *
 * Deterministic by construction: correctness rests on the UNIQUE
 * (inviter_user, period, period_start, slot_no), not on scheduling -- no
 * interleaving of INSERTs against a unique index can produce two winners
 * for one slot, so the count of winners is exact under any schedule.
 * PGlite may serialize the concurrent queries internally; that changes
 * timing, never the winner count.
 *
 * Run: node --test tests/web/invite-quota-concurrency.contract.mjs
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

let db

before(async () => {
  db = new PGlite()
  // Bootstrap roles first, mirroring scripts/run-db-tests.mjs: the
  // migration's §0 check refuses without them, and no migration may create
  // them (ADR-0002, migration-privilege gate).
  await db.exec('CREATE ROLE directus_migrator NOLOGIN')
  await db.exec('CREATE ROLE directus_app LOGIN')
  await db.exec(
    readFileSync(
      path.join(
        root,
        'services/directus/schema/migrations/20261020_0016_invite_quota_slots.sql',
      ),
      'utf8',
    ),
  )
})

after(async () => {
  await db?.close()
})

const isUniqueViolation = (error) =>
  error?.code === '23505' || /unique/i.test(String(error?.message ?? ''))

/** One claimant running the helper protocol: day slots, then week slots. */
async function claim(db, user, dayKey, weekKey, daily, weekly) {
  let daySlot = null
  for (let slot = 0; slot < daily; slot++) {
    try {
      await db.query(
        'INSERT INTO invite_quota_slots (inviter_user, period, period_start, slot_no) VALUES ($1, $2, $3, $4)',
        [user, 'day', dayKey, slot],
      )
      daySlot = slot
      break
    }
    catch (error) {
      if (!isUniqueViolation(error)) throw error
    }
  }
  if (daySlot === null) return { allowed: false }
  let weekSlot = null
  try {
    for (let slot = 0; slot < weekly; slot++) {
      try {
        await db.query(
          'INSERT INTO invite_quota_slots (inviter_user, period, period_start, slot_no) VALUES ($1, $2, $3, $4)',
          [user, 'week', weekKey, slot],
        )
        weekSlot = slot
        break
      }
      catch (error) {
        if (!isUniqueViolation(error)) throw error
      }
    }
  }
  catch (error) {
    await db.query(
      'DELETE FROM invite_quota_slots WHERE inviter_user = $1 AND period = $2 AND period_start = $3 AND slot_no = $4',
      [user, 'day', dayKey, daySlot],
    )
    throw error
  }
  if (weekSlot === null) {
    await db.query(
      'DELETE FROM invite_quota_slots WHERE inviter_user = $1 AND period = $2 AND period_start = $3 AND slot_no = $4',
      [user, 'day', dayKey, daySlot],
    )
    return { allowed: false }
  }
  return { allowed: true }
}

describe('ledger-slot concurrency: 20 parallel claimants, D=10', () => {
  it('claims exactly 10 day-winners regardless of interleaving', async () => {
    const user = crypto.randomUUID()
    const results = await Promise.all(
      Array.from({ length: 20 }, () => claim(db, user, '2026-10-20', '2026-10-19', 10, 50)),
    )
    const allowed = results.filter((r) => r.allowed).length
    assert.equal(allowed, 10, `exactly 10 of 20 parallel claimants win a day slot (got ${allowed})`)

    const rows = await db.query(
      'SELECT slot_no FROM invite_quota_slots WHERE inviter_user = $1 AND period = $2 AND period_start = $3 ORDER BY slot_no',
      [user, 'day', '2026-10-20'],
    )
    assert.deepEqual(
      rows.rows.map((r) => r.slot_no),
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      'the winners hold exactly slots 0..9 -- no gap, no duplicate, no 11th row',
    )
  })

  it('grants directus_app SELECT + INSERT + DELETE and never UPDATE', async () => {
    for (const privilege of ['SELECT', 'INSERT', 'DELETE']) {
      const rows = await db.query('SELECT has_table_privilege($1, $2, $3) AS ok', [
        'directus_app',
        'public.invite_quota_slots',
        privilege,
      ])
      assert.equal(rows.rows[0].ok, true, `directus_app holds ${privilege} on the ledger`)
    }
    const update = await db.query('SELECT has_table_privilege($1, $2, $3) AS ok', [
      'directus_app',
      'public.invite_quota_slots',
      'UPDATE',
    ])
    assert.equal(update.rows[0].ok, false, 'directus_app never holds UPDATE (slots are never mutated)')
  })
})

describe('ledger-slot concurrency: week miniature, W=2', () => {
  it('allows exactly 2 on the second grain', async () => {
    const user = crypto.randomUUID()
    const results = await Promise.all(
      Array.from({ length: 5 }, () => claim(db, user, '2026-10-20', '2026-10-19', 50, 2)),
    )
    const allowed = results.filter((r) => r.allowed).length
    assert.equal(allowed, 2, `exactly 2 of 5 parallel claimants win a week slot (got ${allowed})`)
  })
})
