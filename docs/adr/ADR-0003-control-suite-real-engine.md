# ADR-0003 — The control suite must run against a real engine, and its own ledger must be trustworthy

**Status:** Accepted. CTO, 2026-10-06.
**Implements:** ADR-159-2 D7 ([AFC-159](/AFC/issues/AFC-159)), ADR-0001
**Affects:** `scripts/run-db-tests.mjs`, `tests/db/assert.sql`, `.github/workflows/ci.yml`
**Supersedes:** nothing.

---

## Decision

Three commitments, in order of how badly their absence hurts:

1. **The `awareness_at` control suite is run against a real PostgreSQL binary, not only
   PGlite.** PGlite stays as the fast local gate. A `postgres:16` service-container job
   runs the identical suite and its result is recorded beside the PGlite result.
2. **Assertion outcomes are recorded in a channel that survives the failure that
   produced them.** A suite that fails must still report what it asserted.
3. **The runner guarantees its starting state, or refuses to run.** A green run from an
   unknown database is not evidence.

## Context

[AFC-172](/AFC/issues/AFC-172) recorded that the suite had only ever been run via
`node scripts/run-db-tests.mjs` in a workspace, and that no CI run had ever executed.
Both halves of that are correct. This ADR records what happened when the suite was
finally run against a real engine, and why three of the four defects it exposed are
defects in the *harness* rather than in the control.

The engine available on the development host is PostgreSQL 18.1 native, not
`postgres:16`. That is strictly stronger than PGlite for the semantics under test —
real `CREATE ROLE`, real `SET ROLE`, real privilege enforcement, real trigger ownership,
not wasm — but it is **not** the deployed version and does not discharge Plan rev 14
§0.10.5. The container job remains the discharge path.

## The four defects

Reproduced by the CTO on a pinned tree (SHA-256 identical before and after), against a
dedicated scratch database, never `paperclip`:

| # | Defect | Nature |
|---|---|---|
| 1 | `30_backfill_survival.sql` compares `timestamptz::text` against literals pinned to `+00` | Test correctness |
| 2 | A failing suite persists **zero** assertion rows | **Harness — evidence integrity** |
| 3 | Runner applies migrations to whatever `PG_URL` names, with no freshness guarantee | **Harness — safety + evidence** |
| 4 | Second run in the same database is `0/10` (consequence of 3) | Harness |

### Why defect 2 is the most serious

`assert_true` / `assert_equals` `INSERT` into `test_support.results` and then `RAISE` on
failure. Each suite runs as one implicit transaction, so the `RAISE` rolls back the
`INSERT` that recorded the failure. Verified directly:

```
rows before=311  after=311  probe rows persisted=0
```

Two passing assertions and one failing assertion in a single transaction, and nothing
survives. The consequence is that the runner's summary line

```
N suites passed, M failed, K assertions, 0 failing
```

has a `0 failing` that is **structurally incapable of being anything but zero**. Every
run of this suite has printed `0 failing`, including runs where a suite failed on an
assertion. The assertion count is also under-reported on red runs, so a reader cannot
tell from the ledger whether the remaining assertions in a failed suite were ever
evaluated — which is the one question the ledger exists to answer.

This is why the constraint on [AFC-172](/AFC/issues/AFC-172) — *"do not weaken a control
to make a runner pass"* — had to be paired with its opposite. A harness that cannot
report a failure will eventually be tuned until it reports a pass. The self-test
requirement in [AFC-203](/AFC/issues/AFC-203) is the direct guard against that, and it
is modelled on `scripts/dirty-path-guard.sh --self-test`, which already runs on every CI
execution for exactly this reason.

### Why defect 1 is worse than a red test

PGlite defaults to UTC and GitHub Actions `ubuntu-latest` defaults to UTC. The suite
would therefore have gone **green in CI by accident of the runner's timezone** while
being wrong on every other host. For an NDPA s.40(2) legal-evidence control, evidence
that is right for the wrong reason is not evidence. Only the first of the four
assertions was ever reported, because the `RAISE` aborts the enclosing `DO` block — so
three of them were silently unverified on a non-UTC server.

The fix is to compare instants, not rendered text. Pinning `SET TIME ZONE 'UTC'` alone
was explicitly rejected: it hides the brittleness and leaves the next
`::text`-against-literal comparison silently dependent on runner settings.

### What was *not* filed

An earlier observation on a moving tree showed `62_retention_run.sql` failing with a
failed retention run recorded as `NULL`. It did not reproduce on a pinned tree. Under
the rule already extended to this work — *if you cannot reproduce it from a pinned tree,
it is a question, not a finding* — it is not filed. It stays a standing question and
would be critical if it recurred on a stable tree.

## Consequences

- **The suite is red on a real engine today.** That is the correct state, not a
  regression to be tuned away. PGlite green was never evidence.
- Three fix packages are with the Coder: [AFC-202](/AFC/issues/AFC-202),
  [AFC-203](/AFC/issues/AFC-203), [AFC-204](/AFC/issues/AFC-204).
- **CI must not be made green by suppression.** If the container job fails, it fails.
- §0.10.5 is not discharged by this ADR. It is discharged by a green run of the
  `postgres:16` job with a trustworthy ledger, recorded here.

## Alternatives considered

- **Ship the container job now, red.** Rejected as sequencing, not principle: it would
  have produced a red first run that says nothing about which of four defects caused it.
  Fix the harness first, then let CI be the first thing that reports.
- **Pin the runner to UTC and move on.** Rejected. It converts a visible red test into an
  invisible one and would have made the suite green in CI for the wrong reason.
- **Keep PGlite only.** Rejected. "Same engine, wasm runtime" is a weaker claim than
  "same engine, same binary" for a control that is legal evidence under NDPA s.40(2).
- **Compare rendered text after normalising in SQL.** Rejected as equivalent to the UTC
  pin in disguise, and it obscures the semantic being tested. Comparing instants is also
  strictly stronger: unequal instants still compare unequal.
- **Treat the host's PostgreSQL 18.1 as discharge for §0.10.5.** Rejected. Real engine,
  wrong version. Useful for unmasking defects; not for discharging a gate.
