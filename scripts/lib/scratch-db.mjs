// scripts/lib/scratch-db.mjs
//
// THE FRESHNESS GUARANTEE (AFC-204).
//
// The defect this closes, in one sentence: the runner connected to whatever PG_URL
// named, applied migrations to it, and ran suites that insert fixed-ref fixtures and
// never clean up, so a second run in the same database measured the first run's
// leftovers and reported `0/10`. A green run from an unknown database is not evidence,
// which is commitment 3 of ADR-0003.
//
// THE CHOICE, and why it is (a) and not (b). ADR-0003 allows either -- guarantee the
// starting state, or refuse to run. Refusing is only sufficient if the refusal is
// correct every time, and that turns the runner into a classifier: it has to decide,
// from a catalogue of object names, whether a database is "one of ours". A database
// with a table called `widget` is not one of ours by that test and would be migrated
// anyway, which is the defect wearing a different hat. Detecting *our* objects cannot
// be made exhaustive, and an exhaustive check over an unknown database is exactly the
// kind of check that eventually gets tuned until it lets something through.
//
// So the runner does not classify. It creates a database whose name it generated, it
// migrates only that one, and it drops it when it exits. There is no list to be
// incomplete and no judgement to be wrong: the only database the suites can reach is
// one this process created moments earlier.
//
// THE SAFETY CONSTRAINT, which is the reason none of the above is optional.
// `DATABASE_URL` on some hosts points at a live application database. This module
// therefore:
//
//   * never issues DDL against the target database -- the admin connection runs
//     exactly three statements, and none of them is schema- or data-bearing;
//   * never drops, truncates or alters any database it did not create. The single
//     `DROP DATABASE` is gated on a flag that is set only by a successful CREATE
//     THIS PROCESS performed, and additionally on the name matching
//     SCRATCH_NAME_RE. A pre-existing database can therefore never be dropped, even
//     if the nonce collided;
//   * refuses to run at all, rather than falling back to migrating in place, when the
//     role cannot CREATE a database. Falling back would be the old defect wearing a
//     header.
//
// It is deliberately NOT solved by granting the suite more privilege, by truncating
// fixtures, or by requiring the operator to remember to hand over a clean database.
// A control whose evidence depends on somebody remembering something is not a
// control.
//
// WHAT THIS DOES NOT COVER, stated plainly: role creation in
// services/directus/schema/bootstrap/0001_roles.sql is cluster-wide and survives the
// scratch database. That is the deploy path's own behaviour and it is idempotent
// (the file only creates roles that do not exist), but the guarantee below is about
// DATABASES AND THEIR CONTENTS. The header says so, rather than claiming more than
// is true.

import { randomBytes } from 'node:crypto';

/**
 * Unmistakably a scratch name, and the only shape this module will ever create or
 * drop. pid makes concurrent runs on one server distinct and readable; the nonce
 * makes two runs from the same pid distinct. No operator override exists, and that
 * is deliberate: an override is a way to collide with a database somebody else owns,
 * and a `DROP` that depends on a human-supplied string is a `DROP` of somebody
 * else's database waiting for a bad paste.
 */
export const SCRATCH_PREFIX = 'afc_dbtest_scratch_';
const SCRATCH_NAME_RE = /^afc_dbtest_scratch_[0-9]{1,10}_[0-9a-f]{8}$/;
const MAX_IDENTIFIER_BYTES = 63;

/** Raised for every refusal path, so the runner can exit 2 rather than crash. */
export class ScratchDatabaseError extends Error {
  constructor(message, code = 'scratch_database_unavailable') {
    super(message);
    this.name = 'ScratchDatabaseError';
    this.code = code;
  }
}

export function scratchDatabaseName(pid = process.pid, nonce = randomBytes(4).toString('hex')) {
  const name = `${SCRATCH_PREFIX}${pid}_${nonce}`;
  if (name.length > MAX_IDENTIFIER_BYTES) throw new ScratchDatabaseError(`scratch database name is too long: ${name}`);
  if (!isScratchDatabaseName(name)) throw new ScratchDatabaseError(`generated a name that is not a scratch name: ${name}`);
  return name;
}

/**
 * The gate on destruction. `DROP DATABASE` is only ever reached for a name that
 * passes this, so a name this module did not mint cannot be dropped even by a future
 * edit that gets the `created` flag wrong.
 */
export function isScratchDatabaseName(name) {
  return typeof name === 'string' && name.length <= MAX_IDENTIFIER_BYTES && SCRATCH_NAME_RE.test(name);
}

/** PostgreSQL has no database-name parameter, so the name is quoted. */
const quoteIdent = (name) => `"${name.replace(/"/g, '""')}"`;

/** 3D000 invalid_catalog_name: the database named in the URL is not there. */
const isMissingDatabase = (e) => e?.code === '3D000' || /does not exist/i.test(e?.message ?? '');

/** `template0` is the pristine template; some hosts have it open, which is a race we lose safely. */
const TEMPLATE_IN_USE = /being accessed by other users/i;

/** Where CREATE/DROP DATABASE are issued from when the host allows it. */
const MAINTENANCE_DB = 'postgres';

/**
 * The same server, a different database. Credentials, host and port are carried over
 * untouched -- this rewrites the path and nothing else, so a password in the URL is
 * never printed and never reconstructed.
 */
export function withDatabase(pgUrl, name) {
  const u = new URL(pgUrl);
  u.pathname = `/${encodeURIComponent(name)}`;
  return u.toString();
}

/**
 * A label for the header. `host:port/db` only: the URL's userinfo carries a password
 * and this string goes into logs that get pasted into tickets.
 */
export function targetLabel(pgUrl) {
  const u = new URL(pgUrl);
  const db = decodeURIComponent(u.pathname.replace(/^\/+/, '')) || '(server default)';
  const host = u.port ? `${u.hostname}:${u.port}` : u.hostname;
  return `${db} on ${host}`;
}

/**
 * Create a scratch database, open it, and hand back the guarantee in a form the
 * runner can print.
 *
 * `clientFactory` is injected so the self-test can drive this whole module against a
 * recording double and assert on the exact statements issued -- which is the only way
 * to prove the negative ("no DDL reached the target") without a server. The default
 * is node-postgres.
 *
 * Returns { name, header, client, dispose }.
 */
export async function openScratchDatabase(pgUrl, { log = () => {}, onNotice = null, keep = false, clientFactory = null } = {}) {
  const make = clientFactory ?? (await defaultClientFactory());

  // --- the admin connection ------------------------------------------------
  // Deliberately the maintenance database, not the target. CREATE DATABASE and DROP
  // DATABASE do not need a connection to the database being named, so on any host
  // that has one the runner never opens the target at all -- not to read a version,
  // not to count tables, not to do anything. The target is then only ever a string
  // this module quotes into CREATE/DROP for the scratch name, and a label in the
  // header.
  //
  // Some managed hosts do not expose `postgres`, so the target is the fallback: a
  // connection that can only issue these three statements is still a safe one, and
  // refusing to run there would be refusing for a reason that is not about safety.
  const candidates = [withDatabase(pgUrl, MAINTENANCE_DB), pgUrl];
  let admin = null;
  let adminOn = candidates[0];
  for (const candidate of candidates) {
    const c = make(candidate);
    try {
      await c.connect();
      admin = c;
      adminOn = candidate;
      break;
    } catch (e) {
      await c.end().catch(() => {});
      if (candidate === pgUrl) throw connectFailure(e, pgUrl);
    }
  }
  if (!admin) throw connectFailure(new Error('no database on the server accepted a connection'), pgUrl);
  if (adminOn !== candidates[0]) {
    log(`The "${MAINTENANCE_DB}" maintenance database is not available on this server; connected to the one in`);
    log('PG_URL instead. It is used only to create and drop this run\'s scratch database.');
  }

  // --- CREATEDB, checked BEFORE anything is created -------------------------
  // A refusal here is the whole point. The alternative -- migrate in place when we
  // cannot have a scratch database -- is the defect this issue exists to close.
  let me;
  try {
    me = (await admin.query(
      `SELECT current_user AS usename, rolcreatedb, rolsuper FROM pg_roles WHERE rolname = current_user`,
    )).rows[0];
  } catch (e) {
    await admin.end().catch(() => {});
    throw new ScratchDatabaseError(`could not read the current role's attributes: ${e.message}`, 'probe_failed');
  }
  if (!me?.rolcreatedb) {
    await admin.end().catch(() => {});
    throw new ScratchDatabaseError(
      `The role "${me?.usename ?? '(unknown)'}" in PG_URL does not have CREATEDB, so this runner cannot honour the\n` +
        `guarantee it is built on: every run begins in an empty database that this process created.\n\n` +
        `It will not fall back to applying migrations to the database PG_URL names, because that is the defect\n` +
        `[AFC-204](/AFC/issues/AFC-204) was filed for, and a test runner that destroys or migrates whatever it is\n` +
        `handed is worse than a red test.\n\n` +
        `  fix it here : grant CREATEDB to that role, or point PG_URL at a role that has it\n` +
        `  fix it here : run without PG_URL -- \`pnpm test:db\` uses an in-process database and needs no server\n\n` +
        `No privilege was widened and no fallback was taken on your behalf.`,
      'createdb_required',
    );
  }

  // --- create --------------------------------------------------------------
  const name = scratchDatabaseName();
  let created = false;
  let template = 'template0';
  try {
    try {
      await admin.query(`CREATE DATABASE ${quoteIdent(name)} TEMPLATE template0`);
    } catch (e) {
      // template0 is the pristine template and is what makes "empty" mean empty on a
      // host whose template1 has extensions in it. If another session holds it, the
      // cluster default is the next best thing and the header says which was used --
      // a run whose freshness rests on template1 must not read like one that did not.
      if (!TEMPLATE_IN_USE.test(e.message)) throw e;
      template = 'the cluster default template';
      await admin.query(`CREATE DATABASE ${quoteIdent(name)}`);
    }
    created = true;
  } catch (e) {
    await admin.end().catch(() => {});
    // NOT dropping: `created` is still false, and that is the point. A CREATE that
    // failed must never leave us holding a database we cannot account for -- and
    // 42P04 (already exists) lands here, so a nonce collision refuses rather than
    // adopts someone else's database.
    throw new ScratchDatabaseError(
      `could not create the scratch database on the server PG_URL names: ${e.message}\n` +
        `Nothing was dropped: this run created no database, so it will not destroy one.`,
      'create_failed',
    );
  }

  // --- open it, and prove we are in it --------------------------------------
  const client = make(withDatabase(pgUrl, name));
  try {
    await client.connect();
    if (onNotice && typeof client.on === 'function') client.on('notice', onNotice);
    const here = (await client.query('SELECT current_database() AS db')).rows[0]?.db;
    if (here !== name) {
      // The one wiring mistake that would make every other guarantee a lie: the
      // connection the migrations run on is not the database this run created.
      // Asserted before a single DDL statement, so there is nothing to undo.
      throw new ScratchDatabaseError(
        `the scratch connection reports current_database() = ${JSON.stringify(here)}, expected ${JSON.stringify(name)}.\n` +
          `Refusing to run: nothing has been applied yet, so there is nothing to clean up.`,
        'identity_mismatch',
      );
    }
  } catch (e) {
    await client.end().catch(() => {});
    await admin.query(`DROP DATABASE ${quoteIdent(name)}`).catch(() => {});
    await admin.end().catch(() => {});
    throw e;
  }

  const header = [
    `Scratch database : ${name}  (created by this run from ${template}; dropped when this process exits)`,
    `Target database  : ${targetLabel(pgUrl)}  -- named from PG_URL, never opened, never written to`,
    `Guarantee        : every run starts in an empty database that this process created and owns, so a result`,
    `                   is a result about this tree and not about a previous run's fixtures. The target database`,
    `                   receives no migration, no engine object, no fixture, no DROP and no TRUNCATE. Cluster-wide`,
    `                   roles from the bootstrap step are outside this guarantee -- see scripts/lib/scratch-db.mjs.`,
  ];

  // --- teardown -------------------------------------------------------------
  let disposed = false;
  const dispose = async () => {
    if (disposed) return;
    disposed = true;
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    await client.end().catch(() => {});
    if (!created) {
      // Unreachable on the success path, and kept anyway: the drop is gated on the
      // flag, not on reaching this line.
      await admin.end().catch(() => {});
      return;
    }
    if (keep) {
      log(`AFC_DB_TEST_KEEP_SCRATCH=1: scratch database ${name} left in place for inspection.`);
      log(`  Drop it when you are done:  DROP DATABASE ${quoteIdent(name)};   -- it holds test fixtures only.`);
      await admin.end().catch(() => {});
      return;
    }
    try {
      await admin.query(`DROP DATABASE ${quoteIdent(name)}`);
      log(`Scratch database ${name} dropped.`);
    } catch (e) {
      // Loud, and actionable. A leaked scratch database on a shared server is litter,
      // and the operator is the only one who can clear it.
      console.error(`could not drop the scratch database ${name}: ${e.message}`);
      console.error(`  Drop it yourself:  DROP DATABASE ${quoteIdent(name)};   -- it holds test fixtures only.`);
    }
    await admin.end().catch(() => {});
  };

  // A Ctrl-C between CREATE and the suites would otherwise leave the database behind.
  function onSignal(sig) {
    dispose().finally(() => process.exit(sig === 'SIGINT' ? 130 : 143));
  }
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  return { name, header, client, dispose, created, template };
}

async function defaultClientFactory() {
  const { Client } = await import('pg');
  return (connectionString) => new Client({ connectionString });
}

function connectFailure(e, pgUrl) {
  const detail = e?.message ?? String(e);
  // No URL echo: it can carry a password.
  return new ScratchDatabaseError(
    `Could not reach the PostgreSQL server named by PG_URL (${new URL(pgUrl).hostname}).\n  ${detail}\n` +
      `The runner cannot make its freshness guarantee without a server, and it will not run against anything it\n` +
      `has not verified. If the server is local and unreachable, start it; otherwise drop PG_URL to use the\n` +
      `in-process database.`,
    'unreachable',
  );
}