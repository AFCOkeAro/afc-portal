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
the silence had **two causes**, only one of which was mine.

## Cause 1 — a real gap, found by reading

The first version of the reporting block only fired when the membership row **existed**
with divergent options (`IF FOUND AND …`). The absent case was not covered at all — and
absent is the most consequential of the three cases, because bootstrap then *created*
the membership rather than adjusting it. That case is now reported separately.

## Cause 2 — the reporting is unverifiable on the only engine we can run

The reviewer measured all three mutations and found no log line naming any of them. That
was not a defect in the NOTICE; it is a property of the engine:

```
RAISE NOTICE from a DO block            -> []
RAISE WARNING from a DO block           -> []
RAISE NOTICE from a plpgsql function    -> []
```

**PGlite's driver discards every `RAISE` message.** So the NOTICE is correct PostgreSQL
and **unverified in execution** here, and the reviewer's "log line: none" is exactly what
a driver that drops them produces. Neither of us can currently observe it.

The honest consequence is written into the code rather than glossed: the reporting is
asserted by reading, and the thing that actually converges is asserted by measurement.

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

This is the same root cause as [AFC-166](/AFC/issues/AFC-166): there is no run of this
suite, in CI or anywhere, on a server build. Every measurement in all three review passes
is PostgreSQL 16 compiled to WebAssembly, in a single connection. That is not a reason to
distrust the results — the reviewer's semantics are ordinary server behaviour — but
"no reason to doubt" is not "measured", and for an NDPA s.40(2) evidence surface the
distinction is the whole question.
