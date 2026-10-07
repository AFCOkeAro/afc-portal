#!/usr/bin/env node
// scripts/run-db-tests.mjs
//
// Runs the database control tests for incidents.awareness_at (AFC-166).
//
//   pnpm test:db                     local: an in-process PostgreSQL 16
//   PG_URL=postgres://... pnpm test:db
//                                    a real server; the runner creates and drops
//                                    its OWN scratch database on it and never
//                                    touches the database PG_URL names (AFC-204)
//   node scripts/run-db-tests.mjs --self-test
//                                    watch this instrument fail (AFC-203)
//
// One code path, so local and CI assert the same things.
//
// FRESHNESS, in one line (AFC-204): both modes begin in an empty database created by
// this process, and neither mode can reach a database this process did not create.
// The reasoning, and the safety cases, are in scripts/lib/scratch-db.mjs.
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
import { openScratchDatabase, SCRATCH_PREFIX, isScratchDatabaseName, scratchDatabaseName } from './lib/scratch-db.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS = join(REPO, 'services/directus/schema/migrations');
// The engine is NOT a migration. It is behaviour that can be replaced without
// a schema-history entry, and it is deliberately outside the directory the
// retention-literal gate exempts -- that separation is what makes the gate
// meaningful, because the migrations are allowed to state a period and the
// engine is not.
const ENGINE = join(REPO, 'services/directus/schema/engine');
// Bootstrap. Applied as the cluster owner, before anything else, and applied
// as the FILE rather than as a transcription of it -- see the comment at the
// call site for why a second copy of the privilege boundary is a defect.
const BOOTSTRAP = join(REPO, 'services/directus/schema/bootstrap');
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
    // AFC-204. What used to be here connected to PG_URL's database and applied
    // migrations to it, so the suites' fixed-ref fixtures survived into the next run
    // and a green run could not be distinguished from a run over its own leftovers.
    // It also meant DATABASE_URL -- which on some hosts is a live application
    // database -- got the full migration sequence written into it.
    //
    // Now the server is used for exactly two things: CREATE DATABASE for a name
    // this process generated, and DROP DATABASE for that same name on the way out.
    // The connection the migrations run on is opened to the scratch database and is
    // asserted to be there before any DDL is issued.
    const notes = [];
    let scratch;
    try {
      scratch = await openScratchDatabase(external, {
        log,
        onNotice: (m) => notes.push(String(m.message)),
        keep: process.env.AFC_DB_TEST_KEEP_SCRATCH === '1',
      });
    } catch (e) {
      // A refusal is exit 2 and a named exit code, not a crash: "I would not run
      // under these conditions" and "I broke" must not read the same in a pipeline.
      console.error(`\n  REFUSING TO RUN: ${e.message}\n`);
      process.exit(e.code === 'scratch_database_unavailable' || e.name === 'ScratchDatabaseError' ? 2 : 1);
    }
    for (const line of scratch.header) log(line);
    const client = scratch.client;
    // node-postgres re-emits every NOTICE the backend raises on the client, in
    // the order it raised them, before the in-flight query settles -- so a
    // notice raised by the statement that is about to fail has already been
    // collected by the time the rejection lands. No privileges needed. (openScratchDatabase
    // registered the handler before its own probe query, so nothing is missed.)
    const v = await client.query('SELECT version()');
    log(`Server: ${v.rows[0].version}`);
    return {
      version: v.rows[0].version,
      exec: async (sql) => { await client.query(sql); },
      query: async (sql) => (await client.query(sql)).rows,
      drain: () => notes.splice(0, notes.length),
      close: async () => { await scratch.dispose(); },
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
  log('Scratch database : the PGlite instance of this process, created empty and closed when it exits');
  log('Guarantee        : same guarantee as PG_URL mode -- every run starts in an empty database that this');
  log('                   process created. No server database is contacted, so none can be altered.');
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
    // Pre-flight: refuse to run against a database that already has state.
    //
    // AFC-204 NOTE, added when the scratch database landed (see
    // scripts/lib/scratch-db.mjs for the full argument). What this block
    // originally was: THE fix. What it is now: the second line of defence.
    // The guarantee is now structural -- the connection below is a scratch
    // database this process created and drops, so there is nothing here for a
    // stale-fixture check to catch. It is kept because it is cheap and because
    // a future edit that wired the migrations back to the database in PG_URL
    // would land on this check rather than on a silent green run.
    //
    // It is NOT a substitute for the scratch database, and the reason is
    // measured rather than argued. This check recognises "a previous run of
    // this suite" by the NAMES it expects. A database holding only unrelated
    // tables -- `sentinel_marker`, `unrelated_widgets` -- is not one of those
    // names, so this check reported "empty" and the migration sequence wrote
    // `incidents`, `incidents_breach_clock` and five indexes into it. Detecting
    // our objects cannot be made exhaustive, and a classification that is not
    // exhaustive is the original defect wearing a different hat.
    //
    // The rest of this comment describes the refusal as the mechanism. It is
    // not, any more; it is the fallback if the scratch mechanism is removed.
    // ---------------------------------------------------------------
    // This suite creates clusters of objects that CREATE ... IF NOT EXISTS
    // silently accepts: probe schemas, seeded fixtures, roles whose grants
    // accumulate. Re-running against a used database therefore does not
    // re-test the controls -- it tests whatever the previous run left behind,
    // and reports it in the same green text as a clean run. Measured on real
    // PostgreSQL 18: a fresh database is 11 suites / 343 assertions / 0
    // failing, and the immediately following run on that same database is
    // 10 of 11 suites failing. Both numbers are real. Neither means the
    // controls changed, and a suite whose verdict depends on whether someone
    // remembered to use a clean database is not evidence for anything.
    //
    // The fix here is to REFUSE, not to clean. Dropping the database named in
    // PG_URL would be irreversible, and a typo'd or copy-pasted PG_URL aimed
    // at staging would take staging with it. A test harness that deletes
    // whatever it was pointed at is a much worse defect than the one it is
    // fixing, so the harness stops and tells the operator what to do instead.
    // Default deny: nothing is destroyed on any path through this file.
    // ---------------------------------------------------------------
    const dirty = await db.query(`
      SELECT n.nspname AS schema, c.relname AS relation
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE c.relkind IN ('r','p','v','m','S')
         AND (n.nspname NOT IN ('pg_catalog','information_schema','public')
              OR c.relname IN ('incidents','people','legal_holds','retention_policies',
                               'retention_clocks','retention_anchor_sources',
                               'retention_class_sources','retention_runs',
                               'retention_run_items'))
       LIMIT 5`);
    const extraSchemas = await db.query(`
      SELECT nspname FROM pg_namespace
       WHERE nspname LIKE '%\\_probe' OR nspname = 'retention' LIMIT 5`);
    if (dirty.length || extraSchemas.length) {
      const found = [
        ...extraSchemas.map((r) => r.nspname),
        ...dirty.map((r) => `${r.schema}.${r.relation}`),
      ];
      console.error(`
  REFUSING to run: the target database is not empty.

    ${found.join('\n    ')}

  These objects come from a previous run of this suite. Suites here seed
  fixtures and rely on CREATE ... IF NOT EXISTS, so a second run on the same
  database measures the leftovers instead of the controls and reports the
  result in the same format as a real one.

  Point PG_URL at a database that does not exist yet, or create one and let
  this run populate it:

    createdb afc_db_tests && PG_URL=postgres://.../afc_db_tests pnpm test:db

  This harness deliberately does NOT drop the database for you. PG_URL is an
  operator-supplied string and destroying whatever it names is irreversible --
  a misdirected connection string would delete real data, and a test runner
  that can do that is a worse problem than a stale fixture.
`);
      process.exitCode = 2;
      return;
    }
    log('Pre-flight: the database under test is empty');
    // ---------------------------------------------------------------
    // Bootstrap, as the cluster owner. This is the REAL bootstrap file, not a
    // copy of it, and that is load-bearing rather than tidiness.
    //
    // This block used to inline its own version of the bootstrap role creation.
    // It had already drifted from services/directus/schema/bootstrap/0001_roles.sql
    // -- it was missing the worker's USAGE on schema public, the REVOKE of the
    // engine schema from PUBLIC, and the boundary assertion entirely -- so the
    // fixture was a configuration nobody deploys. A suite that verifies a copy
    // of the artifact is verifying the copy, and a privilege boundary that
    // exists in two files is a boundary that will be edited in one of them.
    //
    // AFC-205 is the concrete cost. The retention capability is provisioned by
    // membership in the bootstrap file; with the grant living only there, the
    // fixture never sees it and the new suite would have to invent the grant
    // itself -- which is testing fiction again, one layer up.
    //
    // ADR-0002 is why this is a step and not a migration: role creation needs
    // cluster authority, which no migration in the sequence has.
    // ---------------------------------------------------------------
    log('\nBootstrapping roles (services/directus/schema/bootstrap/0001_roles.sql)');
    try {
      await db.exec(loadSql(join(BOOTSTRAP, '0001_roles.sql')));
      log('  ok   bootstrap/0001_roles.sql');
    } catch (e) {
      // The boundary assertions in that file raise on purpose. Naming the file
      // and the message, rather than "a bootstrap statement failed", is the
      // difference between a deploy that stops here and one that limps on.
      console.error(`\n  FAIL bootstrap/0001_roles.sql did not apply\n       ${e.message}\n`);
      process.exitCode = 1;
      throw e;
    }

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

// The AFC-299 guard. It runs as a non-superuser LOGIN that is not a member of
// retention_worker, so the SET LOCAL ROLE inside probe() is refused and the
// marker branch is the branch under test. The second assertion wraps
// assert_raises in a handler because the property being asserted is that it
// RAISES -- a passing assert_raises is exactly the false green the F4 fix
// (AFC-257) removed, and the shape most likely to return.
const REFUSED_SWITCH_SUITE = `
  DO $$
  DECLARE
    v_got    text;
    v_raised boolean := false;
    v_detail text;
  BEGIN
    v_got := test_support.probe('retention_worker', 'SELECT 1');
    PERFORM test_support.assert_true(
      split_part(v_got, ' | ', 1) LIKE 'ROLE_SWITCH_REFUSED %',
      'self-test',
      'probe() returns ROLE_SWITCH_REFUSED, not a bare SQLSTATE, when the switch is refused',
      'got: ' || COALESCE(v_got, '(null)'));

    BEGIN
      PERFORM test_support.assert_raises('retention_worker', 'SELECT 1', '42501',
        'self-test', 'assert_raises refuses to certify a refused switch as the statement''s outcome');
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM LIKE 'ASSERTION FAILED%' THEN
        v_raised := true;
        v_detail := SQLERRM;
      ELSE
        RAISE;
      END IF;
    END;

    PERFORM test_support.assert_true(v_raised,
      'self-test',
      'assert_raises raises on a refused switch -- the false green is gone',
      'detail: ' || COALESCE(v_detail, '(assert_raises did not raise)'));
  END $$;
`;

// A URL that names a database like a real one, because "named like a real one" is the
// case the safety constraint is about. `not-a-secret` is a placeholder string, not a
// credential: it is here so the assertion can prove the header never echoes it.
const SELF_TEST_PG_URL = 'postgres://tester:not-a-secret@db.internal:5432/afc_church_production';

/**
 * A recording stand-in for node-postgres.
 *
 *   createdb:   whether the role may CREATE DATABASE
 *   landOn:     what current_database() claims -- 'elsewhere' is the lie the runner
 *               has to catch
 *   failCreate: CREATE DATABASE fails, as it would on a server out of room or out of
 *               databases
 *
 * Every connection and every statement is recorded, because the properties worth
 * asserting here are the ones about what did NOT happen.
 */
function recordingClients(opts = {}) {
  const recs = [];
  const factory = (connectionString) => {
    const rec = {
      connectionString,
      db: decodeURIComponent(new URL(connectionString).pathname.replace(/^\//, '')),
      sql: [],
      connected: false,
      ended: false,
    };
    recs.push(rec);
    return {
      on() {},
      async connect() { rec.connected = true; },
      async end() { rec.ended = true; },
      async query(sql) {
        rec.sql.push(sql);
        if (/rolcreatedb/.test(sql)) {
          return { rows: [{ usename: 'afc_tester', rolcreatedb: opts.createdb !== false, rolsuper: false }] };
        }
        if (/current_database/.test(sql)) {
          return { rows: [{ db: opts.landOn === 'elsewhere' ? 'postgres' : rec.db }] };
        }
        if (/^CREATE DATABASE/i.test(sql)) {
          if (opts.failCreate) throw Object.assign(new Error('could not create database'), { code: '53100' });
          return { rows: [] };
        }
        if (/^DROP DATABASE/i.test(sql)) return { rows: [] };
        if (/SELECT version/i.test(sql)) return { rows: [{ version: 'PostgreSQL 18.1 (recording double)' }] };
        throw new Error(`the recording double was asked for a statement it does not model: ${sql}`);
      },
    };
  };
  const allSql = () => recs.flatMap((r) => r.sql);
  return { factory, recs, allSql };
}

/** Anything that creates, destroys or writes. The safety case is about this list. */
const isSchemaBearing = (s) => /^\s*(CREATE|DROP|ALTER|TRUNCATE|INSERT|UPDATE|DELETE|GRANT|REVOKE)\b/i.test(s);

/**
 * AFC-204. The freshness guarantee, asserted as a set of negative properties.
 *
 * Every assertion here is about something the runner must NOT do, so none of them can
 * be established by running against a real server and seeing it come out green -- a
 * real server cannot tell you which statements were never issued. That is what the
 * recording double is for.
 */
async function freshnessSelfTest(ok) {
  log('\nSelf-test: the freshness guarantee (AFC-204)');

  // --- names, and the gate on destruction -----------------------------------
  const name = scratchDatabaseName();
  ok(name.startsWith(SCRATCH_PREFIX), `a generated name is unmistakably a scratch name (${name})`);
  ok(isScratchDatabaseName(name), 'a generated name passes the drop gate');
  for (const real of [
    'paperclip', 'postgres', 'template1', 'afc', 'afc_dbtests',
    SCRATCH_PREFIX,                                   // no pid, no nonce
    `${SCRATCH_PREFIX}1_zzzzzzzz`,                     // nonce is not hex
    `${SCRATCH_PREFIX}../../etc/passwd`,               // traversal
    `${SCRATCH_PREFIX}1_deadbeef"; DROP DATABASE paperclip`, // injection
  ]) {
    ok(!isScratchDatabaseName(real), `the drop gate refuses a name this module did not mint (${real.slice(0, 48)})`);
  }

  // --- a role that cannot have the guarantee must not get a fallback --------
  const denied = recordingClients({ createdb: false });
  let refusal = null;
  try {
    await openScratchDatabase(SELF_TEST_PG_URL, { clientFactory: denied.factory, log: () => {} });
  } catch (e) { refusal = e; }
  ok(refusal?.code === 'createdb_required', 'a role without CREATEDB is refused');
  ok(
    !denied.allSql().some((s) => /^CREATE DATABASE/i.test(s)),
    'nothing is created when the guarantee cannot be honoured -- no silent fallback to migrating in place',
  );

  // --- the run itself -------------------------------------------------------
  const rec = recordingClients();
  const scratch = await openScratchDatabase(SELF_TEST_PG_URL, { clientFactory: rec.factory, log: () => {} });

  const beforeTeardown = rec.allSql().filter(isSchemaBearing);
  ok(
    beforeTeardown.length === 1 && beforeTeardown[0] === `CREATE DATABASE "${scratch.name}" TEMPLATE template0`,
    `before teardown the only schema-bearing statement is CREATE DATABASE for the scratch name (${beforeTeardown.length} seen)`,
  );
  ok(
    !rec.recs.some((r) => r.db === 'afc_church_production'),
    'the database named in PG_URL is never opened -- not even to read its version',
  );
  const scratchConn = rec.recs.find((r) => r.db === scratch.name);
  ok(!!scratchConn, 'the connection the migrations run on is a connection to the scratch database');
  ok(
    !!scratchConn && scratchConn.sql.length === 1 && /current_database/.test(scratchConn.sql[0]),
    'the scratch connection is asked for its identity, and nothing else, before any DDL reaches it',
  );

  // --- the header is the citable part --------------------------------------
  const header = scratch.header.join('\n');
  ok(header.includes(scratch.name), 'the header names the scratch database');
  ok(/^Guarantee/m.test(header), 'the header prints the guarantee, not only the facts it rests on');
  ok(header.includes('afc_church_production'), 'the header names the database it is NOT touching');
  ok(!header.includes('not-a-secret') && !header.includes('tester@'), 'the header never echoes the PG_URL credentials');

  // --- teardown -------------------------------------------------------------
  await scratch.dispose();
  await scratch.dispose(); // idempotent: the finally block and a signal can both reach it
  const drops = rec.allSql().filter((s) => /^DROP DATABASE/i.test(s));
  ok(
    drops.length === 1 && drops[0] === `DROP DATABASE "${scratch.name}"`,
    `teardown drops exactly the database this run created, exactly once (${drops.length} drops)`,
  );
  ok(
    rec.recs.filter((r) => r.connected).every((r) => r.ended),
    'every connection this run opened is closed, so the DROP cannot fail on its own backend',
  );

  // --- a connection that lands in the wrong database -----------------------
  const wrong = recordingClients({ landOn: 'elsewhere' });
  let mismatch = null;
  try {
    await openScratchDatabase(SELF_TEST_PG_URL, { clientFactory: wrong.factory, log: () => {} });
  } catch (e) { mismatch = e; }
  ok(mismatch?.code === 'identity_mismatch', 'a scratch connection that reports a different database is refused');
  ok(
    wrong.allSql().filter(isSchemaBearing).every((s) => s.includes(SCRATCH_PREFIX)),
    'every schema statement in that case names the scratch database and nothing else',
  );

  // --- a CREATE that failed must leave nothing behind ----------------------
  const noRoom = recordingClients({ failCreate: true });
  let failed = null;
  try {
    await openScratchDatabase(SELF_TEST_PG_URL, { clientFactory: noRoom.factory, log: () => {} });
  } catch (e) { failed = e; }
  ok(failed?.code === 'create_failed', 'a failed CREATE DATABASE is reported, not swallowed');
  ok(
    !noRoom.allSql().some((s) => /^DROP/i.test(s)),
    'a run that created no database drops no database -- including one that was already there',
  );
}

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

  // --- the freshness guarantee, against a recording double -----------------
  //
  // Same argument as the ledger above, applied to AFC-204: a safety property that has
  // never been watched fail is a comment. The properties asserted here are NEGATIVE
  // -- no DDL reached the target, no database was dropped that this run did not
  // create, no fallback happened when the guarantee could not be honoured -- and a
  // negative is exactly what a real server cannot demonstrate by running green. So
  // the engine is a double that records every statement, and the assertions are on
  // the RECORD, not on the outcome.
  //
  // It needs no server, so it runs in the CI job that runs the PGlite gate.
  await freshnessSelfTest(ok);

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

    // ---------------------------------------------------------------
    // The refused-switch marker (AFC-299 / F1).
    //
    // The F4 fix (AFC-257, commit 6295956) makes probe() return
    // 'ROLE_SWITCH_REFUSED <sqlstate> | <message>' when the SET LOCAL ROLE is
    // refused. Nothing in the suite could observe it: the runner's session is
    // a superuser, so every SET LOCAL ROLE in all 14 suites is accepted and
    // the refusal branch is never taken. A revert of probe() left the whole
    // suite green -- the same reason the bug was invisible in the first place.
    //
    // So the self-test becomes the identity the fix is about: a non-superuser
    // LOGIN that is not a member of retention_worker. The roles are created
    // here rather than taken from the bootstrap file because the self-test
    // deliberately installs only tests/db/assert.sql -- the real harness, not
    // a copy -- and the bootstrap is a deploy step, not a test fixture. They
    // are created IF MISSING and nothing is ever granted: the fixture is
    // "an identity that cannot reach the worker", and a pre-existing grant
    // that could change that is a broken fixture the self-test must report
    // (by going red), not repair.
    //
    // The restore is issued, not asserted. PGlite -- the engine CI runs this
    // self-test on -- accepts SET SESSION AUTHORIZATION DEFAULT but does not
    // honour it (measured: current_user is unchanged afterwards, on every
    // restore spelling), and the connection is closed immediately below, so
    // nothing downstream can observe the difference. On a real server the
    // restore returns the session to the identity it connected as.
    // ---------------------------------------------------------------
    log('\nSelf-test: the refused-switch marker (AFC-299)');
    await db.exec(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'retention_worker') THEN
          CREATE ROLE retention_worker NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'directus_app') THEN
          CREATE ROLE directus_app LOGIN;
        END IF;
      END $$;
    `);
    await db.exec('SET SESSION AUTHORIZATION directus_app');
    db.drain();
    const marker = await runSuites(db, [{ file: 'self-test-refused-switch.sql', sql: REFUSED_SWITCH_SUITE }]);
    const markerLedger = parseLedger(db.drain());

    ok(
      marker.failed === 0 && marker.passed === 1,
      'the refused-switch suite passes against the real harness',
    );
    ok(
      markerLedger.rows.length === 3,
      `the refused-switch suite reports all three assertion outcomes (got ${markerLedger.rows.length})`,
    );
    const [probeRow, refusedRow, raisesRow] = markerLedger.rows;
    ok(
      probeRow?.ok === true && (probeRow?.detail ?? '').includes('ROLE_SWITCH_REFUSED'),
      'probe() is reported returning the ROLE_SWITCH_REFUSED marker, not a bare SQLSTATE',
    );
    ok(
      refusedRow?.ok === false && (refusedRow?.detail ?? '').includes('ROLE_SWITCH_REFUSED'),
      'assert_raises records the refused switch as a FAILING assertion, not a pass',
    );
    ok(
      raisesRow?.ok === true,
      'the wrapper assertion that assert_raises raised is reported as passing',
    );

    let restoreFailed = null;
    try {
      await db.exec('SET SESSION AUTHORIZATION DEFAULT');
    } catch (e) {
      restoreFailed = e;
    }
    ok(restoreFailed === null, 'the session identity is restored after the refused-switch assertions');
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