# 72-hour breach runbook — Church Portal

**Issue:** [AFC-163](/AFC/issues/AFC-163) · **Parent:** [AFC-161](/AFC/issues/AFC-161) · **Revision 1** · **Date:** 2026-10-06
**Companion:** [breach register](/AFC/issues/AFC-163#document-breach-register) — *this runbook writes to that register.*

> **This runbook is written to be executed by someone who has never read it before, at 03:00, without a technical background.** If a step needs you to already understand the system, the step is wrong. Sections are numbered in the order you do them.

---

## THE TWO CLOCKS — read this before anything else

| | NDPA **s.40(2)** | NDPA **s.40(3)** |
| --- | --- | --- |
| **Who** | The **Commission** (NDPC) | The **data subject** — the person whose data it is |
| **When** | Within **72 hours** | **Immediately**, where risk is high |
| **Runs from** | The moment **the church became aware** | The same moment |
| **Real length** | 72 hours | **Hours. Not days. Not "72 hours".** |

**Both clocks start at the same instant: `awareness_at` — the moment a person at the church understood that personal data had been compromised.**

**The most common failure in a breach response is treating 72 hours as the deadline for everyone.** It is not. s.40(3) is *immediate*. If you wait 48 hours to notify data subjects, you have already breached s.40(3) even though you are inside s.40(2).

**Our own safeguarding policy says only "without undue delay". That is the weaker half and it is wrong. This runbook supersedes it on breach notification.**

---

## STEP 0 — Print this box. Do not skip it.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  NDPC / NIGERIAN DATA PROTECTION COMMISSION                               │
│  Notification route: any electronic submission system provided by the      │
│  Commission (GAID Art. 9(4)); in the absence of one, by email to an       │
│  address the Commission provides for that purpose.                        │
│                                                                          │
│  ⚠ NEITHER THE PORTAL NOR THE EMAIL ADDRESS IS ON RECORD.                │
│  Obtain both from the appointed DPCO. Do not send to a guess.             │
│  ⚠ ndpc.gov.ng returned HTTP 403 to our network on 2026-10-06.           │
│    Do not assume the site is reachable. Escalate per §2.                   │
│                                                                          │
│  DPO contact point: s.32(3)(c) — the DPO IS the Commission's contact.    │
│  DPO name / email / phone: _______________________  (seat unfilled)      │
│  Fallback — CEO: _______________________                                    │
│  External DPCO firm: _______________________                               │
│  Counsel (safeguarding): _______________________                           │
│  Hosting / processor contacts: see processor register §1                  │
└──────────────────────────────────────────────────────────────────────────┘
```

**The DPCO seat is unfilled until 2026-10-31 at the earliest** (plan §1.3). Until then the top two lines are blank and **the fallback is the CEO.**

---

## STEP 1 — Is this a personal data breach? (5 minutes)

**Answer: do we have reasonable grounds to suspect that personal data has been compromised?**

Personal data = anything that identifies a person. Names, phone numbers, email addresses, photos, attendance, medical and welfare notes, **government ID images, safeguarding records**.

It includes **children's data**, and it includes **special-category data** — health, safeguarding, welfare, criminal-offence records, religious belief. **A congregation membership record is sensitive data by definition**, not by choice.

| Answer | Do this |
| --- | --- |
| **No** | Log it as a **near-miss** with date, time and what you saw. **No register row. No clock starts.** Reassess if new facts emerge. |
| **Yes, or unsure** | **Continue to Step 2. If you are unsure, continue. A false start costs an hour; a 72-hour clock started late costs the Commission the argument.** |

---

## STEP 2 — Start the clock. THIS IS THE STEP THAT DECIDES EVERYTHING ELSE. (10 minutes)

**The clock starts when a person at the church understood that personal data had been compromised.**

It does **not** start when engineering detected something. **It does not start when an alert fired.**

> A log alert at 02:14 is **not** awareness. "A volunteer reported that a safeguarding file was visible to the wrong branch" **is** awareness.

### 2.1 Open the register row

Create a row now, before anything else. Use `docs/ndpa/breach-register.md` §1 for the fields.

- `ref` — next in sequence: `INC-2026-001`, `INC-2026-002`, …
- `summary` — one line, what happened, no speculation
- `detected_at` — when **engineering** found it (if different)
- `status` = `open`

### 2.2 The awareness decision — who, when, and written down

| Who decides | When |
| --- | --- |
| **DPCO / DPO** decides and signs | Always. **Mandatory for `critical` severity or any high-risk finding.** |
| **CEO** decides | If the DPCO is unreachable |
| **On-call responder** decides, escalates after | If both are unreachable. **Record the delay and the reason.** |

**Escalation path, in full — because the DPCO seat is currently unfilled:**

> **CEO names a human.** There is no appointed DPCO yet. The CEO names one individual as the interim awareness decider for this incident and their name goes in the decision log. If the CEO is unreachable, the on-call responder decides and escalates afterwards.
>
> **A decision is never blocked on someone's availability. Record who decided, when, and any delay and its reason. An unrecorded delay turns a compliance failure into a misconduct question.**

### 2.3 The three questions

The decider answers in order and **records the answer with its own timestamp**:

| # | Question | If no | If yes |
| --- | --- | --- | --- |
| 1 | Do we have reasonable grounds to suspect a personal data breach has occurred? | Log a near-miss. Stop. | → 2 |
| 2 | **Has the church, through a person in any role, understood that personal data has been compromised?** | Keep watching. Reassess. | → 3 |
| 3 | **Would we tell the board?** | — | **Yes → `awareness_at` is the time you decided you would.** |

**Question 3 is the honest one.** If you answer it in a way that buys time, you have made a decision you will have to defend to the Commission, and the decision log is where it will be read.

### 2.4 Write it down — four fields, now

| Field | Value |
| --- | --- |
| `awareness_at` | The timestamp of the awareness decision in §2.3 |
| `awareness_at_source` | `manual:awareness-determination` |
| `awareness_decided_by` | **The person's name. Not a role, not a team.** |
| `awareness_decision_ref` | The decision-log entry id (§7) |

**Then compute the deadline, in writing, in the row:**

```
awareness_at      : 2026-10-08 09:30 WAT
+ 72 hours         : 2026-10-11 09:30 WAT   <-- s.40(2) deadline to the Commission
60-hour alert      : 2026-10-10 21:30 WAT   <-- escalate if nothing is drafted
24h checkpoint     : 2026-10-09 09:30 WAT
48h checkpoint     : 2026-10-10 09:30 WAT
```

**If `high_risk` is true (§4), the data-subject deadline is `awareness_at` + hours, not + 72 hours.**

**A manual `awareness_at` is not a weaker value.** It is a value with a named decision and a recorded reason behind it — which is what a regulator wants to see.

---

## STEP 3 — Escalate and hold the line (first hour)

Notify **in this order**. Do not wait for the next step to finish.

| # | Who | How | What you say |
| --- | --- | --- | --- |
| 1 | **On-call responder** | Phone | Incident ref, what happened, `awareness_at`, deadline |
| 2 | **CEO** | Phone | Same. **The CEO is the escalation path of record until a DPCO exists.** |
| 3 | **CTO / MediaTech** | Phone | Same, plus: is it contained? |
| 4 | **Safeguarding Lead** | Phone | **Only if children's data or a safeguarding record is involved.** Art. 12(7) confidentiality applies — the lead is a data subject in a specific incident and must not be a decision-maker in it. |
| 5 | **External counsel** | Per engagement | If the engagement is live. This is the policy-review firm. |
| 6 | **Affected processors** | Per their DPA | **Without delay** — a processor's duty to notify the controller runs in parallel with ours and is usually shorter. **Do not wait for our determination.** |

**Also now, before anything else is finished:**

- **Freeze evidence.** Do not delete logs, rotate credentials, or wipe anything. **Preservation beats remediation** — losing evidence is not recoverable.
- **Contain, but record what you changed and when.** Containment is right; unrecorded changes destroy the audit trail.
- **Open the decision log** (§7) if you have not already.

---

## STEP 4 — The remaining-hours gauge

**This is not a document. It is the thing that stops the clock being forgotten.**

**Rule: the on-call responder reads the gauge at every checkpoint, and writes the reading into the decision log — including "nothing has changed".**

| Checkpoint | When | What must exist |
| --- | --- | --- |
| **+0h** | At `awareness_at` | Register row open. Decision log started. Deadline computed. |
| **+2h** | | Escalated. Evidence frozen. Containment under way. |
| **+12h** | | Scope understood. Affected collections identified. **§4 high-risk assessment started.** |
| **+24h** | **CHECKPOINT 1** | High-risk determination **made and recorded** (all five questions answered). Draft Commission notification exists. **Data-subject notification sent if high risk.** Draft data-subject notification exists if not. |
| **+48h** | **CHECKPOINT 2** | Commission notification **approved by the decider**. Data-subject notification **sent** if high risk. Approver named. |
| **+60h** | **⚠ ALERT** | **Not drafted or not approved → escalate to CEO immediately.** This leaves 12 hours. **This alert is the reason the 72-hour deadline is met rather than missed.** |
| **+72h** | **DEADLINE** | **Notification submitted to the Commission. `reported_at` and `commission_notified_at` recorded.** |

**Write the gauge into the decision log every single time, including when the entry is "no change".** A gap in the record reads as a gap in the response.

**Until `awareness_at` is deployed in the system, the gauge is a human reading a clock. That is a weaker control and it is the one we have.**

---

## STEP 5 — s.40(3): notify the data subjects

### 5.1 Is risk high?

**Any `yes` → high risk → notify immediately.** Ask the DPCO, the CEO, or whoever made the awareness decision.

| # | Question | If yes |
| --- | --- | --- |
| H1 | **Are children affected?** | **Yes → high risk. Not discretionary.** |
| H2 | **Is special-category data affected** (health, safeguarding, welfare, government ID, criminal-offence)? | **Yes → high risk. Not discretionary.** |
| H3 | Is the data likely to be used to cause harm — identity fraud, financial fraud, targeting, reputational damage? | Yes → high risk |
| H4 | Is the data hard to change or delete once misused — credentials, biometrics? | Yes → high risk |
| H5 | Are many people affected, or vulnerable people who cannot reasonably protect themselves? | Yes → high risk |

**H1 and H2 are the ones people get wrong**, because everyone thinks in terms of volume. **A single 8-year-old's safeguarding record is high risk. A thousand adult email addresses may not be.**

**Record all five answers in the decision log — including when the answer is "no".** A reasoned `false` is a control. A bare `true` with no reasoning is not defensible, and "because it felt serious" is not an answer to the Commission.

**Severity is not the test.** `severity` is operational triage. `high_risk` is a legal determination. They usually agree and they are not the same field.

### 5.2 If high risk — send now, do not wait for the 72-hour deadline

Use the template in §6.2. **Send to affected data subjects, not to guardians-by-default.** For a child, the guardian receives it — **and the child receives age-appropriate information where safeguarding allows**, which is a judgement for the Safeguarding Lead, not for the responder.

**Record `data_subjects_notified_at`.**

### 5.3 If not high risk — record the reasoning and say so later

Set `high_risk = false`, record all five answers. **The reasoning is what defends the decision if the Commission disagrees with it.**

---

## STEP 6 — Notify the Commission — s.40(2), within 72 hours

### 6.1 Commission notification template

**Route:** any electronic submission system provided by the Commission (GAID Art. 9(4)); in the absence of one, email to an address the Commission provides for that purpose. **Neither is on record — get both from the DPCO. Do not send to a guess.**

> **Subject:** Notification of personal data breach under NDPA s.40(2) — [INC-YYYY-NNN] — AFC Church Portal
>
> **1. Controller.** Apostolic Faith Church, Anthony Village, Lagos, Nigeria. [Registration status: to be confirmed with the DPCO.]
> **2. DPO / contact point.** [Name, email, phone] — GAID Art. 11(2); s.32(3)(c).
> **3. Breach reference.** [INC-YYYY-NNN]
> **4. Nature of the breach.** [Confidentiality / integrity / availability loss. Plain description. No speculation about cause.]
> **5. Categories and approximate number of data subjects affected.** [Count, or the estimate and its basis. State which collections.]
> **6. Categories of personal data affected.** [Include whether children's data and special-category data are involved. Say so plainly if they are.]
> **7. Likely consequences.** [From H3. What harm is plausible, not what is dramatic.]
> **8. Measures taken or proposed.** [Containment, with times.]
> **9. Date the controller became aware.** [YYYY-MM-DD HH:MM, timezone] **and how that determination was reached**, including where it was recorded.
> **10. Contact for follow-up.** [Name, role, email, phone.]
>
> **Submitted:** [timestamp]. **Submitted by:** [name, role].
>
> *The 72-hour period under s.40(2) runs from the date in item 9. Any supplementary information will follow as the investigation proceeds.*

**Item 9 is the item the Commission will scrutinise.** State the awareness time **and the determination process**. If `awareness_at` was recorded manually because the system control is not deployed, **say so** — the provenance is `manual:awareness-determination` and it is evidence in its own right. Concealing it would be far worse than reporting it.

**A phased notification is permitted. An initial notification within 72 hours followed by detail as the investigation proceeds is normal and is better than a late complete one.** Say in the first submission that information will follow.

### 6.2 Data-subject notification template — s.40(3)

**Plain language. Short. This goes to a member of the congregation, often a child.**

> **Subject:** A problem involving your personal information
>
> Dear [name],
>
> We are writing to tell you about a problem we found involving your personal information held by the Church Portal.
>
> **What happened.** [One or two sentences. Plain. No technical terms.]
>
> **What information was involved.** [Be specific. Do not hide behind "some of your data".]
>
> **What we are doing.** [What we have done, and what we are doing.]
>
> **What you can do.** [Concrete: change a password, watch statements, be alert for someone using your details. Only give advice that applies.]
>
> **What we are not doing / who else has it.** [If relevant. If a processor was involved and we can say so, say so.]
>
> **Who to contact.** [Name, email, phone.]
>
> [Name]
> [Role] — Apostolic Faith Church

**Rules for this one:**

- **Do not use the word "breach" as a threat.** No "you have been breached", no "your data has been compromised".
- **Do not speculate about who did it.**
- **Do not delay to make it complete.** Send what you know, then follow up.
- **For a child:** send to the guardian, **and** give the child age-appropriate information where safeguarding allows. **The Safeguarding Lead decides that, not the responder.**
- **Never ask a data subject to do something that would identify them to a stranger.**

---

## STEP 7 — The decision log

**One entry per decision. Not one summary at the end. The log is the audit trail and it is written as decisions are made.**

**Every register row links to it (`decision_log_ref`). Every entry names a person and a time.**

Template — copy one per decision:

```
DECISION LOG ENTRY
  Incident ref      : INC-2026-001
  Entry             : 3
  Time (tz)         : 2026-10-08 11:42 WAT
  Decided by        : [FULL NAME], [role]
  Question put      : Has the church understood that personal data was
                      compromised? (awareness determination, §2.3 Q2)
  Answer            : Yes
  Reasoning         : [One sentence. What you understood, and when you
                      understood it.]
  Effect            : awareness_at set to 2026-10-08 09:30 WAT
                      s.40(2) deadline: 2026-10-11 09:30 WAT
  Escalation delay  : [None / X minutes — DPCO unreachable, reason]
```

**Log these decisions as they happen:**

1. Awareness determination (§2.3) — **always**
2. Every escalation, with time and who was reached
3. High-risk determination — all five answers, always, **including "no"** (§5.1)
4. Notification approval — who approved it and when
5. Every gauge reading, **including "no change"** (§4)
6. Any correction — **state the original value, the corrected value, who corrected it, and why. Never erase an original.**
7. Any delay — and the reason

**The log is append-only. Corrections are new entries. This matches the register: rows transition to closed and are never deleted, and `awareness_at` is never edited.**

---

## STEP 8 — Contact list

| Role | Name | Contact | Notes |
| --- | --- | --- | --- |
| **DPCO / DPO** | *unfilled* | — | **s.32(3)(c): the DPO is the Commission's contact point.** Seat targeted effective **2026-10-31** (plan §1.3). **Until filled, the CEO decides.** |
| **CEO** (escalation of record) | | | **The named fallback until a DPCO exists.** |
| **CTO / MediaTech** | [@MediaTech](/AFC/agents/mediatech) | | Containment, systems, technical facts. |
| **Safeguarding Lead** | | | **Involved only where children's data or safeguarding records are affected.** A data subject in a specific incident — must not decide in it (Art. 12(7)). |
| **Board / responsible user** | | | Told at awareness time, per §2.3 Q3. |
| **On-call responder** | *no rotation exists* | | **There is no staffed rotation. "On-call" means: whoever is reached first.** See §9. |
| **NDPC / Commission** | *no address on record* | — | GAID Art. 9(4). **Must be obtained from the DPCO. `ndpc.gov.ng` returned HTTP 403 on 2026-10-06.** |
| **External DPCO firm** | *not engaged* | — | Combined engagement target signature 2026-10-20 ([AFC-160](/AFC/issues/AFC-160)). |
| **Counsel** | *not engaged* | — | Same engagement. |
| **Processors** | — | See [processor register](/AFC/issues/AFC-163#document-processor-register) §1 | **Notify without delay — a processor's own duty runs in parallel with ours and is usually shorter.** |
| **Hosting / object storage** | P1, P2 | Register §1 | Backup vendor undecided — **see the gap below.** |

---

## STEP 9 — THE ON-CALL ROSTER DOES NOT EXIST. Stated plainly.

**There is no staffed on-call rotation, and none has been invented here.**

The company roster is **MediaTech, UXDesigner, Operations, Summarizer, Reflection Coach**. There is no SOC, no security engineer, no Coder, no QA. [AFC-165](/AFC/issues/AFC-165) records why: the board declined a security reviewer and the Coder seat is pending.

**So the escalation path is:**

> **CEO names a human.**

That is the whole path, and it is deliberately not dressed up as a rotation. Naming a human is a **two-minute decision by one person**, which is exactly why it is survivable. Inventing a five-person rotation over agents who do not have this duty would be worse than useless: it would produce a roster that reads as covered and is not.

**What the CEO must name, and by when:**

| # | What | By when | Without it |
| --- | --- | --- | --- |
| 1 | **Interim awareness decider** (the §2.2 fallback) | **Before go-live, and immediately if a breach occurs** | The clock starts whenever the CEO reads about it |
| 2 | **Interim data-subject notifier** | With #1 | s.40(3) has no owner |
| 3 | **Deputy** for when #1 is unreachable | With #1 | Single point of failure |
| 4 | **Commission submission route** — portal URL and email address | With #1 | **A breach cannot be reported** |
| 5 | **Contact details of any processor to notify in parallel** | With #1 | Processors are notified late |

**Until #4 exists, our s.40(2) obligation cannot be discharged at all**, because there is no route to discharge it through. That is the single most urgent line in this runbook.

---

## WHAT THIS RUNBOOK DOES NOT DO

| # | Gap | Why | Unblock |
| --- | --- | --- | --- |
| R1 | **The clock is human-read until `awareness_at` is deployed.** | No engineering seat. [AFC-166](/AFC/issues/AFC-166) blocked behind [AFC-165](/AFC/issues/AFC-165). | **CEO** — approve the Coder seat (approval `3d111b56`). |
| R2 | **No named humans.** | DPCO unfilled; no payroll; no Schedule 3 evidence on file. | **CEO** — complete the combined engagement ([AFC-160](/AFC/issues/AFC-160)); then fill STEP 0 and §8. |
| R3 | **No Commission contact route.** | Never obtained; `ndpc.gov.ng` returns 403 to our network. | **DPCO** — obtain portal URL and designated email. **Most urgent line in this document.** |
| R4 | **The drill has never been run.** | Scheduled **2026-11-06**, led by the appointed DPCO. **The DPCO is not appointed, so the drill facilitator is not named.** | **CEO** — appoint the DPCO by 2026-10-31; name the facilitator; run the drill. |
| R5 | **The templates have never been sent to anyone.** | No breach, no send. Templates are unvalidated in the field. | Exercise them at the 2026-11-06 drill. |
| R6 | **Processor notification contacts are not in this runbook.** | Five vendors undecided. | [Processor register](/AFC/issues/AFC-163#document-processor-register) §1; owners named per row. |

---

## THE ONE-PAGE CHECKLIST

```
□ Step 1  Is this a personal data breach?          Unsure → treat as yes
□ Step 2  Open register row. Compute the deadline.
          ★ THE CLOCK STARTS HERE: awareness_at, not detected_at.
          Who decided, when, and why → written down.
          Not blocked on availability: CEO names a human.
□ Step 3  Escalate in order. Freeze evidence.
□ Step 4  Gauge: +24h / +48h checkpoints. ⚠ +60h ALERT → escalate to CEO.
□ Step 5  High-risk: five questions. Any YES → notify data subjects NOW.
□ Step 6  Commission notified within 72h, via the official route.
          Data subjects notified IMMEDIATELY if high risk — not at 72h.
□ Step 7  Decision log written as we go, not at the end.
□ Step 8  Contacts — top of this document, currently partly blank.
□ Step 9  Five things the CEO must name. #4 is most urgent.
```

**The deadline is computed from `awareness_at`. If you cannot state when the church became aware, you cannot state when the deadline is. Everything else in this runbook is downstream of that one sentence.**
