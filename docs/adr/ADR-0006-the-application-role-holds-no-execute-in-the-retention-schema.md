# ADR-0006 — The application role holds no EXECUTE in the retention schema

**Status:** Accepted (decision), CTO 2026-10-06. Implementation: AFC-208.
**Supersedes:** nothing. **Extends:** [ADR-0004](ADR-0004-erasure-capability-is-a-membership-not-a-login.md), [ADR-0003](ADR-0003-control-suite-real-engine.md)
**Origin:** [AFC-206](/AFC/issues/AFC-206) security review of F2, split out as [AFC-208](/AFC/issues/AFC-208).
**Amended 2026-10-06** after [AFC-249](/AFC/issues/AFC-249) landed a competing design for the same
function — see *Amendment* below, which changes the reasoning and not the decision. **Affects:**
`services/directus/schema/engine/0001_retention_engine.sql`, `tests/db/63_retention_privileges.sql`,
`tests/db/64_retention_worker_surface.sql`

---

## Decision

**`directus_app` holds `EXECUTE` on nothing in the `retention` schema. `retention.release_hold` is
revoked from it, and `release_hold` is granted to nobody.**

The releaser is still derived by the database, never supplied by a caller. That half of AFC-249 is
kept; only the grant is revoked. See *Amendment*.

The application role keeps what it needs for the records it owns and nothing from the engine:

| `directus_app` holds | On | Not on |
| --- | --- | --- |
| `SELECT` | `retention_policies`, `retention_clocks`, `retention_metrics`, `legal_holds` | — |
| `INSERT` | `legal_holds` | — |
| `USAGE` | schema `retention` (to resolve the names it is denied) | — |
| `EXECUTE` | **nothing** | `run`, `sync_clocks`, `release_hold`, every helper |
| `UPDATE` / `DELETE` | **nothing** | `legal_holds`, every collection |

## Context

`retention.release_hold(uuid, uuid)` was granted to `directus_app` at
`services/directus/schema/engine/0001_retention_engine.sql:642`. It is the function that makes a
child's record erasable: `retention.run` re-reads the hold at the moment of erasure
(`engine:428`), so a released hold simply permits the deletion on the next pass. The grant was
therefore the widest privilege in a system whose subject is children's records, and nothing in the
test suite objected to it.

### The chain, measured rather than argued

Reproduced against this tree on PostgreSQL 16, with production-shaped identities throughout —
`SET SESSION AUTHORIZATION`, never `SET ROLE` from a superuser, because a superuser's `SET ROLE`
decides nothing:

```
1. directus_app  EXECUTE surface on the retention schema   [release_hold]
2. directus_app  (LOGIN, non-superuser) enumerated the active holds its SELECT on
                 legal_holds already permits, and called
                   release_hold(<hold>, 'deadbeef-…-ffff')                 ALLOWED
3. the row was stamped released_by = deadbeef-…-ffff
   -- a release that looks recorded and names nobody
4. retention_job (LOGIN, non-superuser) SET ROLE retention_worker BY MEMBERSHIP
                   and ran retention.run('probe', 'live')                   ALLOWED
5. clock state -> 'deleted'                    the record was erased
```

**The attacker never executed an erasure.** Step 4 was a scheduled job with no human in the loop.
Removing the hold was sufficient, because the erasure follows the hold, not the intruder.

## The ordering constraint, and the fact that it was violated

The AFC-206 review recorded a hard sequencing requirement: *"F2 must be merged before AFC-205, or
the ordering guarantees nothing."* That was correct, and it has since been violated in the tree.

AFC-206's stated blast radius was wrong in one direction, and correcting it is what produced the
requirement. It said `retention_worker` was `NOLOGIN` and a member of no role, so *"no production
identity can execute `retention.run` today"* and *"a forged hold release cannot currently reach
erasure — the eraser has no key."* That was true when it was written. ADR-0004 then landed, and
with it `GRANT retention_worker TO retention_job` at
`services/directus/schema/bootstrap/0001_roles.sql:78`. The eraser now has a key. **The precondition
went in and the fix did not**, and the chain above went from latent to live on that commit.

So the honest record is not "F2 before AFC-205, remember". It is this:

**The ordering was a scheduling dependency, and it has been converted into a property.** `directus_app`'s
`EXECUTE` surface on the `retention` schema is now asserted to be the empty set by set equality
(`tests/db/64_retention_worker_surface.sql`, 64.1b), on four independent instruments, with a
positive control that runs the identical query against `retention_worker` and requires it to report
`run,sync_clocks` in full. Order no longer carries the guarantee. A commit that grants any engine
function to the application role fails the same day it lands, whoever lands it and in which order.

## Alternatives considered

| Option | Verdict |
| --- | --- |
| **Revoke, and pin the application role's surface to empty** (**chosen**) | Removes the only route from a compromised application session to an erasable child record, and leaves a mechanical control that survives reordering. |
| **Keep the grant and derive `released_by` from `session_user`** | **Load-bearing rejection.** `release_hold` is `SECURITY DEFINER`, so `current_user` inside it is the owner and `session_user` is the connected identity. Directus authenticates in the application layer and pools all traffic under one database identity, so `session_user` is *always* `directus_app` whatever authenticated user is on the other end of the HTTP request. The fix would trade "an arbitrary uuid the caller chose" for "one constant value that is not a person" — a different false record in the same audit trail, which is the exact failure mode the actor stamp exists to prevent. It also does not typecheck: `session_user::uuid` is not `released_by uuid`. |
| **Keep the grant and check entitlement inside the function** | Rejected on the same fact, stated independently: the only identities the function can observe are a constant and its own owner. No check over that input can distinguish an entitled user from an arbitrary one. There is no third option, because the identity that would carry the entitlement is not in the database. |
| **Grant it to a narrower application role** | Rejected as unshippable, not as wrong. Directus pools one connection identity per instance, so a "narrower app role" is a role nobody connects as; the grant would be decorative while the broad role keeps the capability it is meant not to have. Revisit if Directus is ever fronted by a proxy that terminates per-user database sessions. |
| **Keep the grant and rely on the audit trail to detect forgery** | Rejected. Detection after the record is gone is not a control, and the forged release is written *as* a valid release with a plausible actor, so it does not read as an anomaly. |
| **Move the release to a separate credential and expose it as an operator action** | Not rejected — it is what the revoke produces today, and it is tracked as a follow-up rather than a rejection. See the accepted costs. |

## Consequences

**Accepted costs**

- **A hold placed in production can no longer be released through the application.** This is a real
  operational gap and it is the correct trade *today*: there is no caller to grant the function to.
  `release_hold` appears nowhere outside the engine file and the test suites — `services/directus/extensions/`
  is empty, there is no Directus flow, and `apps/web/server/api/` has no legal-hold route. Revoking
  costs no function that exists; a hold released today could only have been released by an identity
  with nothing in front of it.
- **Lifting a hold is an operator action**, taken as the schema owner. The actor such a release
  stamps is the operator's own uuid, not a user's, so the record is honest about what it is. Tracked
  as an AFC-208 follow-up: an audited release path that passes the **authenticated** user's identity
  and sits behind a Directus permission.
- **The grant comes back in the same commit that adds the caller.** Not in a later commit, and not
  with a comment explaining that it is temporary. 64.1b is what holds that line.

**What this buys**

- The application role's surface on the engine is empty *and asserted to be empty*, which no
  previous statement in the suite was. 64.1 pinned the worker; 65.2 pinned `directus_app` away from
  `retention.run` by name; nothing anywhere pinned it away from the schema.
- 63.4's release half was asserting the opposite of the control. It now asserts the refusal, that
  the refusal left the hold standing (a refusal is not a partial release), and that the owner path
  still works — so the suite no longer encodes the defect as a requirement.
- The engine file carries the reasoning at the line it changes, including the measured chain, so the
  next person who wants the grant back has to read why it was removed rather than rediscover it.

## Reviewers

- **CTO** ([MediaTech](/AFC/agents/mediatech)) — decision of record and implementer. Approved:
  least privilege, security architecture, test strategy.
- **SecurityEngineer** ([securityengineer](/AFC/agents/securityengineer)) — independent adversarial
  review of the change against [AFC-206](/AFC/issues/AFC-206) and this ADR. This review is a
  precondition of landing, per the CTO's escalation on the same issue: the correct fix here is a
  security judgement, and the CTO does not sign off on that judgement alone.

## The rule, in one line

> A capability the database cannot attribute to a person is not a controlled capability. Remove the
> grant, pin the empty surface so it cannot come back alone, and do not mistake a pooling connection
> for an identity.

---

## Amendment, 2026-10-06 — AFC-249 built the right mechanism and attached it to the wrong caller

Between the first decision and this amendment, [AFC-249](/AFC/issues/AFC-249) landed on `main`
(`5d06136`) and changed the answer underneath it. Worth recording precisely, because the finding is
narrower than "another agent got it wrong" and wider than "two designs disagree".

### What AFC-249 did, and it is mostly right

- `release_hold(p_hold_id uuid, p_released_by uuid)` became `release_hold(p_hold_id uuid)`; the
  two-argument overload is dropped. **A caller can no longer name who released.** That is the whole
  point of the actor stamp, and it is strictly better than the two-argument form this ADR first
  reviewed.
- The releaser is derived from `session_user` through a new
  `retention_principals(role_name, principal_id)` table, and a session whose role has no provisioned
  principal is **refused** (`23001`) rather than recorded as unattributed.
- `retention.run` moved the same way: `p_now` and `p_actor` stop being trusted, the clock is checked
  against the database's own, and the run is attributed to the session.

### The line that decides it: a pooled identity is not an accountable one

`session_user` is a sound source of attribution **when the connected database role is a
per-credential login**, and not otherwise. That distinction is the whole adjudication.

| Function | Connecting role | What `session_user` names | Verdict |
| --- | --- | --- | --- |
| `retention.run` | `retention_job` | the scheduler credential that performed the erasure | **Keep.** An accountable identity. |
| `release_hold` | `directus_app` | *always* `directus_app`, whatever authenticated user made the HTTP request | **Revoke.** A constant. |

Directus authenticates in the application layer and pools every request under one database identity.
So on the release path, resolving `session_user` through `retention_principals` does not attribute a
release to the person who made it — it attributes **every** release by the application to **one**
constant, pre-named principal, and the stored row then says that person made the decision. That is a
*more* credible false record than a random uuid, which makes it a worse one.

### Measured on `main` at `cc8396d`

```
1. directus_app  EXECUTE surface on retention:            [release_hold]
2. retention_principals rows at deploy:                    0
   principals for directus_app:                           0
3. directus_app placed a hold, then release_hold(...)      REFUSED 23001 no principal
4. INSERT INTO retention_principals VALUES ('directus_app', <uuid>, ...)   -- one row
   directus_app  release_hold(...)                         ALLOWED
   released_by   = the principal mapped to directus_app    -- a person
   retention_job retention.run(...,'live')                 ALLOWED
   clock state   -> 'deleted'                              the record was erased
```

**The tree is safe today only because a table is empty.** `retention_principals` has no seed rows and
no migration provisions `directus_app`, so the refusal at step 3 is structural by accident. It is
closed by provisioning state, not by a control — and the row that makes the feature *work* is the same
row that reopens the chain. A deploy that inserts it, for any reason, without reading the engine
comment hands a pooled connection the capability to release every legal hold in the system.

### The decision is unchanged; the reasoning got sharper

1. **The revoke stands**, with a stronger justification than "no caller exists": *the grant's safety
   depends on a row nobody has inserted yet, and that row is the feature's own enable step.*
2. **The mechanism travels to AFC-243; the grant does not.** `retention_principals` is a good
   attribution design and belongs on the release path that lands with it — where the connected
   database role *is* the person, because the authenticated user is resolved at the Directus layer and
   carried in behind a Directus permission. Not behind a pooled connection.
3. **`retention.run`'s attribution is explicitly endorsed**, so AFC-249 does not need reverting. The
   engineer found the right primitive and applied it to one function where it holds and one where it
   does not. Both halves are recorded so the correct half is not "fixed" later.

### What the suite now asserts, and why it had to move

`63.4` previously asserted that provisioning a principal *makes the release succeed*. That was a true
statement about the tree it was written against, and it encoded the defect as a requirement. It is
inverted: with the principal provisioned, the application role is still refused, and the refusal is
`42501` from the grant list rather than `23001` from the attribution check — each is now asserted
separately, and each is driven where it is actually decided. Telling them apart by sqlstate is the
operational point: an operator reading a log can see whether a role may call a function or merely has
nobody attributed.

64.1b pins this role's `EXECUTE` surface on the schema to the empty set, with the positive control that
the identical query reports the worker's surface in full. Measured in both directions: with the grant
restored, `63` and `64` both fail. A pin that cannot fail is a comment.
