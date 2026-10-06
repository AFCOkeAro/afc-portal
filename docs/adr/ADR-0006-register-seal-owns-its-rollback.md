# ADR-0006 — The register seal owns its own rollback

**Status:** Accepted, CTO (MediaTech) 2026-10-06
**Origin:** [AFC-253](/AFC/issues/AFC-253). **Affects:**
`services/directus/schema/migrations/20261006_0001_incidents.sql`,
`20261006_0002_incidents_awareness_at.sql`,
`rollback/20261006_0002_incidents_awareness_at.down.sql`,
`rollback/20261006_0001_incidents.down.sql` (new),
`tests/db/21_register_seal_after_rollback.sql` (new)
**Raised by:** SecurityEngineer, R2 review of `1f43c9e`, reported on
[AFC-239](/AFC/issues/AFC-239). **Independent re-verification required from:**
SecurityEngineer — not from the implementer.
**Numbering note:** the brief on [AFC-264](/AFC/issues/AFC-264) named this file
`ADR-0003-…`, but `ADR-0003` is already taken by
[ADR-0003-control-suite-real-engine.md](ADR-0003-control-suite-real-engine.md).
The number is the next free one; nothing else about the file deviates from the
brief.

---

## Decision

1. **`0001` owns the evidence seal.** `incidents_forbid_delete()`,
   `incidents_forbid_truncate()` and the `incidents_no_delete` /
   `incidents_no_truncate` triggers move into
   `20261006_0001_incidents.sql`.
2. **`0002` keeps the same four definitions verbatim**, as an idempotent
   re-assert, alongside its two clock triggers. A database whose `0001` predates
   this change is then never left unsealed by a partial deploy.
3. **`0002`'s down script drops only clock objects, then re-asserts the evidence
   seal.** It can no longer end in an unsealed register, on a fresh install or a
   deployed one.
4. **A new `rollback/20261006_0001_incidents.down.sql` is the only disarm path**,
   and it refuses while the register holds any row.
5. **No session gate (`afc.allow_disarm_register`) on `0002`'s down.** See
   Alternative C.
6. **A new suite exercises the reversed state**, not only the forward state, with
   a row count on every refusal so a vacuous pass cannot read as a pass.

## Context

The finding is reproduced by execution on HEAD, not by reading. The reproduction,
in-process PGlite, shipped `0001` then `0002` then the down script, five rows
present:

| identity | baseline (0001+0002) | after `0002.down.sql` |
| --- | --- | --- |
| `directus_app` | refused, `42501` (grant layer) | refused, `42501` (grant layer only) |
| fully-granted app role | refused, `23001` **the trigger** | **succeeded, rows 5 → 4** |
| fully-granted app role, `TRUNCATE` | refused, `23001` **the trigger** | **succeeded, rows 4 → 0** |
| `directus_migrator` (table owner) | refused, `23001` **the trigger** | **succeeded** |

One correction to the framing, and it makes the finding worse rather than better.
`directus_app` is still refused after the reversal, so a check on that identity
alone reads green. The refusal survives only because of the **grant list**, which
is the second layer. `0002`'s own header calls the trigger "THE CONTROL" and
`20_immutability.sql` proves it by granting every v4 role table-level `ALL` — and a
session holding that grant deletes and truncates freely after the down script. The
register is unsealed for exactly the identity Directus uses.

The re-apply drill is sound and stays asserted: re-running `0002` restores all four
triggers, the ordering constraint, and the refusal.

## Why the layering is the root cause

`incidents_forbid_delete` and `incidents_forbid_truncate` are properties of
*"`incidents` is evidence"*, not of *"`awareness_at` exists"*. Neither function
reads a column. `0001`'s own `COMMENT ON TABLE` already says so: *"Rows are
evidence: they transition to closed, they are never deleted."* A control whose
lifetime is coupled to a column it does not read is a control with a reversal path
that destroys it.

## Alternatives considered

**A — Move the guards to `0001` only (the review's preferred fix).** Accepted as
the layering half. Rejected as sufficient: every currently-deployed database
applied `0001` before this change and will never re-run it, so on those databases
`0002`'s down still disarms the register. Fresh installs get fixed; live installs
do not.

**B — Have `0002`'s down re-create the delete and truncate guards (the review's
acceptable alternative).** **Accepted, and this is the load-bearing half for
deployed databases.** Cheapest of the three, and it leaves the guards next to the
column they were written for.

**C — Gate the disarm behind `afc.allow_disarm_register = 'yes'` (the review's
also-acceptable option).** Rejected. Once B is in place the down script never
disarms, so the gate protects nothing; and it would put the only supported
reversal path behind a flag, which is a deploy with no rollback path. The loud
disarm belongs on the down script of the migration that **owns** the guard — that
is decision 4, where it costs nothing and means something. A `RAISE NOTICE` in
`0002.down` records the re-assert in the deploy log without gating anything.

**D — Declare `0002` irreversible and delete its down script.** Rejected. The
clock origin is evidence, but abandonment of a migration is a real scenario, and
"no deploy without a rollback path" outranks it. A safe reversal beats no
reversal.

**E — Fix only this instance, leave the class.** Rejected as a strategy. Every
migration's down script can disarm a control its up script created. Raised as
separate work: a static gate asserting that every object a migration creates is
either owned by an earlier migration or re-asserted by its own down script.

## Consequences

- **Fresh installs:** `0001` alone leaves the register sealed. A `0002` reversal
  keeps it sealed.
- **Deployed installs:** a `0002` reversal keeps it sealed, because the down script
  re-asserts.
- **Accepted cost:** ~40 lines of guard SQL in three places (`0001`, `0002`,
  `0002.down`) plus the `0001.down` guard block. The alternative is a control whose
  lifetime is coupled to a column.
- **Editing applied migrations.** Normally forbidden. Justified here because a
  *forward* migration cannot fix this: the defect is in an already-written down
  script, and nothing that runs later intercepts a file an operator runs by hand.
  Both files are idempotent by construction (`IF NOT EXISTS`, `CREATE OR REPLACE`,
  `DROP TRIGGER IF EXISTS`), and both are in the current release train. Recorded as
  a deliberate tradeoff, not a slip.
- **`0001.down.sql` gains an invariant on its own text.** It must contain only
  statements that are valid inside a plpgsql body, and its `DO $$ … $$` guard must
  stay on `$$`, because `21_register_seal_after_rollback.sql` splices the file into
  a block tagged `$seal$` in order to assert the refusal against the shipped file
  rather than a copy of it. A `SET`, a transaction-control statement or a
  meta-command added to that file will break the suite, loudly.
- **Residual risk, unchanged:** the table owner can still `DROP TRIGGER` by hand.
  That is already asserted in `20_immutability.sql` and answered by the credential
  split, not by this change.

## Verification required

Reproduced by execution, with row counts on every refusal, for the table owner
**and** for a fully-granted app-style session — never for `directus_app` alone,
whose grant-layer refusal reads green even when the control is gone.

## Independent review

There is **no independent security reviewer on this team**; that seat was declined
by the board on cost. The verification named above therefore defaults to the
implementer's own execution, and a CTO self-review is a recorded degradation, not
independent review. Signing this off should be treated as such until the seat
exists.