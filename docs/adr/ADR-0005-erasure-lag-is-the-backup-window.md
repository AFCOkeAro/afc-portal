# ADR-0005 — Erasure lag in backups is bounded by the backup window, not by the erasure mechanism

**Status:** Accepted (decision), CTO 2026-10-06. Security review scheduled. Implementation gated.
**Supersedes:** nothing. **Extends:** [ADR-0002](ADR-0002-roles-are-bootstrap-not-migrations.md) D1–D6
**Origin:** [AFC-169](/AFC/issues/AFC-169). **Affects:** `docs/planning/infra-spec.md` §6,
`docs/planning/prd.md` §7.5, `docs/planning/integrations-spec.md` §6,
`services/directus/schema/engine/0001_retention_engine.sql`,
`services/directus/schema/migrations/`, `services/directus/backup/`

---

## Decision

Three rules, in the order they bind.

1. **No WAL archiving. No point-in-time recovery.** Nightly `pg_dump -Fc` only. The
   stated RPO is ≤ 24h ([infra-spec](/AFC/issues/AFC-147#document-infra-spec) `:218`);
   a nightly full dump already meets it. Continuous WAL archiving buys minute-level
   recovery that no requirement asks for, and it is the one component that makes the
   erasure property unachievable. Removing a requirement is cheaper than building a
   capability, and this requirement was never a requirement — it is an unexamined
   default that appears in [prd.md](/AFC/issues/AFC-147#document-prd) `:329` with no
   rationale attached.
2. **The ladder is 30 daily / 12 weekly / 3 monthly, not 30 / 12 / 12.** The 3 is the
   decision, not the 30 or the 12. Maximum media erasure lag becomes ~90 days.
3. **Restoration is gated on an erasure ledger that lives outside the backup set.** A
   restored database is refused promotion until the ledger has been replayed against
   it and every erased identifier is absent. This is what makes the window survivable,
   and it is the load-bearing part of this ADR.

**Consequence to state plainly: cryptographic erasure is rejected as the primary
mechanism.** [AFC-169](/AFC/issues/AFC-169) recommends Option A. That recommendation is
withdrawn on the evidence below. The arithmetic that rejects it is not a preference
and not a budget judgment — Option A does not do what it claims on a full-database
dump.

---

## Context

The retention engine ([AFC-167](/AFC/issues/AFC-167), `ADR-0002` D1–D6) deletes and
pseudonymises records in the primary PostgreSQL store. It has no relationship to
backups. Backups are specified as a full `pg_dump` of the same database, on a
30/12/12 ladder, and a record erased from the primary store therefore persists in
backup media for up to 12 months and can reappear after a restore drill.

**The position is better than the issue assumed, and that changes the cost of the
decision.** At `HEAD ffe8307` there is **no backup implementation of any kind**:
`services/directus/backup/` is an empty directory, there is no `backup.sh`, no
compose file, no cron or systemd timer, no backup job in `.github/workflows/ci.yml`,
no restore drill, and no runbook. The 30/12/12 ladder exists in four documents and
nowhere else. `docs/ndpa/processor-register.md` `:255-256` records retention
enforcement and backup erasure as **NOT MET**, and `:78` records the resulting lag as
tracked at AFC-169.

So this is not a remediation. It is a specification that has not been built. The
erasure property is therefore available to us at close to zero incremental cost, and
the correct time to decide is before the Coder writes `backup.sh` — not after.

What this ADR does **not** decide: any retention duration. Q9 and Q10 on
[AFC-160](/AFC/issues/AFC-160) set the numbers. Every duration below is a value in a
config table, never a literal, per the retention-literal gate.

---

## The arithmetic that decides this

A backup set is a **full** `pg_dump` of the database. A full dump taken at time `T`
contains every row that existed at `T`. Therefore, for a record `R` created at `t0`
and erased at `t1`:

> **Every set with `T ∈ [t0, t1]` contains `R`.**

Erasure in backup media requires acting on every one of those sets. There are two
ways to act: expire them (Option B) or destroy their keys (Option A).

**The record's lifetime is the interval.** A safeguarding record is held to age 25 by
policy §9, and attendance and giving records run for years. `t1 - t0` is therefore
routinely longer than the entire retained ladder, which means the interval
`[t0, t1]` contains **the whole ladder** — up to 54 sets.

**Therefore Option A on full-database dumps is not selective.** Destroying the keys of
every set containing `R` destroys every set we have. There is no third option:
destroying some of them leaves `R` readable in the others.

Run the arithmetic forward and the shape becomes obvious. The retention job erases
continuously. Every monthly set accumulates at least one erasure within weeks of being
taken, and its key is destroyed at the next sweep. So:

> **Under Option A the GFS ladder decays to the interval since the last erasure
> sweep.** The 12 monthly sets stop existing as a recovery asset, one by one, and the
> deep history we are buying for disaster recovery evaporates on the retention
> schedule rather than on the recovery schedule.

**Option A therefore delivers exactly the outcome of Option B, and additionally
requires a KMS, a written key-destruction procedure, and an audit trail proving
destruction was credible.** AFC-169 priced Option A as "Medium — one key-management
layer over the existing backup job". That is the price of the *easy* version, which is
the version that does not work. The honest price is Option B plus a key service.

Option A becomes selectable only if backup sets stop being full-database — per-class,
per-shard, or per-record. Per-record means one key per row, which is absurd. Per-class
is [AFC-169](/AFC/issues/AFC-169) Option D with a key service bolted on, and Option D
is already rejected on availability grounds: it protects the data legally by making it
harder to recover, which is the wrong direction for the records we can least afford to
lose.

### WAL is worse, and it is not fixable

Continuous WAL archiving creates an append-only stream of physical row versions. A
row deleted in the primary store is still present in the WAL segments written when it
was inserted or updated, until those segments age out on the archive's own schedule.

1. **No key granularity helps.** One archive key over the stream is all-or-nothing.
   Per-segment keys cannot be mapped to a record, because nothing maintains a
   record→segment index and no component could.
2. **The lag floor becomes the WAL archive retention, not the dump retention.** A
   30-day WAL archive puts a 30-day floor under the erasure lag no matter what the
   dump ladder says, which would defeat rule 2 entirely.

The three planning documents also disagree about whether WAL archiving exists at all:
[prd.md](/AFC/issues/AFC-147#document-prd) `:329` says "continuous WAL archiving",
while [infra-spec](/AFC/issues/AFC-147#document-infra-spec) `:213` says "if available"
and [integrations-spec](/AFC/issues/AFC-147#document-integrations-spec) `:116` says
"where available". Rule 1 settles it: **no WAL archiving.**

### The restore gate, and the subtlety that makes it load-bearing

"Re-apply erasure on restore" sounds sufficient and is not, on its own.

> **A restore replaces the live database with an older copy — so the erasure ledger
> stored inside that database is rolled back to before the erasure.**

The restored system comes back with the record present *and* with no memory that
anyone ever asked for it to be gone. The manifest would then be claiming an erasure
the restored system cannot see. This is the defect that makes naive restore-time
re-erasure fail, and it is why the ledger must be external.

Design:

- **`erasure_ledger`** — append-only, hash-chained (`prev_hash`/`entry_hash`), held in
  a store a database restore cannot roll back: object storage with object-lock and
  versioning, written by the retention job, **never included in a `pg_dump`**.
  One entry per erased person per class: `person_id`, `retention_class`,
  `policy_version`, `run_id`, `erased_at`, `covering_backup_sets[]`, `prev_hash`,
  `entry_hash`. Deletion or reordering of an entry is detectable.
- **The ledger is itself personal data.** It holds identifiers. It gets the same
  protection as the primary store, a strictly narrower blast radius, and its own
  retention rule: an entry may outlive the record only for as long as an audit needs
  it. This is a new processor row in
  [processor-register.md](/AFC/issues/AFC-163#document-processor-register) and it must
  be registered, not treated as an implementation detail.
- **The gate is a check with a real failure mode.** Restore into a scratch database,
  replay the ledger, verify zero surviving rows for each `person_id`, then promote.
  Promotion is refused when verification fails. A gate that is a step someone
  remembers is not a gate.

---

## Alternatives considered

| Option | Verdict |
| --- | --- |
| **A. Cryptographic erasure, per-set data keys** (**was** AFC-169's recommendation) | **Rejected on arithmetic, not cost.** A full dump contains `R` in every set in `[t0, t1]`; for a record held to age 25 that is the whole ladder. Destroying those keys destroys all backup history, so A delivers B's outcome plus a key service. It does not deliver erasure faster than the window, which is the only thing it was proposed to deliver. |
| **B. Shorten the ladder to 30 / 12 / 3** | **Adopted, as rule 2.** One config change, no new surface. It buys a true bound: ~90 days, stated in one number, that the privacy notice and the DSAR answer can both use. |
| **C. Do nothing, disclose the lag** | **Adopted as a layer, not as an answer.** Disclosure is mandatory regardless — under rule 3 the honest claim becomes "unreadable in any retained set and cannot re-enter service", which is a claim about non-reappearance and is one we can actually guarantee. |
| **D. Table-level exclusion** | **Rejected, unchanged.** Excluding the sensitive tables from backup sets protects the data legally by making it harder to recover. Safeguarding records are the records we can least afford to lose to a fire. |
| **Re-apply erasure on restore, ledger inside the database** | **Rejected.** The ledger is rolled back by the very restore it exists to inform. |
| **Re-apply erasure on restore, ledger external and hash-chained** | **Adopted, as rule 3.** The only mechanism that makes a restorable copy harmless rather than merely short-lived, and the only one that does not add a key-management surface to a system with a small security budget. |
| **Continuous WAL archiving / PITR** | **Rejected, as rule 1.** No requirement asks for sub-daily recovery; the stated RPO is 24h and a nightly full dump meets it. It sets a hard floor under the erasure lag that no dump-side decision can lower. |
| **Buy per-snapshot key deletion from the backup vendor** | **Deferred, not rejected — and it is the strongest long-term answer.** A managed product that lets you destroy the key for one snapshot collapses the arithmetic above, because the vendor's sets need not be full-database. We have no vendor (gap G4). This becomes a cost probe against the two candidates already named in [processor-register.md](/AFC/issues/AFC-163#document-processor-register) §P2: Hetzner Storage Box/OBJ and Backblaze B2. |
| **One `erasure_deadline` field per class, distinct from the deletion trigger** | **Adopted.** AFC-169 acceptance criterion 3. `retention_policies.erasure_deadline_days`, `NULL` meaning "follow the ladder", an integer meaning "unreadable in every set within N days of erasure". No duration is a literal anywhere; `scripts/retention-literal-gate.sh` must stay green. |

---

## Consequences

**Accepted costs, stated rather than softened**

- **Deep recovery drops from 12 months to 3.** A corruption or a mistaken bulk update
  discovered after 3 months may be unrecoverable from backup alone. This is a real
  availability reduction and the board should hear it from us rather than discover it.
  The mitigation is rule 3, not a longer window: with the gate in place a deeper set
  would be *restorable but stripped*, which is a different and much cheaper promise
  than "restorable". Reinstating a deeper monthly tier is a config change once the
  gate exists, and it is the board's call to make with the cost in front of them.
- **A restore is no longer a copy operation.** It is a pipeline with a verification
  step that can refuse. That is the correct direction — a restore that silently
  resurrects an erased safeguarding record is the worst outcome available to us — but
  it means the restore runbook must be written before the first drill, not after.
- **A new processor row.** The external ledger is a new place personal data lives and
  a new thing that can fail. It needs its own monitor.
- **`retention.run` gains an output it does not have today.** The engine currently
  computes the per-table delete count and discards it
  (`engine/0001_retention_engine.sql:483`, `NULL;`) and `retention_runs.manifest_path`
  is declared and never written (`migrations/20261006_0004_retention.sql:434`). The
  ledger needs erasure scope at table granularity, which is exactly the record
  `ADR-0002` `:147-148` required and only half of which was implemented. This ADR
  makes the missing half load-bearing.
- **The 90-day bound is an engineering bound, not yet a legal one.** Whether 90 days
  is an acceptable erasure lag is Q9-adjacent on [AFC-160](/AFC/issues/AFC-160) and is
  not ours to decide. If counsel requires shorter, the honest answer becomes "build vs
  buy" against a vendor with per-snapshot keys, not "shorten the ladder again" —
  the ladder is already short.

**What the manifest may claim afterwards.** Before: "record deleted at `T`" — true of
the primary store, silent about backups, and readable by anyone as complete. After:

> Record deleted at `T`. Unreadable in every retained backup set. Guaranteed not to
> re-enter service: the restore gate replays the erasure ledger before promotion.

The second claim is about **non-reappearance**, which we can guarantee. The first
claim is about **non-existence in media**, which we cannot, and which shrinks to the
90-day bound by rule 2 and is disclosed by rule C.

---

## Residual risk, stated rather than assumed

- **The gate is bypassable by anyone who restores by hand.** A `psql -d <restored>`
  that skips the gate produces a database containing an erased record, and nothing in
  the database can detect it. Mitigation is the quarterly drill going through the
  documented pipeline only, plus a boot-time assertion that a promoted instance
  carries a promotion marker written by the gate. This is a process control with a
  technical assertion attached — we should not describe it as an enforcement control.
- **Object lock and hash chaining are only as good as the credentials that write
  them.** If the ledger's write credential is compromised, entries can be suppressed.
  The chain makes tampering detectable, not impossible. Treat a chain break as a
  security incident, not a data-quality one.
- **`covering_backup_sets[]` is only as good as the backup job's honesty.** If the job
  does not record its sets accurately, the ledger names the wrong sets. There is
  nothing built yet, so this is a design constraint on the first version of
  `backup.sh`, not a bug to fix later.
- **A restore predating the ledger's first entry has nothing to replay.** In practice
  this is the empty database, which is correct, but it means "the ledger is complete"
  is an assumption the gate must be able to state out loud.

---

## Verification

No ADR ships unverified. The following must be true before this is implemented, and
they are the acceptance criteria for the implementation issue:

1. `pnpm test:db` green, including `DB_TEST_TIMEZONE=Africa/Lagos`, plus
   `pnpm gate:self-test` — the retention-literal gate must still pass with no
   duration literal anywhere in `apps/`, `services/`, `packages/`.
2. A new `tests/db/` suite asserts `retention_policies.erasure_deadline_days` is
   accepted, is honoured, and moves no code path — the config-driven property of D1,
   proven for the new field the same way `60_retention_due_date.sql:107` proves it for
   `floor_years`.
3. The same suite asserts a live `retention.run` emits a ledger entry naming the
   covering sets and the per-table counts that `:483` currently discards.
4. The same suite asserts the gate refuses promotion when a ledger `person_id` still
   has rows, and accepts it when absent. The refusal case is the one that matters and
   must not be able to pass vacuously.
5. The same suite asserts a reordered or edited ledger entry breaks the hash chain.
6. The three planning documents and the processor register agree with rule 1 and rule
   2 — no document still says 12 monthly, and no document still says WAL archiving.

## Reviewers

- **CTO** ([MediaTech](/AFC/agents/mediatech)) — decision of record. Architecture lens
  (the backup set is the right unit of analysis and the ledger is the right seam),
  build-vs-buy lens (buy only if a vendor owns per-snapshot keys), cost lens (rule 1
  is a net saving: it deletes a subsystem).
- **SecurityEngineer** ([securityengineer](/AFC/agents/securityengineer)) — independent
  review of this ADR. It adds a store holding identifiers, a new credential that can
  write to it, and a hash-chained tamper-evidence claim that is only as strong as the
  credentials behind it. Least-privilege lens applies to the ledger writer exactly as
  it applies to `retention.run`.
- **CEO** ([operations](/AFC/agents/operations)) — the DR-depth reduction in
  "Consequences" is an availability trade and a cost, and it is the CEO's to accept
  or to take to the board.
- **Safeguarding Lead** — the erasure runbook wording, once numbers land.

## The rule, in one line

> A full backup set is all-or-nothing: it holds every record that ever existed in it,
> so erasing one record from media costs you the set, and the set is the whole window.
> Decide the window first, make it short, drop WAL, and then gate the restore —
> because a restore rolls back the very ledger that records the erasure.

## What this ADR deliberately does not do

It does not set a retention duration, decide Q9 or Q10, choose a backup vendor, or
answer the cross-border question for the backup destination. It fixes the mechanism,
so that whatever number counsel returns lands in `retention_policies` as a row update
rather than as a rebuild — which was the whole point of building it before the
opinion arrived.
