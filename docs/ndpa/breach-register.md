# Breach register — Church Portal

**Issue:** [AFC-163](/AFC/issues/AFC-163) · **Parent:** [AFC-161](/AFC/issues/AFC-161) · **Revision 1** · **Date:** 2026-10-06
**Companion:** [72-hour runbook](/AFC/issues/AFC-163#document-breach-runbook) — *the register is the record; the runbook is what you execute. Neither is usable without the other.*

**Register state at this revision: ZERO rows. No breach has occurred. No personal data exists.**
This document defines the register, its fields, and the manual control that holds the clock until the system holds it.

---

## 0. The two obligations, and why most policies get this wrong

**There are two clocks, and they are not the same length.**

| Obligation | Duty | Clock | Runs from |
| --- | --- | --- | --- |
| **NDPA s.40(2)** | Notify the **Commission** | **within 72 hours** | when the **controller became aware** |
| **NDPA s.40(3)** | Notify the **data subject** | **immediately**, where risk to rights and freedoms is high | same origin — but the deadline is *immediate*, not 72 hours |

Our own policy (§11 incident response) says only *"without undue delay"* to guardians. **That is the weaker half and it understates s.40(3).** The 72-hour figure is also the number everyone remembers, which is exactly how the "immediately" duty gets missed.

### 0.1 The one thing this whole document exists to get right

> **The 72-hour clock runs from when the controller became aware — not from when engineering detected it.**

These are different moments and the gap between them is unowned time that belongs to the Commission, not to us.

- Engineering noticing something is **`detected_at`**. A log alert at 02:14 is engineering's timestamp.
- **A member of staff reading that alert and understanding that personal data has been compromised is `awareness_at`.** That second moment is the legal one.
- The gap is real and it is usually **hours to days** — a low-priority alert sits in a queue over a weekend.

**Nobody can shorten that gap by working faster. The only control is deciding, quickly and in writing, when the crossing happened.** §3 is that step.

### 0.2 The system control is written but not deployed

`incidents.awareness_at` is specified in [ADR-159-2](/AFC/issues/AFC-159#document-adr-retention-breach-controls) D7 and **implemented in the workspace** (`services/directus/schema/migrations/20261006_0002_incidents_awareness_at.sql`): server-set default, `NOT NULL`, immutable under `BEFORE UPDATE` / `BEFORE DELETE` / `BEFORE TRUNCATE` triggers, plus a `BEFORE INSERT` guard closing the defect found in [AFC-170](/AFC/issues/AFC-170), and `awareness_at_source` recording provenance as evidence in its own right.

**None of it is deployed, because there is no engineering seat.** [AFC-166](/AFC/issues/AFC-166) is blocked behind [AFC-165](/AFC/issues/AFC-165); the CI suite has never run on a runner ([AFC-172](/AFC/issues/AFC-172)).

**Therefore, as of this revision, the register and this document ARE the control.** §3 is a manual procedure, and it is a weaker control than a database trigger. That is stated here so nobody later reads this file and believes an automated guarantee exists.

---

## 1. Register schema — the fields, and why each one is there

The system table `incidents` carries the first six. The rest are the manual overlay this issue owns.

| # | Field | Type | Source | Why it exists |
| --- | --- | --- | --- | --- |
| 1 | **`ref`** | text, unique | Manual | Human reference. `INC-2026-001`. A breach with no identifier is a breach nobody follows up. |
| 2 | `summary` | text | Manual | One line. What happened, no speculation. |
| 3 | **`severity`** | enum `minor` / `major` / `critical` | Manual | Operational triage **and** the s.40(3) input. Not a legal test — see §4. |
| 4 | `status` | enum `open` → `investigating` → `contained` → `reported` → `closed` | Manual | Where we are in the runbook. |
| 5 | **`detected_at`** | timestamptz, **nullable** | System / manual | When engineering found it. **May legitimately be AFTER `awareness_at`** — staff can tell the board before engineering notices. **Never order these two.** ADR-0001 deliberately omits a `CHECK (detected_at <= awareness_at)`. |
| 6 | **`awareness_at`** | timestamptz, **immutable** | **System when deployed. Manual under §3 until then.** | **The clock origin.** The single most important field in this register. |
| 7 | `awareness_at_source` | text | System | `insert_default` \| `backfill:earliest_of_detected_reported_created` \| **`manual:awareness-determination`** (the value §3 writes). **Evidence in its own right** — the NDPC asks whether a value is real or inferred. **A manual value is not a weaker value. It is a value with a named decision behind it, and that is what the NDPC wants.** |
| 8 | **`reported_at`** | timestamptz, nullable | Manual | When the DPC notified the Commission **and/or** data subjects. Ordered after `awareness_at` by definition. |
| 9 | **`awareness_decided_by`** | text | Manual | **The person who decided the controller was aware, and at what time.** Without this, `awareness_at` is an assertion with no author. **Required field under §3.** |
| 10 | **`awareness_decision_ref`** | text | Manual | Link to the §3 decision-log entry. **This is the audit trail.** |
| 11 | `detected_by`, `acknowledged_at`, `contained_at`, `closed_at` | text / timestamptz | System / manual | Lifecycle evidence. |
| 12 | **`affected_data_subjects`** | integer | Manual | **Count, not a range.** Art. 13(5)(m) and the CAR both need a number. An estimate is recorded as an estimate with its basis. |
| 13 | **Affected categories** | text | Manual | Which collections and data subjects. Children present? Special-category present? **Two booleans are mandatory, not optional:** `children_affected` and `special_category_affected`. |
| 14 | **`high_risk`** | boolean | Manual, per §4 | **The s.40(3) trigger.** Must carry the §4 assessment, not just the flag. |
| 15 | `high_risk_assessment_ref` | text | Manual | Link to the §4 reasoning. **A bare `true` with no reasoning is not a defensible determination.** |
| 16 | **`commission_notified_at`** | timestamptz, nullable | Manual | Separate from field 8, because **s.40(2) and s.40(3) are separate notifications with separate clocks** and may happen hours apart. |
| 17 | **`data_subjects_notified_at`** | timestamptz, nullable | Manual | As above. **Required if `high_risk` is true.** |
| 18 | `notification_channel` / `notification_ref` | text | Manual | How the notification was made, and where the artefact lives. Templates: runbook §6. |
| 19 | **`decision_log_ref`** | text | Manual | Link to runbook §7. Every awareness, severity, high-risk and notification decision is logged there. |
| 20 | `gdpr_sadpr_refs` | text | Derived | Which Art. 13(5) items this row feeds. §6. |

**Two rules on this schema that are not negotiable:**

1. **Rows are never deleted.** The table comment says it — *"Rows are evidence: they transition to closed, they are never deleted."* The system enforces this with no DELETE grant and three triggers. **The manual register follows the same rule: a correction is a new decision-log entry, never an edit to a recorded fact.**
2. **`awareness_at` is never edited.** A wrong value is corrected by opening a **new incident row** referencing the error (ADR-0001). In the manual register, a wrong value is corrected by a decision-log entry that states the original value, the corrected value, who corrected it, and why — **and the original stays visible.**

---

## 2. The register

**No rows. This is the live register.**

| ref | summary | severity | status | detected_at | awareness_at | source | reported_at | subjects | children | special | high_risk | Commission | data subjects | decision log |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| — | *no incidents recorded* | — | — | — | — | — | — | — | — | — | — | — | — | — |

**A register with zero rows is the correct state of a programme that has not launched.** It is not an empty deliverable. It is the evidence that the control exists before it is needed.

**Where the register lives:**

| Until the system is deployed | After |
| --- | --- |
| This document, §2, plus the decision log (runbook §7) | The `incidents` table. **Rows written here before deployment are backfilled into it**, with `awareness_at_source = 'backfill:earliest_of_detected_reported_created'` — which is honest: it records that the value was inferred. |

---

## 3. The awareness determination — the manual control, and the only thing standing in for the database trigger

**This is the step that makes the register a control rather than a spreadsheet.** Execute it inside the runbook's first hour.

### 3.1 Who decides

| Role | Decides | Notes |
| --- | --- | --- |
| **On-call responder** | **Recommends**, and may set a **provisional** `awareness_at` | Anyone who can reach a human in under an hour |
| **DPCO / DPO** | **Decides and signs `awareness_at`** | The accountable decision. **Required for `severity = critical` or any `high_risk = true`.** |
| **CEO** | **Decides if the DPCO is unreachable** | §3.4 escalation. **A decision is never blocked on a person's availability.** |

### 3.2 The three-question test

The DPCO answers, in order, and records the answer with a timestamp:

1. **Do we have reasonable grounds to suspect a personal data breach has occurred?**
   No → log it as a near-miss, no register row, no clock. **Reassess if facts change.**
   Yes → continue. *Goes to question 2.*
2. **Has the church, through a person in any role, understood that personal data has been compromised?**
   "A log fired" is not understanding. "A volunteer reported that a safeguarding file was visible to the wrong branch" is understanding.
   **The answer to this question — with its timestamp — is `awareness_at`.**
3. **Would we tell the board?** If yes, we are aware, and `awareness_at` is the time we decided we would tell them. **Do not answer this question in a way that buys time.**

### 3.3 Recording it

Every answer enters the decision log (runbook §7) with: question asked, answer, **the timestamp of the decision**, who decided, and the reasoning in one sentence. Then:

- `awareness_at` ← the decision timestamp
- `awareness_at_source` ← **`manual:awareness-determination`**
- `awareness_decided_by` ← the person, not the role
- `awareness_decision_ref` ← the decision-log entry id

### 3.4 If the DPCO is not appointed

**The DPCO seat is currently unfilled** (plan §1.3; no named candidate, no Schedule 3 evidence on file). If a breach happens before **2026-10-31**:

> **Escalation path: CEO names a human.** The CEO names one individual as the interim awareness decider and records that person's name in the decision log **for this incident**. If the CEO is unreachable, the **on-call responder decides and escalates afterwards** — recording the delay and the reason. **An unrecorded delay is the one failure mode that turns a compliance failure into a misconduct question.**

**A decision is never blocked on a person's availability. Record who decided, when, and — if there was a delay — why.**

---

## 4. The high-risk determination — what triggers s.40(3)

**s.40(3) requires immediate notification to the data subject where the risk to their rights and freedoms is high.** "Immediately" means **not** "within 72 hours" and **not** "without undue delay". Treat it as: **as soon as the determination is made, and in practice within hours.**

**Severity is not the test.** `severity` is an operational triage field. `high_risk` is a legal determination. They usually correlate and they are not the same thing — a `major` incident can be high-risk and a `critical` one can not.

### 4.1 The assessment — record the answer, not just the conclusion

Answer all five. **Any `yes` → high risk.**

| # | Question | If yes |
| --- | --- | --- |
| H1 | **Are children affected?** | Yes → high risk. **Not discretionary.** |
| H2 | **Is special-category data affected** (health, safeguarding, welfare, government ID, criminal-offence)? | Yes → high risk. **Not discretionary.** |
| H3 | Is the data **likely to be used to cause harm** — identity fraud, financial fraud, targeting, or reputational damage? | Yes → high risk |
| H4 | Is the data **difficult to change or delete** once misused — credentials, biometrics, immutable identifiers? | Yes → high risk |
| H5 | Is a **large number** of people affected, or are any **vulnerable** people affected who cannot reasonably protect themselves? | Yes → high risk |

**H1 and H2 are the ones we will get wrong**, because most incidents are thought about in terms of volume rather than sensitivity. **A single 8-year-old's safeguarding record is high risk. A thousand adult email addresses may not be.**

### 4.2 Recording it

Set `high_risk` and `high_risk_assessment_ref` → the decision-log entry carrying the five answers. **A bare `true` with no reasoning behind it is not a defensible determination**, and if the NDPC asks why we notified 400 people, "because it felt serious" is not an answer.

### 4.3 If the answer is "not high risk"

**Record it anyway.** A reasoned `false` is a control. An unrecorded judgement is not — and if the NDPC disagrees with our call, the reasoning is what defends us.

---

## 5. Retention, legal basis — **not decided here**

**This register decides no retention duration and no legal basis.** Those are counsel questions and they are recorded as open:

| Open | Question ref | Note |
| --- | --- | --- |
| How long are breach records retained? | Counsel — [AFC-160](/AFC/issues/AFC-160) | **Not decided here.** Do not infer from the platform defaults. |
| Lawful basis for processing breach records | Counsel | — |
| Notification record retention vs. incident record retention | Counsel | They may differ. |

**An incident record is evidence of compliance, which usually argues for keeping it longer than operational data.** That is an observation, not a decision. **It stays open until counsel answers.**

---

## 6. What the register must produce for the GAID Art. 13 semi-annual report

Art. 13(5) requires **thirteen items** and applies to **every** controller and processor. **The DPO compiles it.** The register's job is to make four items a lookup rather than an investigation:

| Art. 13 item | From this register |
| --- | --- |
| **(k) Assessment of data security** | Every row: what was exposed, and whether the control that should have stopped it did. **A repeat finding is the most important output here** — the second occurrence of the same failure is a systemic finding, not an incident. |
| **(m) Breach notification to the Commission and to data subjects** | Fields 16–18: count notified, when, by what channel. **This is the only register that produces item (m) at all.** |
| **(h) Complaints and remediation** | Every row that generated a complaint, and what was done. |
| **(i) Notices issued by the Commission** | Every `commission_notified_at` value, and any Commission reply. |

**If the DPO cannot compile item (m) from this register in ten minutes, the register is wrong.** That is the test.

---

## 7. Review and ownership

| Item | Owner |
| --- | --- |
| Register owner | **CEO** (Operations) |
| Awareness determination | **DPCO / DPO** — **seat unfilled**, CEO names a human per §3.4 |
| Notification to the Commission | **DPCO / DPO** — **Art. 11(2) requires the DPO to be the contact point for the Commission** (s. 32(3)(c)) |
| High-risk determination | **DPCO / DPO**, per §4 |
| Register maintenance | **CEO** |
| This document | **[@Summarizer](/AFC/agents/summarizer)** for AFC-163; handover to the DPO on appointment |

**Review triggers:** every incident (add the learning); every SADPR cycle (2027-04-30, 2027-10-31, then semi-annually); on DPCO appointment (hand the whole register over); on `awareness_at` deployment ([AFC-166](/AFC/issues/AFC-166)) — replace the manual procedure with the system control and keep §3 as the documented fallback.
