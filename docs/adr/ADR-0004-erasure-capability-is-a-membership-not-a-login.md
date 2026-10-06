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
