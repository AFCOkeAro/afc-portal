# Board calendar — NDPA governance obligations

**Issue:** [AFC-163](/AFC/issues/AFC-163) · **Parent:** [AFC-161](/AFC/issues/AFC-161) · **Revision 1** · **Date:** 2026-10-06
**Source of truth for dates:** [governance plan](/AFC/issues/AFC-161#document-plan) §6 (revision 6)

---

## 1. What a "calendar entry" is on this board, and why that matters

**This platform has no calendar object.** The dated surface a board actually reads is **issues with a date, an owner and a reminder**, so that is what these entries are: seven real, dated issues under [AFC-163](/AFC/issues/AFC-163), each with the date in the title, a named owner, and its reminder schedule in the body.

**No placeholder entries. No recurring-intent entries.** Every one of these names a specific date, a specific owner, and a specific thing that must be true on that date.

**One honest limitation, stated up front:** the platform's *automatic* reminder (an issue monitor) can only be armed by the issue's own assignee or by a board user — `Only the assignee agent or a board user can manage issue monitors`. I could not arm it on entries owned by the CEO. **So the reminders are written into each entry as explicit T-minus checkpoints with dates, and arming the platform monitor is a one-line action for the assignee or the board.** This is not a substitute for an automated wake, and it is listed in §4 rather than glossed over.

---

## 2. The entries

| # | Entry | Date | Owner | Reminder checkpoints |
| --- | --- | --- | --- | --- |
| 1 | [AFC-186](/AFC/issues/AFC-186) — **Breach drill (tabletop, 72-hour path)** | **2026-11-06** | CEO (facilitator: DPCO if appointed) | T-14 2026-10-23 · T-7 2026-10-30 · T-1 2026-11-05 |
| 2 | [AFC-188](/AFC/issues/AFC-188) — **NDPC registration decision point** | **2026-11-14** | CEO + DPCO | T-14 2026-10-31 · T-1 2026-11-13 |
| 3 | [AFC-187](/AFC/issues/AFC-187) — **All processor DPAs executed** | **2026-11-30** | CEO (CTO on P1, P8) | T-30 2026-10-31 · T-7 2026-11-23 |
| 4 | [AFC-191](/AFC/issues/AFC-191) — **Compliance audit commissioned early** | **2026-12-01** | CEO + DPCO | T-30 2026-11-01 · T-7 2026-11-24 |
| 5 | [AFC-192](/AFC/issues/AFC-192) — **Continuing Compliance Audit Return, if EHL** (was "First CAR, if UHL/EHL") | **2027-03-31** | DPCO | T-60 2027-01-30 · T-14 2027-03-17 |
| 6 | [AFC-189](/AFC/issues/AFC-189) — **Semi-annual internal data protection report #1** | **2027-04-30** | DPO (compiler) | T-60 2027-03-01 · T-14 2027-04-16 |
| 7 | [AFC-190](/AFC/issues/AFC-190) — **Semi-annual internal data protection report #2** | **2027-10-31** | DPO (compiler) | T-60 2027-09-01 · T-14 2027-10-17 |

**Seven entries, not six.** The issue brief said "six" and then listed seven dates. It also omitted the CAR entirely. Both are corrected below.

---

## 3. Three places these dates depart from the brief, and why

**The brief's table is not the latest word on two of its own rows.** The plan it points at is at **revision 6** and supersedes it. Recording the divergence is the point of this section — a silently-dropped date is the failure mode the plan's own §10 revision log was written to correct.

### 3.1 Audit: **2028-01-03 / 2028-03-31 → 2026-12-01**

The brief's audit dates were anchored to a provisional commencement of processing on **2026-12-31**. The plan replaced them.

GAID **Art. 7(b)** anchors the 15-month compliance audit to **"commencement of business"**, a phrase **undefined anywhere in the instruments**. Three readings:

| Reading | Anchor | Consequence |
| --- | --- | --- |
| 1. Organisational founding | Long past | **Already overdue** |
| 2. Portal go-live | 2026-12-31 provisional | Defensible, **not cited** |
| 3. GAID issuance (2025-03-20) | ~June 2026 | **Also arguably overdue** |

**Two of three readings put us already overdue.** Plan D4 hedges: audit early. Under reading 1 we are already compliant and lose nothing; under reading 2 we audited early; under reading 3 we are inside the window. **Being wrong the other way costs the greater of ₦10,000,000 or 2% of annual gross revenue** (s. 48(4)).

**2026-12-01 also survives the anchor moving.** If go-live slips, the audit happens before the thing it audits — a waste, not a breach. **Wrong by being early costs a retainer we are paying for anyway. Wrong by being late costs ₦10m.**

**The 2028 dates are not carried as separate entries.** They were computed from an unverified anchor. **Leaving them standing in a table a reader checks against the done criteria is exactly the failure mode that produced the plan's own revision 4** — a withdrawn figure still sitting in the criteria table. If the DPCO's determination of the real anchor puts the deadline after 2027-03-01, new entries get created then, from the verified anchor.

### 3.2 Registration: **2026-11-14 → a conditional decision point, not a filing date**

AFC is a **Faith-Based Organisation**. Guidance Notice ¶6(b) exempts FBOs from DCPMI registration, so the filing **may not be required at all**. Plan §3.3 withdrew the 2026-11-14 filing date.

**The entry stays, labelled superseded, because the acceptance criterion requires the date on the calendar** and because a withdrawn date that quietly disappears is how this goes wrong. On 2026-11-14 the DPCO's exemption determination is checked, and **if the exemption does not hold, filing targets 2026-11-28** — still before any live data.

### 3.3 CAR: **absent from the brief → added at 2027-03-31**

**This is the largest recurring cost line in the whole programme and the brief's table does not mention it.**

GAID **Art. 7(c)**: Ultra-High-Level and Extra-High-Level controllers file a Compliance Audit Return through a licensed DPCO. **Schedule 10 puts the annual filing fee at ₦100,000–₦1,000,000 by band; +50% late penalty (Art. 10(9)).**

Whether it applies to us turns on whether the FBO exemption also removes UHL/EHL status for Art. 10 purposes — **registration status may not touch CAR status at all, and a six-figure recurring swing turns on it.** It is question 2 of 8 on [AFC-160](/AFC/issues/AFC-160).

**The number that decides it is ours, not the DPCO's.** Classes are volume-banded on actual in-window subjects (Guidance Notice S4 ¶3(1), reproduced in GAID Schedule 7; unchanged in the January 2026 S5 re-publication):

| In-window subjects (6 months) | Class | Registration fee (S4 ¶3(1)) | Annual CAR fee (Schedule 10) |
| --- | --- | --- | --- |
| **>5,000** | Ultra-High | ₦250,000 | **₦500,000/yr** (band C, below 25,000) |
| **>1,000 but <5,000** | Extra-High | ₦100,000 | **₦100,000** (band C, below 2,500) · **₦200,000** (band B, 2,500–4,999) |
| **>200 but <1,000** | Ordinary-High | ₦10,000 | **No CAR at all** (Art. 10(14) reaches UHL and EHL only) |

**Two drafting notes, recorded so they are not rediscovered:** Schedule 10's EHL band B prints as "5,000-2,500" — inverted bounds in the signed instrument; read as 2,500–4,999 and do not rely on it without written clarification (see [AFC-162](/AFC/issues/AFC-162) §Q6). And the bands leave exact boundaries — exactly 1,000, exactly 5,000 — between rows.

**A phased rollout keeping any six-month window under 1,000 is worth real money, and that is a launch-sequencing decision, not a compliance decision.** Children's data alone cannot move the band — each class needs four of seven factors.

**A conflict the DPCO must resolve:** Art. 7(c) says 31 March; Art. 10(8) gives a first-year filer 15 months from establishment; Art. 10(12) cross-refers to 10(8), not 7(c). **The issued GAID contradicts itself.** 2027-03-31 follows the stricter reading.

**Update 2026-10-06 — the conflict is resolved *for us*, and we did not have to pay for it.** The board established that AFC began **before 12 June 2023**, so **Art. 10(7) governs directly and the Art. 10(8) 15-month limb never reached us.** The date above does not move. What the answer did *not* settle is whether a return was ever filed for the 31 March 2026 cycle — see gap **C8**, which is now the live item on this section.

**Update 2026-10-07 — C8 closed. The board answered both open questions.**

- **Filing history: AFC has filed a CAR before.** Source: board answer on 2026-10-06 (institutional memory). No receipt or Compliance Audit Returns Certificate exists in our records — the board's answer is the source, and the underlying document has not been produced. **Consequence: [AFC-192](/AFC/issues/AFC-192) is not a first filing. It is a continuing obligation.** The 2027-03-31 deadline stands.
- **People count: under 5,000.** Source: board answer on 2026-10-06. **This means AFC is NOT Ultra-High Level** (UHL requires >5,000 in-window subjects). The ₦500,000/yr UHL band and the ₦250,000 UHL registration fee do not apply.
- **EHL vs OHL: not yet determined — but the threshold itself is settled.** The exact EHL threshold **is** confirmed from primary sources: **>1,000 but <5,000 in six months** (Guidance Notice S4 ¶3(1)(d); AFC-162 §3.4, quoted against the instrument). What is unknown is **our in-window count inside the under-5,000 answer.** If it is 1,000 or fewer, AFC is Ordinary-High and **no CAR is required at all** — the filing line disappears from the programme entirely. If it is above 1,000, AFC is Extra-High and owes **₦100,000–₦200,000/yr** (Schedule 10 EHL bands C and B) — **not ₦250,000**, which is the EHL *registration* fee, not the CAR fee, and not the ₦250,000 EHL-band-A figure, which requires 10,000+ subjects and is unreachable under 5,000.
- **The NDPC question remains open, but it now has a route.** Whether the FBO exemption removes UHL/EHL status for CAR purposes (Art. 10(14)) is still undetermined. `ndpc.gov.ng` still returns HTTP 403 to our network, but the Commission's published general contact — **info@ndpc.gov.ng, +234 (0) 916 061 5551** (ndpc.gov.ng/contact, per public search index) — is now on record in the [breach runbook](/AFC/issues/AFC-163#document-breach-runbook) contact list. Sending still needs a human with mail access; the draft question is prepared in `docs/ndpa/ndpc-question.md`.

**Update 2026-10-09 — the board answered the three follow-up questions ([AFC-222](/AFC/issues/AFC-222), card `ebda495f`). This section is now determined:**

- **Band count: 1,000 or fewer in-window subjects.** Source: board answer 2026-10-09. AFC is **at most Ordinary-High** — below both the UHL (>5,000) and EHL (>1,000) lines (Guidance Notice S4 ¶3(1)(d)). **No CAR obligation exists on volume, and the annual CAR fee is ₦0.** The exact-1,000 boundary gap in the instrument is immaterial here: the answer is "or fewer", and even an exact 1,000 sits below the EHL line as drafted. Art. 10(14) reaches UHL and EHL only.
- **2026 cycle: unknown.** Source: board answer 2026-10-09 ("we do not know" whether the 31 March 2026 return was sent; prior "filed before" answer of 2026-10-06 remains undated institutional memory, no receipt or certificate in our records). Moot for the fee — at OHL there is no 2026 obligation to have missed — but recorded as the criterion-1 answer: **no record found beyond the board's undated recollection.**
- **NDPC send: hold until a DPCO is engaged.** Source: board answer 2026-10-09. The draft in `docs/ndpa/ndpc-question.md` is parked, not withdrawn; Q1 (FBO exemption scope) and Q2 (2026-cycle cure route) travel with the DPCO engagement ([AFC-160](/AFC/issues/AFC-160)). The counsel/DPCO spend decline of 2026-10-06 stands — this hold does not reopen it.
- **Consequence for [AFC-192](/AFC/issues/AFC-192): its "if EHL" condition is not met.** The entry should be cancelled or parked by its owner (CEO/Operations), not carried as a live 2027-03-31 obligation. If a future count ever exceeds 1,000 in-window subjects, the EHL line (₦100,000–₦200,000/yr, Schedule 10 bands C/B) revives and AFC-192 is re-created from the verified count.

---

## 4. Named owners — and the one that does not exist yet

| Entry | Owner | Status |
| --- | --- | --- |
| Drill, registration, DPAs, audit | **CEO** ([@Operations](/AFC/agents/operations)) | **Named and live.** |
| P1 hosting, P8 monitoring (DPAs entry) | **CTO** ([@MediaTech](/AFC/agents/mediatech)) | **Named and live.** |
| **Breach drill facilitator** | **DPCO** | **DOES NOT EXIST YET.** |
| **Both semi-annual reports** | **DPO** (must compile, GAID Art. 13(1)) | **DOES NOT EXIST YET.** |
| **CAR** | **DPCO** | **DOES NOT EXIST YET.** |
| **Awareness decider, in a real breach** | **DPCO**, fallback **CEO** | **DOES NOT EXIST YET.** |

**The DPCO/DPO seat is unfilled.** Plan §1.3 targets the combined engagement signature on **2026-10-20** and a DPO effective **2026-10-31** ([AFC-160](/AFC/issues/AFC-160)).

**Four of these seven entries have an owner who does not exist yet.** That is not a reason to invent names — it is the reason the escalation path is written as **"CEO names a human"** rather than dressed up as a rotation.

**Escalation path, applied uniformly:**

> **CEO names a human.** One named individual per duty. If the DPCO is not appointed, the CEO holds the awareness-determination duty directly, and every calendar entry above still has a live, named owner — the CEO.

---

## 5. Gaps — stated, not papered over

| # | Gap | Why | Unblock owner and action |
| --- | --- | --- | --- |
| C1 | **Platform monitors are not armed on any entry.** | The monitor API is assignee- or board-scoped: `Only the assignee agent or a board user can manage issue monitors`. | **Assignee or board** — arm each entry's monitor. One call per entry. **Reminders currently exist as dated checkpoints in each entry body, not as automatic wakes.** |
| C2 | **No named human owner on 4 of 7 entries.** | DPCO/DPO seat unfilled. | **CEO** — complete [AFC-160](/AFC/issues/AFC-160); target signature 2026-10-20, DPO effective 2026-10-31. |
| C3 | **The drill facilitator is not named** — acceptance criterion 4 asks for a named facilitator. | Same cause. **Interim facilitator is the CEO**, and the CEO runs it unless the DPCO is appointed before 2026-11-06. | **CEO** — confirm by 2026-10-23 (T-14 checkpoint). |
| C4 | **2028-01-03 and 2028-03-31 are not on the calendar.** | Superseded by the 2026-12-01 early-audit hedge. **Deliberate, per §3.1.** | **DPCO** — after determining the real anchor, create the entries if the 15-month deadline falls after 2027-03-01. |
| C5 | **CLOSED 2026-10-06 — AFC's date of establishment is now known.** The board answered "before 12 June 2023". | It was not recorded anywhere in this project. Now supplied by the board via [AFC-160](/AFC/issues/AFC-160). | **None — closed.** Consequence: **GAID Art. 10(7) governs, so CAR is due not later than 31 March each year.** The Art. 10(8) 15-month first-filing limb **no longer applies to us** — it only ever reached controllers established after 12 June 2023. **The 2027-03-31 date in §3.3 does not move; it was already the stricter reading, and the answer removes the alternative rather than changing the date.** See C8 for what the answer did *not* settle. |
| C6 | **The semi-annual report has no deadline in Art. 13.** Art. 7(e)'s "within six (6) months" is ambiguous. | — | **DPO** — confirm the 2027-04-30 cadence is defensible. |
| C7 | **The recurrence after report #2 is not scheduled.** | Deliberately not created as a placeholder. | **DPO** — once the cadence is established. |
| C8 | **CLOSED 2026-10-07 — the board answered both open questions.** | The board's answer of "before 12 June 2023" put the Art. 10(7) deadline at **31 March each year**. **31 March 2026 was six months ago.** We did not know whether a CAR was ever filed — no filing history was recorded anywhere in this project, because until 2026-10-06 we did not know which provision governed and so did not know what to look for. **This gap was created by C5 being answered, not by C5 being open.** | **None — closed.** The board answered on 2026-10-06: **AFC has filed a CAR before** (source: board answer, institutional memory; no receipt/certificate in our records). **People count is under 5,000** (source: board answer) — **NOT Ultra-High Level**; the ₦500,000 UHL CAR band is out of scope. **EHL threshold is confirmed as >1,000 but <5,000 (S4 ¶3(1)(d))** — EHL vs OHL turns on our in-window count, and the remaining fee span is **₦0 (OHL, no CAR) to ₦100,000–₦200,000/yr (EHL Schedule 10)**. The 2027-03-31 deadline stands as a **continuing obligation, not a first filing**. The NDPC question (FBO exemption scope for CAR purposes) remains open: question drafted in `docs/ndpa/ndpc-question.md`, Commission general contact now on record (info@ndpc.gov.ng), **send still needs a human.** **Update 2026-10-09:** board answered the three follow-ups (≤1,000 subjects → at most OHL, no CAR; 2026 cycle unknown; NDPC send held until DPCO engaged) — see §3.3. C8 stays closed; the new answers are recorded there. |

---

## 6. What the board should do with this calendar

1. **Read the audit date.** 2026-12-01 is not a typo and not an error in the brief. It is a deliberate hedge against an audit clock that may already be running. **It is the cheapest decision on this page.**
2. **Note that four entries depend on a person who does not exist yet.** That is the single thread running through them.
3. **Arm the monitors.** Until then the reminders are dated text, not automatic wakes.
