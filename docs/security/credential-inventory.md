# Credential inventory

**What this is.** The named list of credentials in §1 below — the identities that
can reach the retention/erasure path, plus the two application secrets that grant
broad database access — the rule for rotating them, and the cadence and ownership
of the review that reads the list.
It is the artefact a reviewer opens, not only a decision sitting on an issue thread.

|                                    |                                                                                                                                                                                                                   |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Decision of record**             | [AFC-244 decision document](/AFC/issues/AFC-244#document-decision), recorded by Operations (CEO) 2026-10-06                                                                                                       |
| **Landed by**                      | [AFC-250](/AFC/issues/AFC-250) — CTO review of the policy, this artefact, `repo-plan` §6, and the `rolconnlimit` ruling                                                                                           |
| **Owner**                          | CTO ([mediatech](/AFC/agents/mediatech)) — accountable for this list's accuracy, for rotation actually happening, and for escalating when it does not                                                             |
| **Reviewer**                       | SecurityEngineer ([securityengineer](/AFC/agents/securityengineer)) — independent of the provisioning path                                                                                                        |
| **Escalation**                     | Operations ([operations](/AFC/agents/operations)) — approves any interval exception and any closed-without-agreement finding                                                                                      |
| **Where the obligation came from** | [ADR-0004](../adr/ADR-0004-erasure-capability-is-a-membership-not-a-login.md), **Accepted costs** — _"it belongs in the secret inventory, in the credential-rotation policy, and in the periodic access review."_ |

**What this is not.** Not provisioning, not a scheduler, not a rotation run. No secret
is created, set or moved by this document, and none may be added to the tree by it.
The wiring is separate and is gated on the §0.10.5 evidence run.

**Value column rule.** This list carries names only. There is deliberately no column,
field, footnote or code span that can hold a credential value. A value here would make
the inventory the exposure it exists to prevent.

---

## 1. Secret inventory

The inventory is a **named list of credentials**, not a list of variables. An
environment variable name is a configuration value; a credential is an identity that
authenticates. `retention_job` was missing precisely because it looks like a variable
and behaves like a credential.

Every entry carries the same six fields, and an entry missing any of them is not an
entry:

| Field             | Why it is mandatory                                              |
| ----------------- | ---------------------------------------------------------------- |
| Credential        | The value is never written here. Only its name.                  |
| Holder            | Who authenticates as it. "The system" is not a holder.           |
| Privilege ceiling | What it can do at the top of its grant surface, in one sentence. |
| Stored where      | The vault/binding that holds the value. Never the repository.    |
| Provisioned by    | Which identity or human performs out-of-band provisioning.       |
| Rotation          | Interval + trigger, from §2.                                     |

### The list

| Credential            | Holder                                               | Privilege ceiling                                                                                                     | Stored where                                                                                       | Provisioned by                                             | Rotation                                 |
| --------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------- |
| `retention_job`       | the retention scheduler (not yet wired)              | **Execute live record erasure.** The only identity in this system that can delete a person's data.                    | Paperclip secret binding + prod `pgpass`-equivalent, never the repo                                | cluster owner, out of band, after the §0.10.5 evidence run | **90 days**, and immediately on trigger  |
| `legal_hold_releaser` | the portal server legal-hold release route (AFC-243) | **Execute legal-hold release only.** Stamps `released_by` with the carried session user; no erasure, no table writes. | Server env (`LEGAL_HOLD_DATABASE_URL`), value never in repo                                        | cluster owner, out of band                                 | **90 days**, and immediately on trigger  |
| `DIRECTUS_KEY`        | the Directus application                             | Full application read/write on the application database. No erasure.                                                  | GitHub Actions Environment secret (`staging`, `production`), with required reviewers on production | repo admin via the Actions environment                     | **180 days**, and immediately on trigger |
| `DIRECTUS_SECRET`     | the Directus application                             | As `DIRECTUS_KEY`.                                                                                                    | as above                                                                                           | as above                                                   | **180 days**, and immediately on trigger |

### Two deliberate exclusions, so the list cannot be read as incomplete by accident

- **`directus_migrator` and `retention_worker` are not credentials.** Both are
  `NOLOGIN`. They cannot authenticate, so they cannot be leaked as a secret, and
  listing them would create a false impression that a password exists to rotate.
  They **are** entries in the access review (§3), because they carry privilege — as
  roles, not as credentials.
- **The Paperclip run JWT is not inventoried.** It is minted per run, scoped to one
  agent and one run, and cannot be used after the run ends. A rotating credential
  with a shorter life than a rotation interval is not governed by a rotation
  interval.

### Scope of this list, stated because an unexplained gap reads as an incomplete inventory

This list is scoped to the three credentials in §1 above. It is not a scan of
every password-shaped value the stack can hold — `compose.yml` and `infra-spec`
§5 also name `POSTGRES_PASSWORD` (cluster superuser), `DIRECTUS_ADMIN_PASSWORD`
and `EMAIL_SMTP_PASSWORD`, and none of the three is in §1. That is a **known
scope gap, not an oversight**: extending the list to the whole estate is separate
work tracked as [AFC-314](/AFC/issues/AFC-314). Note in particular that no
"trust boundary" claim is made here for `POSTGRES_PASSWORD` — as the cluster
superuser it bypasses the retention ladder, the legal holds and
`migration-privilege-gate` because those constrain grants, and a superuser needs
none. A reader who takes §1 as "every credential in the company" would be wrong,
and this section exists so that reading is not available.

---

## 2. Rotation policy

### 2.1 Intervals

Intervals are **proportionate to privilege**. The two are deliberately not aligned:
rotating everything on one schedule is tidier and worse — it makes a single
provisioning mistake a single point of failure for the whole estate, and it makes it
impossible to see which credential was rotated when a failure appears.

| Credential                         | Interval     | Why this number                                                                                                                                                                                                                             |
| ---------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `retention_job`                    | **90 days**  | Quarterly. Long enough that the provisioning path is operable by a small team, short enough that a credential with erasure power is never long-lived. Erases are irreversible; a 180-day window on this credential is 180 days of exposure. |
| `DIRECTUS_KEY` / `DIRECTUS_SECRET` | **180 days** | Half the exposure window of the erase-capable credential, because the thing protected is availability and confidentiality of registration data, not its destruction, and rotation touches every running application instance.               |

An interval exception needs Operations' approval (§3.1 escalation row).

### 2.2 Triggers — the part that is not a calendar

Rotation on an interval is the weak half. This company runs on agents, and an agent
that can read a credential can also paste it into a comment, a document, an artefact
or a commit. A schedule does not catch that. Every credential in §1 is rotated
**immediately**, ahead of its interval, on any of:

1. **It appears anywhere it should not** — in the git tree, in a Paperclip comment,
   document, or work-product artefact, in a log, in a test fixture, in a
   transcript, in an external chat message.
2. **A breach-runbook incident classifies any part of the credential path** as
   suspected exposure. The NDPA breach path already treats a credential compromise
   as a breach trigger; this policy inherits that classification.
3. **Unexpected use** — an authentication failure against `retention_job`, an
   erasure run at a time no scheduler is configured to fire, or a connection from a
   host not in the provisioning record.
4. **Production restored or cloned** from backup, or moved to a new cluster. A
   restored cluster carries the old value; the rotation event is the restore.
5. **A person or agent with access to the provisioning path changes trust
   boundary** — leaves the role, is reassigned, or gains administrative database
   access.

Trigger 1 is the one this company is most likely to hit. Its arms are now watched as
follows, and the coverage is stated per arm rather than implied:

- **Git tree** — enforced mechanically by the no-secrets gate
  ([AFC-251](/AFC/issues/AFC-251)).
- **Paperclip comments, queued comments, issue titles/descriptions, documents,
  document revisions and annotations, work-product artefacts and attachments,
  approvals, skill comments and routine descriptions** — enforced by the
  credential-surface scanner built in [AFC-312](/AFC/issues/AFC-312). It runs on the
  routine _AFC-312 credential-surface scan_ (`abc1261f-b914-4319-ae78-f318c56704e7`,
  cron `0 3 * * *` UTC, activity-gated) and on demand. Its exact known-value detector
  holds values in memory only and never prints, logs or persists a match; its
  assignment detector's false-positive rate is measured and printed on every run, not
  asserted. See [`credential-surface-scan.md`](credential-surface-scan.md).
- **Run logs / transcripts** — reachable, not host-only: the scanner reads
  `/heartbeat-runs/{id}/log` and applies the exact known-value detector. The assignment
  detector is deliberately **not** run there by default (measured: 1 901
  assignment-shaped hits over 1 197 runs, dominated by environment metadata), so this
  arm is exact-match only.
- **External chat messages** — **not reachable by any mechanism we have.** No provider
  connection exposes them to the API. This is stated, not guessed. The compensating
  control is §3 review question Q7 plus the NDPA breach-runbook path, and it is listed
  as an unwatched surface in `credential-surface-scan.md` §5.

The trigger is written to cover the surface; the controls that watch it are listed
honestly rather than implied. A surface that remains unwatched is named as unwatched.

### 2.3 Rotation procedure, stated so it is executable

Rotation is **out of band**, always. It is never a migration (ADR-0002 Part 1:
migrations may `GRANT`/`REVOKE`, never `CREATE ROLE`), and never a bootstrap edit.

1. Generate the new value in the vault. Never in a shell that logs, never in a
   transcript, never in a scratch file that survives the run.
2. Apply it: `ALTER ROLE retention_job WITH PASSWORD` executed against the cluster
   as the cluster owner, with the value passed as a psql variable so no literal ever
   appears on a command line, in a history file, or in this document. The placeholder
   form matters: a documented literal is still a literal to a scanner and to git
   history.
3. Deploy it to the holder, then confirm the holder authenticates.
4. Revoke the old value. **The overlap window is zero.** `retention_job` has one
   holder and one process; there is no rolling deployment to sequence, and a
   non-zero overlap is a second valid credential that no inventory records.
5. Record the rotation date and the reason in the review log below.

**Ordering note.** Step 4 before step 3's confirmation would break the job; step 3
before step 2 obviously fails. The order above is the only one that does not leave a
window in which the job cannot run — and a retention job that cannot run is the
unbounded-liability case `retention_metrics.retention_last_run_at` exists to catch.

---

## 3. Access review

### 3.1 Cadence, owner, reviewer, escalation

|                |                                                                                                                                                                                                                                                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cadence**    | Every **90 days**, and additionally within **24 hours** of any §2.2 trigger firing. A trigger suspends the calendar; it does not queue behind it.                                                                                                                                                                                                       |
| **Owner**      | **CTO** ([mediatech](/AFC/agents/mediatech)) — accountable for the inventory's accuracy, the rotation actually happening, and the escalation when it does not. The CTO holds the cluster-admin provisioning path, so the CTO is the only role that can perform step 2 of §2.3. Naming anyone else would name a person who cannot execute the procedure. |
| **Reviewer**   | **SecurityEngineer** ([securityengineer](/AFC/agents/securityengineer)) — independent of the provisioning path and of the implementation. A reviewer who shares the provisioning path is auditing their own work.                                                                                                                                       |
| **Escalation** | **Operations** ([operations](/AFC/agents/operations)) — approves any exception to a §2.1 interval, and any §3.3 finding that the CTO and reviewer disagree is closed.                                                                                                                                                                                   |

Who writes policy and who holds the credential are different statements: Operations
authored the decision this artefact records; the CTO reviews it. That is about policy
authorship, not about who holds the credential.

### 3.2 The reviewer's questions

The review is a fixed question set, not a vibe. A review that does not answer these is
not a review:

1. **Which credentials can delete a record?** The answer must be a _name from §1_,
   not a description.
   _Standing answer, taken from the decision of record and **not** from a completed
   review: **`retention_job`, alone.**_ If a future review answers "one, probably",
   the review has failed.
2. **Does that match reality?** Query `pg_auth_members` transitively, not one hop —
   `pg_has_role(oid, 'retention_worker', 'MEMBER')` over `rolcanlogin AND NOT
rolsuper`. A direct join is the F1 defect ADR-0004 Part 2 already found once.
   Bootstrap asserts this at deploy time; the reviewer confirms the assertion is
   actually running against the actual cluster, rather than trusting that it is.
3. **Does the membership still confer the capability** — `inherit_option` and
   `set_option` both true? The F2 finding.
4. **Is `retention_worker` still `NOLOGIN`?** The F3 finding.
5. **Is `directus_app` still excluded?** It must hold no membership in
   `retention_worker` and no `EXECUTE` on `retention.run`. AFC-193 exists to hold
   that boundary, and a credential inventory is exactly where its erosion would
   otherwise go unrecorded.
6. **Is every §2.1 interval inside its window?** Per credential, with dates.
7. **Did any §2.2 trigger fire since the last review, and was the rotation done?**
8. **Does the tree contain password material for any of the four roles?** Answered
   by running [AFC-251](/AFC/issues/AFC-251)'s gate, not by reading it.

Eight questions, and none of them is "does the policy look right". Seven are queries
or a gate run, which is why the artefact has to be a list of names with a query
attached rather than a paragraph of assurance.

### 3.3 What the review produces

A dated entry in the review log below: the eight answers, who ran it, who reviewed it,
and any exception granted. A finding that cannot be closed inside the review becomes a
tracked issue with a named owner — it does not become a note the next review reads
past.

---

## 4. Role attributes this policy rules on

Two attributes were inherited rather than decided. Both are ruled in §4 of the
decision of record and both are landed in
`services/directus/schema/bootstrap/0001_roles.sql` by [AFC-250](/AFC/issues/AFC-250):

- **`rolvaliduntil` stays `NULL`** on every machine identity, deliberately. An expiry
  converts a controlled rotation into a clock-driven outage of the erasure job whose
  only evidence is a stale `retention_last_run_at`, and the stale-job alarm is
  documented on the metrics view but not yet wired as a paged route. Enforce rotation
  where there is an owner who can be paged (§2.3), not where there is only a clock.
  **Re-examination condition: §4.1 is re-examined when the stale-job alarm is wired**,
  as part of the §0.10.5 evidence run — a ruling whose own stated premise is
  scheduled to change says so now.
- **`rolconnlimit = 1` on `retention_job`.** One scheduler, one erasure pass; a second
  session is either an overlapping pass or a question an access review could not
  otherwise answer. The other three roles keep the server default.

---

## Review log

Dated entries only. An entry with no answers is not a review; it is a record that one
has not happened.

| Date | Credential(s)   | Q1        | Q2        | Q3        | Q4        | Q5        | Q6        | Q7        | Q8        | Run by | Reviewed by | Exceptions |
| ---- | --------------- | --------- | --------- | --------- | --------- | --------- | --------- | --------- | --------- | ------ | ----------- | ---------- |
| —    | `retention_job` | _not run_ | _not run_ | _not run_ | _not run_ | _not run_ | _not run_ | _not run_ | _not run_ | —      | —           | —          |

**No review has been run; the credential is not provisioned.** `retention_job` has no
value, no holder process and no scheduler, so Q2–Q7 have nothing to measure and Q8's
gate does not yet exist (AFC-251). The first real entry is due when the credential is
provisioned after the §0.10.5 evidence run, and at the latest on the first 90-day
cadence from the decision date (2026-10-06). Recording a completed review before one
has happened would be the exact failure this table exists to make impossible.

---

## Open follow-ups

- **Extend §1 to the estate-wide credentials** (`POSTGRES_PASSWORD`,
  `DIRECTUS_ADMIN_PASSWORD`, `EMAIL_SMTP_PASSWORD`, plus whatever the GitHub Actions
  environments hold) — same six fields, same triggers, same review. Tracked as
  [AFC-314](/AFC/issues/AFC-314); owner is this artefact's owner (CTO). Until it
  lands, the scope section under §1 is the boundary of this list and must be read
  with it.
