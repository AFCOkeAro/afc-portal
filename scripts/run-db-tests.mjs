#!/usr/bin/env node
// scripts/run-db-tests.mjs
//
// Runs the database control tests for incidents.awareness_at (AFC-166).
//
//   pnpm test:db                     local: an in-process PostgreSQL 16
//   PG_URL=postgres://... pnpm test:db
//                                    CI: an existing instance
//   node scripts/run-db-tests.mjs --self-test
//                                    watch this instrument fail (AFC-203)
//
// One code path, so local and CI assert the same things.
//
// The instance is bootstrapped the way production has to be bootstrapped:
// migrations run as directus_migrator, which owns the tables, while Directus
// connects as directus_app, which owns nothing. If those were the same role the
// guard trigger would be one DISABLE TRIGGER away from gone and these tests
// would not be able to tell.
//
// Local mode uses PGlite (PostgreSQL 16 compiled to WebAssembly) because the
// dev sandbox has no container runtime and initdb refuses to run as root. CI
// runs the identical suite against a real postgres:16 service container. The
// semantics under test -- column-level grants, DISABLE TRIGGER ownership,
// TRUNCATE bypassing row triggers -- are the same in both.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(REPO, 'services/directus/schema/migrations');
// The engine is NOT a migration. It is behaviour that can be replaced without
// a schema-history entry, and it is deliberately outside the directory the
// retention-literal gate exempts -- that separation is what makes the gate
// meaningful, because the migrations are allowed to state a period and the
// engine is not.
const ENGINE = join(REPO, 'services/directus/schema/engine');
const TESTS = join(REPO, 'tests/db');

const log = (...a) => console.log(...a);

// ---------------------------------------------------------------------------
// THE LEDGER (AFC-203)
//
// The ledger is the stream of assertion outcomes the harness raises as NOTICE
// messages, collected here independently of the transaction that produced them.
// It was a table -- test_support.results -- and that made it structurally
// incapable of reporting a failure: the harness INSERTed the outcome and then
// RAISEd, and each suite file is one implicit transaction, so the RAISE rolled
// the INSERT back. A failing suite persisted zero rows.
//
// Therefore `notOk` (rows with ok = false) was always 0, the summary line's
// "0 failing" was a tautology rather than a measurement, and every run of this
// suite had printed it -- including the runs that failed on an assertion.
//
// A NOTICE is not transactional, so an outcome survives the rollback that
// destroys the work it describes. That buys two properties the table never had:
//   * `notOk` is a real count, so "N failing" can be non-zero and means it;
//   * the reported assertion COUNT equals the number of assertions ATTEMPTED on
//     a red run as well as a green one, because every attempt emits exactly one
//     notice before the RAISE. A suite that dies at its first assertion now
//     contributes 1, and the assertions after it are visibly never evaluated.
//
// The marker and the payload shape are shared with tests/db/assert.sql. Both
// sides have to agree or the ledger empties silently, which is what
// --self-test exists to catch.
// ---------------------------------------------------------------------------
const MARKER = 'AFC_ASSERT/1 ';

/**
 * One notice -> one assertion outcome.
 *
 *   null            not an assertion message at all (driver chatter, any other
 *                   NOTICE the engine raises) -- ignored, by design
 *   { row }         a well-formed assertion outcome
 *   { malformed }   a message that CLAIMS to be an assertion and cannot be read
 *
 * Malformed is not ignored. Dropping it would under-report the count, which is
 * the same defect in the opposite direction: a ledger that quietly loses an
 * assertion looks exactly like a ledger with fewer assertions. The marker means
 * the harness meant to record something, so a record the runner cannot read is
 * a broken instrument and the run fails loudly.
 */
function parseAssertion(message) {
  if (typeof message !== 'string' || !message.startsWith(MARKER)) return null;
  const raw = message.slice(MARKER.length);
  let p;
  try {
    p = JSON.parse(raw);
  } catch {
    return { malformed: raw.slice(0, 200) };
  }
  if (
    p === null ||
    typeof p !== 'object' ||
    typeof p.suite !== 'string' ||
    typeof p.name !== 'string' ||
    typeof p.ok !== 'boolean'
  ) {
    return { malformed: raw.slice(0, 200) };
  }
  return { row: { suite: p.suite, name: p.name, ok: p.ok, detail: p.detail ?? null } };
}

/** Notices -> assertion outcomes, in the order they were attempted. */
function parseLedger(messages) {
  const rows = [];
  const malformed = [];
  for (const m of messages) {
    const a = parseAssertion(m);
    if (a === null) continue;
    if (a.malformed !== undefined) malformed.push(a.malformed);
    else rows.push(a.row);
  }
  return { rows, malformed };
}

/**
 * The exit status, as a function, so that --self-test can assert on it instead
 * of guessing. `failed > 0` catches a suite that died on a SQL error before it
 * asserted anything; `notOk > 0` catches an assertion that failed.
 */
function exitCodeFor(failed, rows) {
  return failed > 0 || rows.some((r) => !r.ok) ? 1 : 0;
}

/** Two drivers behind one small interface: exec(multiStatement), query(sql).rows, drain() */
async function connect() {
  const external = process.env.PG_URL;
  if (external) {
    const { Client } = await import('pg');
    const client = new Client({ connectionString: external });
    // node-postgres re-emits every NOTICE the backend raises on the client, in
    // the order it raised them, before the in-flight query settles -- so a
    // notice raised by the statement that is about to fail has already been
    // collected by the time the rejection lands. No privileges needed.
    const notes = [];
    client.on('notice', (m) => notes.push(String(m.message)));
    await client.connect();
    const v = await client.query('SELECT version()');
    log(`Connected to ${new URL(external).host}`);
    log(`Server: ${v.rows[0].version}`);
    return {
      version: v.rows[0].version,
      exec: async (sql) => { await client.query(sql); },
      query: async (sql) => (await client.query(sql)).rows,
      drain: () => notes.splice(0, notes.length),
      close: async () => { await client.end(); },
    };
  }

  let PGlite;
  try {
    ({ PGlite } = await import('@electric-sql/pglite'));
  } catch {
    console.error('No PG_URL set and @electric-sql/pglite is not installed.');
    console.error('Run `pnpm install`, or set PG_URL to an existing PostgreSQL 16.');
    process.exit(2);
  }
  const db = new PGlite();
  // onNotice MUST be passed per call. PGlite accepts one in the constructor and
  // does not fire it -- the ledger comes back empty and every assertion count
  // reads 0, with no error anywhere. Measured, not guessed; the trap is silent
  // and that is why the self-test asserts on the ledger rather than on the
  // absence of a crash.
  const notes = [];
  const onNotice = (n) => notes.push(String(n.message));
  const v = await db.query('SELECT version()');
  log('Local mode: in-process PostgreSQL, no service container, nothing left on disk');
  log(`Server: ${v.rows[0].version}`);
  return {
    version: v.rows[0].version,
    exec: async (sql) => { await db.exec(sql, { onNotice }); },
    query: async (sql) => (await db.query(sql, [], { onNotice })).rows,
    drain: () => notes.splice(0, notes.length),
    close: async () => { await db.close(); },
  };
}

const loadSql = (p) => readFileSync(p, 'utf8');

// The suites use psql's \i to include a migration, so the files stay runnable
// with psql unchanged. Expand it here.
function expandIncludes(sql, depth = 0) {
  if (depth > 6) throw new Error('\\i nesting too deep');
  return sql.replace(/^[ \t]*\\i[ \t]+(\S+)[ \t]*$/gm, (_, rel) => {
    log(`      \\i ${rel}`);
    return expandIncludes(loadSql(resolve(REPO, rel)), depth + 1);
  });
}

/**
 * Run suites and report how each one ended. `suites` is [{ file, sql }] rather
 * than a directory so that --self-test can drive the same path with an
 * in-memory suite instead of planting a file in tests/db that a real run would
 * then pick up.
 */
async function runSuites(db, suites) {
  let failed = 0;
  let passed = 0;
  for (const { file, sql } of suites) {
    try {
      await db.exec(sql);
      log(`  ok   ${file}`);
      passed++;
    } catch (e) {
      // position/where are what make a SQL failure locatable in a 200-line file
      const at = e.position ? ` (position ${e.position}${e.where ? `, ${e.where.trim()}` : ''})` : '';
      console.error(`  FAIL ${file}\n       ${e.message}${at}`);
      failed++;
    }
  }
  return { passed, failed };
}

/** Print the ledger, print the summary, return the exit status. */
function report(rows, passed, failed) {
  log('\nAssertions');
  let suite = null;
  for (const r of rows) {
    if (r.suite !== suite) { suite = r.suite; log(`\n  [${suite}]`); }
    log(`   ${r.ok ? 'pass' : 'FAIL'}  ${r.name}`);
    if (!r.ok) log(`         ${r.detail}`);
  }
  const notOk = rows.filter((r) => !r.ok).length;
  log(`\n${passed} suites passed, ${failed} failed, ${rows.length} assertions, ${notOk} failing`);
  return exitCodeFor(failed, rows);
}

// Session TimeZone pin. DEFENCE IN DEPTH, NOT THE FIX (AFC-202).
//
// Four assertions in 30_backfill_survival.sql compared a `timestamptz` rendered
// with `::text` against literals pinned to '+00'. `timestamptz::text` renders in
// the SESSION TimeZone, so those assertions only held on a UTC session. PGlite
// is GMT and GitHub Actions' ubuntu-latest is UTC, so the suite went green in
// CI by accident of the runner's clock rather than because the assertion was
// right -- the worst possible failure mode for NDPA s.40(2) legal evidence.
// Those assertions now compare INSTANTS (`timestamptz = timestamptz`), which is
// session-TimeZone independent, and the whole tree is green under
// DB_TEST_TIMEZONE=Africa/Lagos with this pin set to Lagos or removed.
//
// The pin is here for the assertions that legitimately look at a RENDERING --
// a to_char, a ::text cast, a ::date -- so that such a test checks the same
// thing on every host instead of on whatever the host happened to be set to.
//
//   pnpm test:db                                  # UTC (default)
//   DB_TEST_TIMEZONE=Africa/Lagos pnpm test:db    # non-UTC session, same asserts
//
// The value is a session setting, so it is validated rather than interpolated:
// this is an environment variable, and it is still an environment variable.
const SESSION_TZ = process.env.DB_TEST_TIMEZONE ?? 'UTC';
const TZ_OK = /^[A-Za-z0-9_+:-]+(\/[A-Za-z0-9_+:-]+)*$/;

async function main() {
  if (!TZ_OK.test(SESSION_TZ)) {
    console.error(`DB_TEST_TIMEZONE is not a TimeZone value: ${JSON.stringify(SESSION_TZ)}`);
    process.exit(2);
  }
  const db = await connect();
  let failed = 0;
  let passed = 0;
  let rows = [];

  try {
    await db.exec(`SET TIME ZONE '${SESSION_TZ}'`);
    log(`Session TimeZone pinned to ${SESSION_TZ}`);
    // ---------------------------------------------------------------
    // Roles, as the bootstrap superuser. After this the migrations run as
    // directus_migrator and own everything they create.
    // ---------------------------------------------------------------
    log('\nBootstrapping roles');
    await db.exec(`
      DO $bootstrap$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'directus_migrator') THEN
          CREATE ROLE directus_migrator NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'directus_app') THEN
          CREATE ROLE directus_app LOGIN;
        END IF;
        -- Retention worker. Bootstrap role, created here for the same reason as
        -- the two above: a migration runs as directus_migrator, which does not
        -- hold CREATEROLE, so a migration cannot create its own executor role.
        -- Getting this wrong in production is a migration that fails loudly with
        -- "retention_worker is missing" rather than an engine nobody can run.
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'retention_worker') THEN
          CREATE ROLE retention_worker NOLOGIN;
        END IF;
      END
      $bootstrap$;

      -- PostgreSQL 15+ gives PUBLIC no CREATE on the public schema, so the
      -- migration role is granted it explicitly. The runtime role gets USAGE
      -- only: it reads and writes, it does not create objects.
      GRANT USAGE, CREATE ON SCHEMA public TO directus_migrator;
      GRANT USAGE ON SCHEMA public TO directus_app;

      -- The engine schema, owned by the migration role. Bootstrap creates it
      -- for the same reason it creates roles: a migration runs as
      -- directus_migrator, which has no CREATE on the database, so the engine
      -- install could not create its own schema. Owned (not just USAGE'd) so
      -- the engine can install into it.
      CREATE SCHEMA IF NOT EXISTS retention AUTHORIZATION directus_migrator;
    `);

    // ---------------------------------------------------------------
    // Migrations, as the table owner.
    // ---------------------------------------------------------------
    const migrationFiles = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
    log('\nApplying migrations as directus_migrator (table owner)');
    for (const file of migrationFiles) {
      try {
        await db.exec('SET ROLE directus_migrator');
        await db.exec(loadSql(join(MIGRATIONS, file)));
        log(`  ok   ${file}`);
      } catch (e) {
        console.error(`\n  FAIL ${file} did not apply\n       ${e.message}\n`);
        process.exitCode = 1;
        throw e;
      } finally {
        try { await db.exec('RESET ROLE'); } catch { /* connection is going away anyway */ }
      }
    }

    // ---------------------------------------------------------------
    // Retention engine, as the owner role. Same split: the engine is
    // SECURITY DEFINER and runs with the owner's rights, so the worker
    // role that calls it needs no DELETE grant of its own.
    // ---------------------------------------------------------------
    const engineFiles = existsSync(ENGINE)
      ? readdirSync(ENGINE).filter((f) => f.endsWith('.sql')).sort()
      : [];
    if (engineFiles.length) {
      log('\nInstalling retention engine as directus_migrator');
      for (const file of engineFiles) {
        try {
          await db.exec('SET ROLE directus_migrator');
          await db.exec(loadSql(join(ENGINE, file)));
          log(`  ok   engine/${file}`);
        } catch (e) {
          console.error(`\n  FAIL engine/${file} did not apply\n       ${e.message}\n`);
          process.exitCode = 1;
          throw e;
        } finally {
          try { await db.exec('RESET ROLE'); } catch { /* connection is going away anyway */ }
        }
      }
    }

    await db.exec(loadSql(join(TESTS, 'assert.sql')));

    // ---------------------------------------------------------------
    // Suites.
    // ---------------------------------------------------------------
    const testFiles = readdirSync(TESTS).filter((f) => /^\d\d_.*\.sql$/.test(f)).sort();
    log('\nRunning suites');
    // Drain the bootstrap chatter first, so the ledger below is exactly the
    // assertions the suites attempted and nothing else.
    db.drain();
    const ran = await runSuites(db, testFiles.map((f) => ({ file: f, sql: expandIncludes(loadSql(join(TESTS, f))) })));
    passed = ran.passed;
    failed = ran.failed;

    // ---------------------------------------------------------------
    // Assertion report.
    // ---------------------------------------------------------------
    const ledger = parseLedger(db.drain());
    rows = ledger.rows;
    if (ledger.malformed.length) {
      // A marked message the runner could not read. Refusing is the point: a
      // shorter count that nobody can account for is not a measurement.
      console.error(`\n  FAIL the assertion ledger is unreadable: ${ledger.malformed.length} marked message(s) did not parse`);
      for (const m of ledger.malformed) console.error(`       ${m}`);
      console.error('       tests/db/assert.sql and this runner must agree on the payload shape.');
    }
    const code = report(rows, passed, failed);
    if (ledger.malformed.length || code !== 0) process.exitCode = 1;
  } finally {
    await db.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// SELF-TEST (AFC-203 acceptance criterion 5)
//
// A gate nobody has watched fail is untested, not enforced. This is why the
// defect below survived: the ledger's zero was indistinguishable from a real
// zero, so no run of this suite could ever have told anyone it was broken.
//
// So the self-test does the thing that was impossible before: it FORCES an
// assertion to fail and then asserts that the ledger reports it -- with ok =
// false, with its detail, alongside the passing assertions that ran before it,
// and with a non-zero failing count. If anyone reverts assert.sql to
// INSERT-then-RAISE, or breaks the marker, or drops the onNotice plumbing, this
// goes red. It also asserts a green run still reports 0 failing and exit 0, so
// the fix cannot be bought by making everything look red.
//
// It runs against the same engine the suite uses (PG_URL when set, in-process
// PGlite otherwise), and it needs none of the migrations: it installs only
// tests/db/assert.sql -- the real harness file, not a copy -- and two in-memory
// suites. That is deliberate. The defect was IN THE HARNESS, so a self-test
// with a mock harness would not have caught it and would not catch its return.
// ---------------------------------------------------------------------------

const RED_SUITE = `
  SELECT test_support.assert_true(true,  'self-test', 'passes before the failure', 'as expected');
  SELECT test_support.assert_true(false, 'self-test', 'deliberately failing assertion',
                                  'actual=false expected=true');
  SELECT test_support.assert_true(true,  'self-test', 'never reached', 'as expected');
`;

const GREEN_SUITE = `
  SELECT test_support.assert_true(true, 'self-test', 'green one', 'as expected');
  SELECT test_support.assert_equals('a', 'a', 'self-test', 'green two');
  SELECT test_support.assert_instant(timestamptz '2026-10-06 12:00:00+00',
                                    timestamptz '2026-10-06 13:00:00+01',
                                    'self-test', 'green three');
`;

async function selfTest() {
  let rc = 0;
  const ok = (cond, what) => {
    if (cond) log(`  self-test ok: ${what}`);
    else { console.error(`SELF-TEST FAIL: ${what}`); rc = 1; }
  };

  // --- the parser, with no engine in the way -------------------------------
  ok(
    parseAssertion('bind <unnamed> to <unnamed>') === null,
    "a driver's own NOTICE is not an assertion",
  );
  ok(
    parseAssertion(`NOTICE ${MARKER}{"suite":"s","name":"n","ok":true}`) === null,
    'a message that does not start with the marker is not an assertion',
  );
  ok(
    parseAssertion(`${MARKER}{"suite":"s","name":"n"}`).malformed !== undefined,
    'a marked message with no ok is reported as malformed, not silently dropped',
  );
  ok(
    parseLedger([
      `${MARKER}{"suite":"s","name":"n1","ok":true,"detail":"a|b\\nc"}`,
      'bind <unnamed> to <unnamed>',
      `${MARKER}{"suite":"s","name":"n2","ok":false,"detail":null}`,
    ]).rows.length === 2,
    'ledger keeps order, drops chatter, and round-trips | and newline in a detail',
  );

  const db = await connect();
  try {
    log('\nSelf-test: installing the real harness (tests/db/assert.sql)');
    await db.exec(loadSql(join(TESTS, 'assert.sql')));

    // --- a RED run: the assertion that could never be reported before -------
    log('\nSelf-test: forcing a failing assertion');
    db.drain();
    const red = await runSuites(db, [{ file: 'self-test-red.sql', sql: RED_SUITE }]);
    const redLedger = parseLedger(db.drain());

    ok(red.failed === 1, 'the failing suite is reported as a failed suite');
    ok(
      redLedger.malformed.length === 0,
      `every marked message parsed (${redLedger.malformed.length} malformed)`,
    );
    ok(
      redLedger.rows.length === 2,
      `the reported count is the number of assertions ATTEMPTED: 2, not 0 and not 3 (got ${redLedger.rows.length})`,
    );

    const pass = redLedger.rows[0];
    const fail = redLedger.rows[1];
    ok(
      pass && pass.ok === true && pass.name === 'passes before the failure',
      'the passing assertion from before the failure is reported',
    );
    ok(
      fail && fail.ok === false && fail.name === 'deliberately failing assertion',
      'the failing assertion is reported with ok = false',
    );
    ok(
      fail && fail.detail === 'actual=false expected=true',
      `the failing assertion is reported with its detail (got ${JSON.stringify(fail && fail.detail)})`,
    );
    ok(
      !redLedger.rows.some((r) => r.name === 'never reached'),
      'an assertion that was never attempted is NOT in the ledger',
    );
    ok(
      redLedger.rows.filter((r) => !r.ok).length === 1,
      'the failing count is 1 -- it is no longer structurally always 0',
    );
    ok(
      exitCodeFor(red.failed, redLedger.rows) === 1,
      'the exit status is 1 on a run with a failing assertion',
    );

    // --- a GREEN run: the fix must not be "everything is red now" ----------
    log('\nSelf-test: a fully green run');
    db.drain();
    const green = await runSuites(db, [{ file: 'self-test-green.sql', sql: GREEN_SUITE }]);
    const greenLedger = parseLedger(db.drain());

    ok(green.failed === 0 && green.passed === 1, 'the green suite passes');
    ok(greenLedger.rows.length === 3, `all three passing assertions are reported (got ${greenLedger.rows.length})`);
    ok(
      greenLedger.rows.every((r) => r.ok === true),
      'no green assertion is reported as failing',
    );
    ok(
      exitCodeFor(green.failed, greenLedger.rows) === 0,
      'the exit status is 0 on a fully green run',
    );
  } finally {
    await db.close().catch(() => {});
  }

  if (rc === 0) log('\nself-test ok: the ledger reports a failing assertion, and reports a green run as green');
  else console.error('\nSELF-TEST FAIL: the ledger cannot be trusted; see above');
  process.exit(rc);
}

if (process.argv.slice(2).includes('--self-test')) {
  selfTest().catch((e) => { console.error(e); process.exit(1); });
} else {
  main().catch((e) => { console.error(e); process.exit(1); });
}