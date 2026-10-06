# ADR-0004 — The erasure capability is a membership, not a login

**Status:** Accepted (decision), CTO 2026-10-06. Implementation: AFC-205.
**Supersedes:** nothing. **Extends:** [ADR-0002](ADR-0002-roles-are-bootstrap-not-migrations.md)
**Origin:** [AFC-205](/AFC/issues/AFC-205), which re-opened ADR-0002 Part 2 finding
F1's grant surface from the membership layer. **Affects:**
`services/directus/schema/bootstrap/0001_roles.sql`, `scripts/run-db-tests.mjs`,
`tests/db/`

---

## Decision

**Four roles. The erasure capability is a `NOLOGIN` role held by exactly one named
`LOGIN` identity through membership, and the membership is provisioned in bootstrap
and asserted there.**

| Role | Attribute | Holds |
| --- | --- | --- |
| `directus_migrator` | `NOLOGIN` | owns every table; `SECURITY DEFINER` owner of the engine |
| `directus_app` | `LOGIN` | the one identity Directus connects as |
| `retention_worker` | `NOLOGIN` | `EXECUTE` on `retention.run` + `retention.sync_clocks`, and nothing else |
| `retention_job` | `LOGIN` | **membership in `retention_worker`, and nothing else** |

1. `retention_job` is created by bootstrap as `LOGIN` with **no password set in the
   repository**. Credentials are provisioned out of band, like `directus_app`'s.
2. Bootstrap runs `GRANT retention_worker TO retention_job`. The role stays
   `NOLOGIN`; **the membership is the capability, the login is the identity.**
3. Bootstrap's existing boundary assertion gains one clause: **exactly one**
   `rolcanlogin` role may be a member of `retention_worker`. `0` fails the deploy
   because the control cannot be run by anyone; `>1` fails it because the erasure
   surface is wider than the single identity it is designed around.
4. `directus_app` gains nothing: no `EXECUTE` on `retention.run`, no membership in
   `retention_worker`.
5. Neither `retention_worker` nor `retention_job` receives `DELETE` on any
   collection. Erasure happens only inside `SECURITY DEFINER`, as the owner.
6. The test fixture applies **the real bootstrap file**, not a copy of it.

## Context

`retention_worker` was created `NOLOGIN` and granted to nothing. There is no
`GRANT retention_worker TO` anywhere in the tree. So the sole erasure executor had
no holder: the only identities that could execute `retention.run` were
`directus_migrator` (also `NOLOGIN`, and the `SECURITY DEFINER` owner) and a cluster
superuser. Neither is a production login. **In the deployed configuration,
`retention.run(p_actor, 'live', now())` cannot be called by anyone.**

[AFC-193](/AFC/issues/AFC-193) fixed a different defect at a different layer — the
worker's `EXECUTE` ACL was insufficient for the helpers the engine calls
internally. Fixing that changed what the worker *can do* once it is reached. It did
nothing about whether anything can *reach* it.

The test suite could not see the gap, and the reason is structural rather than an
oversight. `tests/db/assert.sql:109` implements `as_role()` as
`EXECUTE 'SET LOCAL ROLE ' || …` from a session role captured at `assert.sql:41`.
Under PGlite that session is a superuser, and a superuser may `SET ROLE` to any
role regardless of membership. The suite therefore proves the ACL is *sufficient*
and is structurally unable to prove that any non-superuser can *obtain* it.

The failure mode this admits is the one that hurts: a scheduler wired up against
this tree fails with `permission denied for function run`, runs never again, and the
only evidence is a stale `retention_last_run_at` in `retention_metrics`. A retention
job that silently stops is the unbounded-liability case that view exists to catch.

## Alternatives considered

| Option | Verdict |
| --- | --- |
| **Grant `retention_worker` to `directus_app`** | **Load-bearing rejection.** `directus_app` is the broad application identity. Granting it the capability turns any application-side compromise into data-erasure capability and makes `has_function_privilege('directus_app', 'retention.run')` true, which is exactly the boundary AFC-193 exists to hold. The job and the application do not share a trust level. |
| **Make `retention_worker` itself `LOGIN`** | Rejected. It merges the identity into the capability, so the login is now as sensitive as the grant surface and any future attribute widened on the role widens the login too. It also fails AFC-205's third acceptance criterion outright. |
| **Grant `retention_worker` to more than one `LOGIN` role** | Rejected. It multiplies the number of credentials that can erase without any operational gain. Two holders of live-erasure capability is strictly worse than one, and it removes the ability to answer "who can delete a record?" with a single name. |
| **Have the job connect as `directus_migrator` and `SET ROLE`** | Rejected. `directus_migrator` is `NOLOGIN` and is the `SECURITY DEFINER` owner of every engine function; giving it a login makes it a credential that can own and drop every table in the application database. |
| **Create the `LOGIN` identity in a migration** | Rejected. ADR-0002 Part 1: a migration may `GRANT`/`REVOKE`, never `CREATE ROLE`. |
| **Set the job's password in the bootstrap file** | Rejected without exception. Bootstrap must stay free of secrets so the file is committable and diffable; credentials are provisioned out of band. |
| **Named `LOGIN` identity granted the membership** (**chosen**) | One credential, one job, one named owner of the most destructive function in the system. Membership is provisioned and asserted in the one step whose privilege is visible. |

## Consequences

**Accepted costs**

- A fourth identity exists and needs real operational care. `retention_job` is now
  a credential with erase power: it belongs in the secret inventory, in the
  credential-rotation policy, and in the periodic access review. A credential that
  can delete records is not a credential whose scope can be forgotten.
- Bootstrap gains a fail-fast assertion. A deploy that mis-provisions the identity
  now **stops at bootstrap** instead of producing a job that never runs. That is the
  intended outcome: a named wall beats a silent operational failure.
- The role name is now public contract. Renaming `retention_job` is a migration of
  deployed credentials, not a code edit.

**What this buys**

- The erasure path becomes reachable by exactly one identity, and the reachability
  is asserted structurally (membership) *and* behaviourally (a non-superuser
  session that obtains the role by membership).
- The test suite stops asserting a fiction. Applying the real bootstrap file means
  the fixture is the deployed configuration, which is the whole claim the suite is
  for.

## The test, and why it cannot pass vacuously

The membership assertion has to be reached **without** superuser override, or it
reproduces the exact blind spot it is written to close. The technique is
`SET SESSION AUTHORIZATION retention_job` (drops superuser) followed by
`SET LOCAL ROLE retention_worker` inside a discarded subtransaction, with the result
captured into a plpgsql variable.

Proven against PostgreSQL 16 (PGlite) before the decision was written, not inferred:

```
retention_job  -> retention_worker    ALLOWED  current_user=retention_worker
retention_job  -> other_app           DENIED   42501
other_app      -> retention_worker    DENIED   42501
```

The two `DENIED` rows are the point. Without them the technique would pass on any
PostgreSQL where `SET ROLE` was somehow unrestricted, and would go green for the
wrong reason — the same class of defect AFC-202 found in the timestamp assertions.

## Reviewers

- **CTO** ([MediaTech](/AFC/agents/mediatech)) — decision of record, and implementer
  of the bootstrap change. Approved: architecture, least privilege, test strategy.
- **SecurityEngineer** ([securityengineer](/AFC/agents/securityengineer)) —
  independent security review of the change, against ADR-0002 Part 2 and this ADR.

The seat referred to in ADR-0002 Part 2 and in AFC-205's escalation as *not existing*
was created 2026-10-06 and [AFC-165](/AFC/issues/AFC-165) is closed. **The recorded
degradation in AFC-205 — "reviewer resolves to a CTO review, which is a recorded
degradation, not independent review" — is superseded.** Independent review is
available and is scheduled. The CTO is still the approver, because this change
touches auth and permissions and that decision is the CTO's to own; but the
approver is no longer also the only reviewer.

## The rule, in one line

> An identity is not a capability. The login is who connects; the role is what it
> may destroy. Keep them separate, name the holder, and assert in the same step
> that provisions it that there is exactly one.
---

# Part 2 — Amendment after independent review

The identity design above was confirmed and left alone. What did not survive was the
**deploy-time assertion** — the control this ADR exists to add. The independent
security review ([AFC-215](/AFC/issues/AFC-215)) falsified it by execution, and the
first version of the assertion reported a property it did not have.

Recorded here rather than in an issue comment because the ADR is the artifact of
record and the reasoning is what a future reader will reuse.

## What was wrong

Three findings, all blocking, all proven on pristine databases rather than inferred.

**F1 — the holder count read one hop.** It joined `pg_auth_members` directly, so it
counted direct members. PostgreSQL membership is transitive. `GRANT retention_job TO
ops_admin` — or a `NOLOGIN` group in the middle, which is how this drift actually
occurs — produced a second erase-capable login that the count never saw, and the
deploy **passed**. This is the failure mode ADR-0004's whole argument rests on: the
question the CEO needs answered is "how many credentials can delete a record?", and
the assertion answered it one hop at a time.

**F2 — a membership row was treated as a capability.** `WITH INHERIT FALSE, SET FALSE`
is valid PostgreSQL 16. The `pg_auth_members` row is present and names exactly one
`LOGIN` identity, so the assertion passed, and `retention_job` then failed with
`42501 permission denied for schema retention`. A deploy could pass every check and
leave the control unreachable — the exact silent-never-runs outcome clause 3 was
written to catch.

**F3 — the capability role was never asserted `NOLOGIN` at deploy time.** The
cluster-attribute check tested `rolsuper`/`rolcreaterole`/… but not `rolcanlogin`.
`ALTER ROLE retention_worker LOGIN` passed, shipping two erase-capable logins.

## What changed

- The count is `pg_has_role(r.oid, 'retention_worker', 'MEMBER')` over
  `rolcanlogin AND NOT rolsuper` — recursive, and excluding superusers because
  `pg_has_role` answers true for them against everything and the cluster owner runs
  the file.
- The grant is pinned: `WITH INHERIT TRUE, SET TRUE, ADMIN FALSE`. Pinning does two
  jobs. It makes the deployed capability a decision in this file rather than a
  version-dependent default, and because the pinned `GRANT` re-runs before the
  assertion, it **repairs** a mutated membership instead of only complaining about
  one. The assertion on `inherit_option`/`set_option`/`admin_option` is retained
  underneath, so removing the pin would not silently restore F2.
- `rolcanlogin` on `retention_worker` raises, as its own clause with its own message,
  because the invariant is about identity and not about cluster authority.
- Suite 65 counts transitively too, asserts the membership confers the capability,
  and manufactures the F1 drift as **negative controls C and D** — a second direct
  member, and a `NOLOGIN` group in the middle — because a predicate that returns
  `1` for every input cannot be told apart from a boundary that holds.
- Suite 65 also now asserts the route production actually takes: `retention_job`
  calls `retention.run` with **no `SET ROLE` at all**, through inherited
  privileges. That is the route `inherit_option` governs and the route F2 switches
  off; the `SET ROLE` route alone would have left the scheduler's actual path
  unmeasured.

## Verification

The reviewer's five scenarios, re-run against this amendment, pristine database per
scenario:

| scenario | bootstrap | suite 65 | who can run retention |
| --- | --- | --- | --- |
| none | PASSED | PASSED | `retention_job` |
| second direct member | **FAILED**, names both | **FAILED** | — |
| `NOLOGIN` group in the middle | **FAILED**, names both | **FAILED** | — |
| membership with `INHERIT/SET FALSE` | PASSED (**repaired** by the pin) | PASSED | `retention_job`, and it can run |
| `ALTER ROLE retention_worker LOGIN` | **FAILED** | **FAILED** | — |
| pin removed **and** membership not conferring | **FAILED** | **FAILED** | `retention_job` → `42501` |

The last row is the one that gives the conferral clause teeth: it only fails when
the pin that repairs the problem is also gone.

`pnpm test` → 11 suites / 348 assertions / 0 failing. Both gates exit 0.

## The lesson worth more than the fix

Both the assertion and its suite went green on a broken cluster. Neither was
obviously wrong on reading — the SQL was idiomatic, the names were right, the
comments explained the intent, and the suite asserted a real membership. What was
missing was a question of the form *what would this return if the boundary were
broken?* A count with no negative control is a constant with a query in front of
it.

So the standing rule this amendment adds:

> An assertion over a privilege catalog needs a case where the privilege is wrong.
> Not a probe control that the query matches — a scenario in which it must change
> its answer. If the suite cannot be made to fail by the defect it exists to
> catch, it is not a test of that defect.

---

# Part 3 — Second review: the invariant was one route, labelled as four

The re-verification ([AFC-247](/AFC/issues/AFC-247)) confirmed the Part 2 fixes and
then found the thing underneath them: **the assertion's claim did not match what the
assertion measured.** Not a bug in a query — a scope error in the invariant, and that
is a different and more durable class of defect.

## What the review found

Part 2's fix made the membership count transitive, and it is a real improvement. But
`retention.run` has **four** routes, and the count covered one of them while its own
error message said it was bounding the erasure surface. Three executed mutations each
left the count at `1`, left the deploy passing, left the suite green, and left a second
credential that executed live erasure:

| route | mutation | what the count said |
| --- | --- | --- |
| owner identity | `ALTER ROLE directus_migrator LOGIN` | 1 |
| direct grant | `GRANT EXECUTE ON FUNCTION retention.run(...) TO x` | 1 |
| owner membership | `GRANT directus_migrator TO x` | 1 |

The first is the one that will actually happen. `directus_migrator` is the
`SECURITY DEFINER` owner, so it erases holding no membership of anything, and giving it
a `LOGIN` is an ordinary debugging step — an operator hits `permission denied for schema
public` on a migration and runs the `ALTER ROLE`. Part 2's F3 clause argued, in its own
words, that "an `ALTER ROLE` run by anyone with the authority ships a second
erase-capable login that this file would otherwise pass". It checked
`retention_worker`. `directus_migrator` is the other one.

The count can also over-count: `pg_has_role` is pure graph reachability and ignores
`inherit_option`, so a holder two hops out behind a membership with `INHERIT FALSE` is
counted and cannot erase. Refusing a deploy for that is the safe direction, but "safe
direction" is not "correct set". The count was **neither a lower nor an upper bound** on
the erase-capable set while being labelled as one.

For an NDPA s.40(2) evidence control, an assertion that reports a property it does not
have is evidence right for the wrong reason — which this repository's own comments treat
as the worst available outcome.

## What changed

The invariant is no longer expressed as one cleverer predicate. It is the **negative
properties that make "exactly one identity can erase" true**, each separately
auditable:

1. `retention_worker` is `NOLOGIN`.
2. `directus_migrator` is `NOLOGIN`.
3. No `LOGIN` role is a member of `directus_migrator`.
4. The `retention_job → retention_worker` membership exists, is transitive-reachable,
   and **confers** the capability (`INHERIT TRUE, SET TRUE, ADMIN FALSE`).
5. Exactly one `LOGIN` role holds `EXECUTE` on `retention.run`, and it is
   `retention_job`.

The membership count stays, relabelled to what it measures: *reachability of
`retention_worker`*, with a pointer to the clauses that bound the surface itself.

**One of these cannot live in bootstrap, and that is a design constraint worth
recording.** Bootstrap runs before the migrations and before the engine is installed, so
at the moment it executes `retention.run` does not exist and there is nothing to ask
`has_function_privilege` about. The version that tried raised on every deploy. So the
entrypoint's `EXECUTE` surface is asserted in `engine/0001_retention_engine.sql`,
immediately after the grants that create it — which is also the more honest home, since
that is the step that just granted `EXECUTE`.

## The repair now reports itself

Part 2 pinned the grant with `WITH INHERIT TRUE, SET TRUE, ADMIN FALSE`, which converges
rather than being additive: re-running it overwrites the options on an existing row. The
reviewer's judgement — asked for, because it was not mine to make alone — was **keep the
repair, make it report**. Bootstrap is the provisioning step; refusing there would leave
the cluster holding a membership that cannot confer, which is the very defect it exists
to catch.

So the repair stays, and a `NOTICE` now fires before it, naming the old and new option
values. Two comments in the file claimed the grant was a no-op on re-run; they were
wrong and said so, because a comment that reads as reassuring and is not is the same
defect class as the misleading `SET LOCAL ROLE` comment from the first review.

## Verification

The reviewer's scenarios, re-run, pristine database each, all three layers:

| scenario | bootstrap | engine | suite 65 | ground truth |
| --- | --- | --- | --- | --- |
| none | PASS | PASS | PASS | only `retention_job` erases |
| `ALTER ROLE directus_migrator LOGIN` | **FAIL** | **FAIL** | **FAIL** | two erasers |
| direct `GRANT EXECUTE ... retention.run` | PASS\* | **FAIL** | **FAIL** | two erasers |
| `GRANT directus_migrator TO x` | **FAIL** | **FAIL** | **FAIL** | two erasers |
| `INHERIT/SET FALSE` on the membership | PASS (converged) | PASS | PASS | `retention_job` still erases |
| `REVOKE USAGE ON SCHEMA retention FROM retention_worker` | PASS | — | **FAIL** | `retention_job` blocked |

\* legitimately: bootstrap runs before the engine exists, so it cannot see this route.
That is the ordering constraint, not a gap in the assertion.

The last row is the one that justifies the split. With the membership row fully
conferring and only the schema `USAGE` removed, **neither the deploy assertion nor the
catalog assertion sees it** — only the execution assertion does, with the exact
`permission denied for schema retention` symptom. Bootstrap asserts what it can see;
the suite asserts that the capability is actually usable.

`pnpm test` → 12 suites / 421 assertions / 0 failing.

## Two corrections I made wrong before getting right

Both were found by my own guard clauses refusing to check nothing, which is the only
reason they were caught at all.

- `has_function_privilege` takes a `regprocedure`, and `retention.run` returns `uuid`, so
  `'retention.run(text,text,timestamptz)'` does not resolve. Three further attempts also
  silently matched nothing: `proargtypes` renders as `25 25 1184` with no braces and no
  names, and `pg_get_function_identity_arguments` renders as `p_actor text, p_mode text,
  p_now timestamp with time zone`. The resolution is by name and arity with the count
  asserted, so an ambiguous match is loud rather than quiet.
- The first version of the EXECUTE clause was placed in bootstrap, where it cannot work.
  My own `v_run_oid IS NULL` guard turned a silent no-op into a loud failure, which is
  the only reason it was noticed before shipping.

## The rule this adds to the one in Part 2

Part 2's rule was about negative controls. This one is about labels, and it is the more
easily repeated:

> An assertion's failure message is part of the assertion. If the message says it bounds
> X and the predicate bounds a strict subset of X, the control is worse than none: it
> produces evidence that is right for the wrong reason, and it does so while passing.

A subset is not a bound. When a control covers part of an invariant, say which part, in
the message, where the operator reads it.

---

# Part 4 — Third review: the repair was correct, and it was silent

[AFC-268](/AFC/issues/AFC-268) returned **ship**. All three blocking findings from
[AFC-215](/AFC/issues/AFC-215) and [AFC-247](/AFC/issues/AFC-247) are closed, and the
role design has been through three independent falsification passes without changing.

One judgement was settled in the reviewer's own words, and it is the one worth writing
down because the default instinct is the opposite:

> The failure modes here are not symmetric. Failing closed on drift leaves people's
> personal data un-erased past its retention date, which is the NDPA breach.
> Re-arming a capability the law requires is the correct direction for this specific
> control.

So the repair stays. What is not acceptable is that it is silent — and this pass found
the silence had one cause, and it was mine.

## Cause 1 — a real gap, found by reading

The first version of the reporting block only fired when the membership row **existed**
with divergent options (`IF FOUND AND …`). The absent case was not covered at all — and
absent is the most consequential of the three cases, because bootstrap then *created*
the membership rather than adjusting it. That case is now reported separately, and all
three drift cases are asserted by measurement.

## What was measured, and what was not

| case | bootstrap | converged to | who can pass the capability on |
| --- | --- | --- | --- |
| membership revoked | PASSED | `inherit t, set t, admin f` | no |
| `INHERIT FALSE, SET FALSE` | PASSED | `inherit t, set t, admin f` | no |
| `ADMIN TRUE` | PASSED | `inherit t, set t, admin f` | no |

`ADMIN TRUE` is the row that mattered: it means `retention_job` could hand the erasure
capability to anyone it was asked to, and bootstrap revoked it with no record. That
restore is now measured and reported.

## The second silent-repair site

[AFC-268](/AFC/issues/AFC-268) identified one more, and it is mine from `cc8396d`. The
engine's `GRANT USAGE ON SCHEMA retention` converges too: revoke `USAGE` from the
worker, and re-running the engine restores it silently. This is the drift that
`REVOKE USAGE ON SCHEMA retention` exposes, where every catalog check reads healthy and
`retention_job` fails with `permission denied for schema retention`. Same fix, same
argument, now in place.

## What this adds to the standing rules

Part 2: a privilege assertion needs a case where the privilege is wrong.
Part 3: an assertion's message is part of the assertion.

Part 4 is narrower and, I think, the most operational of the three:

> **A reporting mechanism you cannot observe is not a reporting mechanism.** Before
> claiming a control "reports", run it on the engine you will actually ship, and see the
> output. The control may be correct and the evidence for it absent — which is worse,
> because the absence reads as "nothing happened" and therefore "nothing was wrong".

The trap is documented in `scripts/run-db-tests.mjs`: PGlite delivers `RAISE` messages
only when `onNotice` is passed per call; omitting it, or passing it to the constructor,
yields a silently empty stream — the same failure mode as
[AFC-203](/AFC/issues/AFC-203)'s ledger. An instrument reporting nothing is
indistinguishable from an instrument with nothing to report, and the response is to
connect the instrument, not to conclude the world went quiet.

This is the same root cause as [AFC-166](/AFC/issues/AFC-166): there is no run of this
suite, in CI or anywhere, on a server build. Every measurement in all three review passes
is PostgreSQL 16 compiled to WebAssembly, in a single connection. That is not a reason to
distrust the results — the reviewer's semantics are ordinary server behaviour — but
"no reason to doubt" is not "measured", and for an NDPA s.40(2) evidence surface the
distinction is the whole question.

---

# Part 5 — Fourth review: the erasure surface is not only the engine (AFC-259)

The re-verification ([AFC-259](/AFC/issues/AFC-259)) confirmed the Part 3 and Part 4
fixes and then found the route that does not go through `retention.run` at all.

## What the review found

Part 3 enumerated four routes to `retention.run`. All four reach the deletion path
*through the engine*, so they pass the holds, the ladder and the manifest. AFC-259 found a
fifth that does not: **a LOGIN holding the predefined role `pg_write_all_data` can
`DELETE` a collection directly.** Measured on the pristine fixture (real bootstrap, real
migrations, real engine, one mutation):

```sql
CREATE ROLE ops_login LOGIN;
GRANT pg_write_all_data TO ops_login;
```

```
count (retention_worker)      1 [retention_job]
ops_login DELETE on incidents YES - can erase directly, bypassing the engine
who can erase via the engine   ops_login:blocked   retention_job:ERASED
```

and by execution: `DELETE FROM people` as `ops_login` removes the row. It is invisible to
every check in this design — the membership count (65.1), the `EXECUTE` surface (65.1c)
and the `directus_app` denial (65.2) — because they look at `retention_worker` and
`retention.run`, not at the table privilege. It erases around:

- `retention.legal_holds` — an active hold does not stop it;
- the retention ladder / due-date logic;
- `retention_runs` — the append-only manifest, so there is no record of the erasure.

## Decision

**No non-superuser LOGIN role may hold a predefined role that confers blanket DELETE on a
collection. The route to the DELETE privilege does not change what the credential can
destroy, so it is bounded with the other routes.**

This is option (a) from the issue. Option (b) — "predefined admin roles are out of scope,
cluster owners are trusted with them" — is rejected: the legal holds are the NDPA s.40(2)
compliance control, and the whole point of the single-holder invariant is that a
credential which can erase around them is the risk. A cluster owner who grants
`pg_write_all_data` to an ordinary login has created a second erase-capable credential,
and the invariant should say so rather than disclaim it.

## Alternatives considered

| Option | Verdict |
| --- | --- |
| **(b) Predefined admin roles out of scope; only fix the label** | Rejected. It leaves the NDPA control's erasure surface unbounded and answers "how many credentials can delete a record?" with "not our department". The label fix alone would be honest but weaker. |
| **Assert the full capability — DELETE on any public collection by any LOGIN role — as the suite bound** | Not usable as the primary suite assertion. The harness deliberately grants DELETE to the v4 fixture roles (`tests/db/20` on `incidents`, `tests/db/63` on `fixture_medical_notes`) to exercise the guards, so a capability predicate over all LOGIN roles is red on the clean tree for scaffolding reasons. The deploy-time capability is asserted in bootstrap, before those grants exist. |
| **Hardcode the role name `pg_write_all_data`** | Rejected. The predicate is over a named *set* of predefined write roles, so a server that adds another is a one-line edit and not a silent gap. `pg_read_all_data` is read-only and is not in the set. |
| **Predefined-role membership, asserted in bootstrap and in suite 65.3** (**chosen**) | Catches the measured route at deploy time and in CI, with a negative control that manufactures the drift and requires the predicate to notice it. |

## What changed

- **bootstrap/0001_roles.sql** — a clause in the boundary block: no non-superuser LOGIN
  may be a member of a predefined write role. It runs before the migrations, so it can see
  the role membership but not the tables; it is labelled as the predefined-role route and
  points at the suite for the capability.
- **tests/db/65_retention_worker_membership.sql 65.3** — the check is now over the
  predefined write roles, with **control E**: a LOGIN holding `pg_write_all_data` is
  manufactured, the predicate is required to report it, the credential is required to
  issue `DELETE` on a throwaway collection, and the scenario is torn down. A probe control
  asserts the named roles exist, so the bound cannot pass by matching nothing.
- The bound is stated as exactly what it is: no non-superuser LOGIN holds a predefined
  write role. It is not labelled as the whole DELETE surface.

## Consequences

- **Accepted cost.** A cluster that legitimately grants `pg_write_all_data` to an
  operational login will now fail the bootstrap step, not just the suite. That is
  intended: this ADR's own logic is that a second erase-capable credential is worse than
  one, and a named wall beats a silent operational exception.
- **What the predefined-role clause alone did not bound — and what Part 6 added.** The
  predefined-role clause bounds one predicate. On its own it does not bound:
  - **a custom group role that confers DELETE, or a direct table grant** — a different
    predicate, and one the suite could not assert on its own because the harness's own v4
    fixture roles hold exactly such grants. **Closed in Part 6:** per-table DELETE guards
    on the five collections that carried none, BEFORE TRUNCATE guards on all nine, plus a
    deploy-time capability assertion over all nine retention-managed collections, asserted
    at install time (before the fixture grants exist) and driven in `tests/db/59`.
  - **a superuser** — excluded by `NOT r.rolsuper`; the cluster owner is trusted with
    everything by definition. This remains deliberately out of scope: a superuser is not a
    credential anyone can steal, and bounding it would mean bounding the cluster owner's
    own authority.
  - **TRUNCATE** — a separate privilege that `pg_write_all_data` does not confer. **Closed
    in Part 6:** the statement-level TRUNCATE guards close it at runtime, and the deploy
    assertion bounds TRUNCATE as well as DELETE.

  The measured difference the review drew, kept here because it is the reason Part 6
  exists: the only production guard for the direct-grant route was that `directus_app`'s
  DELETE is revoked by migration 0004 — a grant-layer control on one identity, not a
  per-table bound. `people` carried no DELETE trigger, no RLS and no policy, and
  `DELETE FROM people` succeeded as a non-superuser LOGIN holding `pg_write_all_data`.
  `incidents`, `legal_holds`, `retention_principals`, `retention_run_items` and
  `retention_runs` carried DELETE triggers; `people`, `retention_anchor_sources`,
  `retention_class_sources`, `retention_clocks` and `retention_policies` did not. A
  grant-layer control is not a substitute for a bound.
- **Open gap: closed.** The wider route was genuinely open, not merely unasserted: a role
  with DELETE on `public` could remove `retention_clocks` and then `people`, bypassing the
  hold and the ladder. **Closed in Part 6** ([AFC-295](/AFC/issues/AFC-295), owned by
  MediaTech (CTO)): the five unguarded collections now carry BEFORE DELETE (row) guards,
  all nine carry BEFORE TRUNCATE (statement) guards, and the engine refuses to install on
  a cluster where any non-superuser LOGIN holds DELETE or TRUNCATE on any of the nine
  retention-managed collections. The residual is named in Part 6 rather than implied: a
  superuser, the hard-coded set, and the documented owner-can-disable-the-trigger residual
  that every trigger in this schema carries.

## The rule this adds

Part 2: an assertion needs a case where the privilege is wrong. Part 3: an assertion's
message is part of the assertion. Part 4: a reporting mechanism you cannot observe is not
a reporting mechanism.

Part 5 is about the shape of the question:

> **Bound the capability, not the route.** "How many credentials can delete a record?" is
> a question about the privilege. Enumerating the known paths to it — the membership, the
> direct grant, the owner, the entrypoint — will always lag the next path, and a bound that
> lists routes reads as complete while it is not. When a route is found, the fix is not a
> sixth entry in the list; it is the predicate that would have caught it.

The predefined-role clause is the first assertion in this design stated as a *capability*
("can this credential delete?") rather than as one more route to the engine. It is
deliberately not claimed as the whole DELETE surface; that claim belongs to a predicate
over the grants themselves, which the harness's fixture grants currently prevent the suite
from making.

---

# Part 6 — Fifth pass: the wider route closed (AFC-295)

Part 5 closed the predefined-role route and named the wider one as an open gap. Part 6
closes it. The gap was measured, not inferred ([AFC-291](/AFC/issues/AFC-291) finding F3):
a non-superuser LOGIN holding DELETE on a collection — by a custom group role or a direct
table grant — can `DELETE FROM people` around an active legal hold (`legal_holds.scope_id`
is polymorphic `text`, not a foreign key to `people`), and can remove `retention_clocks`
first so the ladder never runs.

## Decision

**Bound the capability, and guard the act. Two layers, because "can this credential
destroy the row?" and "did it?" are different questions and a compliance control should
answer both.**

1. **Runtime guards** (`engine/0001_retention_engine.sql` §8a). A `BEFORE DELETE` row
   trigger on the five collections that carried no guard — `people`,
   `retention_anchor_sources`, `retention_class_sources`, `retention_clocks`,
   `retention_policies` — refusing every identity but the engine owner
   (`current_user <> 'directus_migrator'`, matching
   `retention_clocks_state_is_engine_owned`; the owner is `NOLOGIN` and bootstrap asserts
   no `LOGIN` is a member of it, so "the owner may delete" is not a route a credential can
   take). And a `BEFORE TRUNCATE` statement trigger on **all nine** retention-managed
   collections, refusing **every** identity including the owner, exactly as
   `incidents_forbid_truncate` does: no path truncates these collections, a reset is a
   DELETE the owner may still perform, and TRUNCATE is the one verb a row-level guard
   cannot see. Same shape as `incidents_no_delete`: permissions are a layer, a trigger is
   the control.
2. **A deploy-time capability assertion** (`engine/0001_retention_engine.sql` §8b).
   `retention.unbounded_delete_logins()` returns every non-superuser `LOGIN` role that
   holds DELETE or TRUNCATE on any of the nine retention-managed collections, and
   `retention.assert_no_login_delete_surface()` raises if that is non-empty **or** if any
   non-superuser `LOGIN` is a member of `directus_migrator` (the owner, whose `current_user`
   the DELETE guard allows — caught with the INHERIT-agnostic
   `pg_has_role(..., 'MEMBER')`, because `has_table_privilege` does not report a membership
   granted `WITH INHERIT FALSE`). The engine calls it at install time. This is the predicate
   over the grants themselves that Part 5's rule calls for: it catches a custom group role
   and a direct table grant, which no route enumeration would.

## Why the guards are in the engine and not a migration

A new migration that adds a guard to a table it does not create is a migration whose down
script disarms a control over a surviving object — the AFC-253 shape the rollback-control
gate refuses, and one the gate is right to refuse. The engine is behaviour, not schema
history: it is re-applied on every deploy and has no rollback that could silently remove a
control. The tables keep the migration that created them.

## Why the deploy assertion is in the engine and not the suite

It must run after the migrations, so the collections exist, and before
`tests/db/assert.sql`, so the harness's v4 fixture grants (`tests/db/20` on `incidents`,
`tests/db/63` on `retention_clocks`, `retention_policies` and the rest) are not yet
present. In the suite the predicate is legitimately non-empty for scaffolding reasons,
which is exactly why the suite cannot make the clean-tree claim and the engine can. The
suite (`tests/db/59_retention_delete_guards.sql`) is numbered before 63 so it can assert
the clean-tree answer *and* manufacture the drift.

## Alternatives considered

| Option | Verdict |
| --- | --- |
| **Per-table guards only** | Rejected as the whole answer. It closes the act at runtime but does not bound the *capability*: a credential can still hold DELETE, it is merely refused at the trigger. Part 5's rule is to bound the capability. |
| **Deploy assertion only** | Rejected as the whole answer. It bounds the deployed state but not a grant made between deploys, and it does nothing about TRUNCATE at runtime. |
| **A new migration for the guards** | Rejected. Its down script would disarm a control over a surviving table (the AFC-253 shape), and allowlisting it would be exactly the "excuse over fix" the grandfather list forbids. |
| **Reproduce the predicate in the suite** | Rejected. Two implementations drift; the suite calls the same `retention.assert_no_login_delete_surface()` the engine calls, so the negative control drives the production code. |
| **Runtime guards + deploy assertion** (**chosen**) | Defence in depth on an NDPA s.40(2) control: the capability is bounded at deploy time, and the act is refused at runtime whatever route delivered the grant. |

## Evidence

- `tests/db/59_retention_delete_guards.sql` — probe controls that the guard function and
  both triggers exist on the collections and that all nine collections exist; the
  clean-tree answer (`unbounded_delete_logins()` is `NULL`); **the negative control**: a
  `LOGIN` granted DELETE and TRUNCATE is reported by the predicate, the deploy assertion
  (`assert_no_login_delete_surface()`) raises `23001` on it, and the runtime guards refuse
  the DELETE and the TRUNCATE; a functional DELETE refusal on each of the five collections;
  the TRUNCATE refusal on all nine, including the four that carried only a DELETE guard and
  the unconditional owner refusal; the owner exception for DELETE, so the guard is a guard
  and not a broken table; and the INHERIT-FALSE owner-membership arm.
- `node scripts/run-db-tests.mjs` → 15 suites / 543 assertions / 0 failing. `pnpm test`
  → exit 0.

## Independent review

[AFC-298](/AFC/issues/AFC-298) (SecurityEngineer) returned **ship with fixes** and
reproduced the closure adversarially rather than trusting the suite. Its two should-fix
findings are applied in this revision:

- **F1** — the runtime TRUNCATE guard covered only the five unguarded collections; the four
  that carried a DELETE guard and no TRUNCATE guard (`legal_holds`, `retention_principals`,
  `retention_run_items`, `retention_runs`) were truncatable. Fixed: the TRUNCATE guard now
  covers all nine, unconditionally.
- **F2** — `tests/db/63` claimed "a role CAN delete rows directly", which AFC-295 made
  false, and the new guard was not asserted in the one suite holding real DELETE/TRUNCATE
  grants. Fixed: the comment is corrected and DELETE (clock and person row) and TRUNCATE
  refusals are asserted for a fully-granted role.

Its optional observation O1 (an INHERIT-FALSE owner membership escapes the table-privilege
predicate) is closed by the second arm of §8b and asserted in suite 59. O2 is recorded as a
residual below.

## Residual, named rather than implied

- **A superuser.** Excluded by `NOT r.rolsuper` in the capability predicate, and the
  runtime guards refuse it unless it `SET ROLE directus_migrator` deliberately — the same
  posture `incidents_no_delete` already takes. The cluster owner is trusted by definition.
- **The owner can disable the trigger.** Every trigger in this schema carries that
  residual; it is why the owner is `NOLOGIN`, why no `LOGIN` may be a member of it, and why
  the manifest records the actor. Reproduced in `tests/db/63.5` for the clock-state guard.
- **The predefined-role set is one role today.** It is named as a set in bootstrap so a
  server that adds another write role is a one-line edit, not a silent gap.
- **Both layers enumerate a hard-coded nine** (AFC-298 O2). A table added to
  `retention_class_sources` — a new erasure target — is covered by neither the guards nor
  the predicate until the engine's two arrays are edited. This is deliberate (the set is the
  retention-managed surface, not the config-driven erasure targets), but it is named so a
  future erasure target is not assumed covered.

## The rule this adds

Part 5 said: bound the capability, not the route. Part 6 is what that costs when it is
actually paid:

> A capability bound is a deploy-time claim and a runtime guard is a different claim, and
> a control that answers only one of them will be read as answering both. Bound the
> capability where the grants are made, guard the act where the rows are destroyed, and
> make each fail on its own.
