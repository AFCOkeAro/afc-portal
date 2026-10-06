# Processor register — Church Portal

**Issue:** [AFC-163](/AFC/issues/AFC-163) · **Parent:** [AFC-161](/AFC/issues/AFC-161) · **Revision 1** · **Date:** 2026-10-06
**Sources:** [comms ADR](/AFC/issues/AFC-149#document-comms-adr) · [comms addenda change log](/AFC/issues/AFC-149#document-comms-addenda-changes) · [data-flow summary](/AFC/issues/AFC-164#document-data-flow-summary) · [NDPA checklist](/AFC/issues/AFC-149#document-ndpa-compliance-checklist) §4.7, §5 · [NDPA determination brief](/AFC/issues/AFC-162#document-ndpa-determination-brief)

**Status: no processor has been engaged. No DPA has been executed. Nothing has been transferred.**
This register exists to size and name the work before go-live, per plan §4 / D6. Registering a processor costs nothing; signing the wrong transfer clause costs the engagement.

---

## 0. How to read this register

### 0.1 Owner convention — read this before the table

The acceptance criterion is a **named accountable owner — a person, not a team**. The company roster has **five agents** and one of them is a procurement function, not a person who can be named as a human duty-holder.

| Code | Who | What "named owner" means for this register |
| --- | --- | --- |
| **CEO** | [@Operations](/AFC/agents/operations), company `ceo` role | The accountable owner **today**. This is the real name on the row. Operations holds procurement and the board relationship and is the register's own owner. |
| **CTO** | [@MediaTech](/AFC/agents/mediatech), company `cto` role | Accountable owner **today** for anything with an engineering surface. |
| **`HUMAN REQUIRED`** | *none named* | The owner a human must hold. **The row says so rather than naming a team.** |

**Every `HUMAN REQUIRED` row resolves by escalation path, not by invention:**

> **CEO names a human.** No rotation, no placeholder, no "the team". The CEO names one individual against the row and records the name here. Until that happens the row is **unowned**, and unowned is a visible state on purpose.

**The one seat this blocks hardest:** the **DPO / DPCO**. Plan §1.3 targets a DPO effective **2026-10-31**, which requires the combined counsel + DPCO engagement to be signed **2026-10-20** ([AFC-160](/AFC/issues/AFC-160)). **If that engagement slips, the DPO does not exist, and every `HUMAN REQUIRED` row below stays unowned.** The runbook ([breach-runbook](/AFC/issues/AFC-163#document-breach-runbook)) escalates on the same path for the same reason: the appointed DPCO leads the 2026-11-06 drill.

### 0.2 Named individuals do not exist yet — stated once, not repeated per row

AFC has **no payroll and no named candidate** for the DPCO, per plan §1.2 (Schedule 3 qualification is a 100-mark score with no published pass mark, and nobody at AFC has it on file). Consequently:

- **No row below has a named human owner.** Every row has a named **agent** owner and, where a human must hold it, the `HUMAN REQUIRED` marker.
- This is a **known gap with a named unblock action**, not an omission. It is listed in §6.

### 0.3 Cost note — processor count is now a recurring cost line

GAID Art. 10(9) / Schedule 7 ¶7(1): **₦5,000 per engaged processor per 12 months**, for Ultra-High-Level controllers. Per the [determination brief](/AFC/issues/AFC-162#document-ndpa-determination-brief) §4.3, if AFC is exempt from registration as a Faith-Based Organisation under Guidance Notice ¶6(b), this per-processor fee may fall away with the class question. **It is not decided. Registering every row here is how the exposure gets sized before anyone signs anything.**

**Register count: 11 processors. If the ₦5,000 fee applies to all of them, that is ₦55,000/year recurring**, on top of a Compliance Audit Return of up to **₦500,000/year**. Rows 3, 4, 5, 6 and 7 are marked *candidate* — they are processors the architecture *commits to* but that are not yet chosen, and cutting a candidate row is a real cost saving, not a cosmetic edit.

---

## 1. The register

**Legend.** DPA status: `TEMPLATE HELD` = vendor's standard terms obtained, unamended · `NEGOTIATING` = our amendments sent or in draft · `EXECUTED` = signed by both parties, date recorded · `NOT ENGAGED` = no vendor selected or contracted. Transfer mechanism: `BLOCKED — pending counsel` where the transfer is cross-border and the mechanism is a counsel question.

### P1 — Hetzner (self-hosted production VPS)

| Field | Value |
| --- | --- |
| **Processor** | Hetzner Online GmbH |
| **Role** | **Direct processor.** Hosts the entire production platform: Directus, PostgreSQL 16, Caddy, Nuxt 3, Symfony Notifier worker. |
| **Data subjects** | All. Members, children/youth (under-18 subset), guardians, volunteers, staff. |
| **Data categories** | **Everything, including special-category.** Health/medical notes, safeguarding and welfare concerns, **government ID document images** (guardian consent evidence), welfare/financial records, **criminal-offence data** (volunteer background checks — *no retention rule exists, see §5*), contact details, attendance, giving, communications content. |
| **Purpose** | Hosting and processing of the portal. Sole production store. |
| **Processing location** | **`UNDECIDED` — the region is a declared, unset parameter, not an inherited default.** The single source of truth is `DEPLOY_REGION` in `services/directus/.env.example`, `<country>:<provider location code>`; ADR "Pin the production hosting region" ([AFC-171](/AFC/issues/AFC-171)) requires every document to refer to that variable instead of naming a location. **There is no longer any "EU (Germany) working default" in this register** — that text was an artefact of the `infra-spec` CX33 sizing example being read back as a decision, and a reader had no way to tell the difference. Hetzner operates in Germany, Finland, the US and Singapore; the value is chosen by whoever buys the server and is unset because nothing is funded. |
| **Sub-processors relied on** | None identified by us. **Hetzner's own current sub-processor list is `UNVERIFIED`** — it was not obtained. Obtain it as part of the DPA. |
| **DPA status** | **`BLOCKED — transfer mechanism is a counsel question (plan D6).`** Not `TEMPLATE HELD`. The blocker is not paperwork, it is that we do not yet know which lawful transfer ground applies. |
| **Named owner** | **CTO** (region decision is a build decision) · **CEO** (DPA negotiation) |
| **Transfer mechanism** | **`BLOCKED — pending counsel`.** Question 21 on [AFC-160](/AFC/issues/AFC-160): is it permissible to host Nigerian children's and health data outside Nigeria, and on what ground? **The question is deliberately phrased without a region**, because `DEPLOY_REGION` is unset — asking counsel "is EU residency ok?" presupposes an answer to the question being asked, and that presupposition is what made this register stale once already. Compounding factor from the data-flow summary: safeguarding and medical collections are **not segregated** — same PostgreSQL instance, same volume, same Caddy as attendance and giving, separated by application-layer permissions only. "Host the children's data in Nigeria" is therefore **not a server move** in the current design; it is new architecture and a new processor set. |
| **Review date** | 2026-11-30 (DPA target) · then each SADPR cycle |

### P2 — Object storage / off-site backup

| Field | Value |
| --- | --- |
| **Processor** | **`UNDECIDED`** — spec names *Hetzner Storage Box / OBJ* **or** *Backblaze B2*. |
| **Role** | **Direct processor.** Off-site backup destination and media/object store. |
| **Data subjects** | All. A backup is a full copy of the database. |
| **Data categories** | **Full dataset, in scope identical to P1** — including safeguarding, health, government ID images and background-check data. |
| **Purpose** | Nightly `pg_dump -Fc` (**no WAL archiving**, [ADR-0005](/AFC/issues/AFC-169#document-adr-0005-erasure-lag-is-the-backup-window)); off-site copy of consent evidence files and uploads. |
| **Processing location** | **`UNDECIDED`**, and **this row must not acquire an independent default of its own.** It inherits from P1's `DEPLOY_REGION`. That inheritance is a requirement, not an accident: a backup is a full copy of the database, so an off-site destination in a different jurisdiction from the primary store re-creates exactly the cross-border transfer Q21 is asking about — one hop further out and on a schedule nobody reads. **Choose the backup destination in the same jurisdiction as P1, or treat the difference as a second transfer question for counsel.** |
| **Sub-processors relied on** | `UNVERIFIED` — vendor not chosen. |
| **DPA status** | **`NOT ENGAGED`.** |
| **Named owner** | **CEO** (vendor selection is procurement) |
| **Transfer mechanism** | **`BLOCKED — pending counsel`.** **This is the transfer most likely to be overlooked** and it is the second-highest-sensitivity flow after hosting. A backup to an off-shore object store is a cross-border transfer of safeguarding and health data equal in scope to the primary store, and it is currently unanswered in our design. |
| **Erasure lag — mechanism decided, numbers still open** | **Mechanism: [ADR-0005](/AFC/issues/AFC-169#document-adr-0005-erasure-lag-is-the-backup-window) rule 1–3.** No WAL archiving (a WAL archive sets a hard floor under this lag that no dump-side decision can lower). Ladder 30 daily / 12 weekly / **3 monthly**, so the media lag bound is **~90 days, not 12 months**. An append-only hash-chained `erasure_ledger` is held in object storage under object-lock, **outside every `pg_dump`**, and restore promotion is refused until it is replayed — so an erased record cannot re-enter service even if a stale set is restored. The ledger is itself personal data and is a **new processor row**, not an implementation detail. The lag *number* remains a counsel question below. |
| **Review date** | 2026-11-30 (choose vendor, then DPA) |

### P3 — Email delivery provider

| Field | Value |
| --- | --- |
| **Processor** | **`UNDECIDED`** — SMTP transport via Symfony Mailer. Candidates named in the comms ADR: Amazon SES, Postmark, Mailgun, Resend, Sendgrid. All non-Nigerian. |
| **Role** | **Direct processor.** Sends email to data subjects. |
| **Data subjects** | Members, guardians, volunteers, staff. **Children receive email in family contexts** — treat as in scope for minors. |
| **Data categories** | Name, email address, message content. Message content may include a minor's name in a camp or registration confirmation. |
| **Purpose** | Transactional and approved-bulk email delivery. |
| **Processing location** | **Non-Nigerian — all named candidates.** Unpinned. |
| **Sub-processors relied on** | `UNVERIFIED` — vendor not chosen. Expect ESP sub-processors (delivery, bounce handling) to need naming. |
| **DPA status** | **`TEMPLATE HELD` — no.** Correct status: **`NOT ENGAGED`.** No vendor selected. The board mandated **SMTP transport**, not a vendor. |
| **Named owner** | **CEO** |
| **Transfer mechanism** | **`BLOCKED — pending counsel`** (cross-border, no adequacy ground identified). |
| **Review date** | 2026-11-30 |

### P4 — SMS gateway

| Field | Value |
| --- | --- |
| **Processor** | **Termii** (Nigeria-first), via the `symfony/termii-notifier` bridge. Fallbacks: Twilio, Infobip, Africa's Talking. |
| **Role** | **Direct processor.** |
| **Data subjects** | Members, guardians, volunteers, staff. |
| **Data categories** | Name, phone number, message content. |
| **Purpose** | Outbound SMS — registration confirmations, camp communications, approved bulk sends. |
| **Processing location** | **Nigeria (NG)** for Termii. Fallbacks are **US / SI / KE**. |
| **Sub-processors relied on** | `UNVERIFIED` — not obtained. |
| **DPA status** | **`NOT ENGAGED`** — named, not contracted. |
| **Named owner** | **CEO** |
| **Transfer mechanism** | **Not required if Termii holds the traffic in Nigeria — this is the one comms row with no cross-border question.** Falls back to **`BLOCKED — pending counsel`** if we fall back to Twilio/Infobip/Africa's Talking. **Confirm Termii's own sub-processor location as part of the DPA; do not assume domestic means no transfer.** |
| **Review date** | 2026-11-30 |

### P5 — WhatsApp Business Solution Provider (BSP)

| Field | Value |
| --- | --- |
| **Processor** | **`UNDECIDED`** — 360dialog / Infobip / Twilio. |
| **Role** | **Direct processor.** Also the **sub-processor front** for Meta: the BSP processes on our behalf *and* on Meta's behalf. Two parties, two sets of terms, one data flow. |
| **Data subjects** | Members, guardians, volunteers. **High minor exposure** — WhatsApp is the primary family channel and guardians are the account holders. |
| **Data categories** | Phone number, template language, message content, delivery status, opt-out events. |
| **Purpose** | Outbound WhatsApp messaging via the Cloud API. The church owns the WABA and the number. |
| **Processing location** | **Meta: US.** BSP: **DE / SI / US** depending on choice. |
| **Sub-processors relied on** | **Meta** (platform), plus whatever the chosen BSP names. Both lists `UNVERIFIED`. |
| **DPA status** | **`NOT ENGAGED`.** |
| **Named owner** | **CEO** |
| **Transfer mechanism** | **`BLOCKED — pending counsel`.** Two unresolved transfers stacked: to Meta and to the BSP. **Meta-side template approval lead time is a schedule dependency, not a compliance one** — templates must be provider-approved before first send, and that queue is outside our control. |
| **Review date** | 2026-11-30 |

### P6 — Meta (WhatsApp Business Platform)

| Field | Value |
| --- | --- |
| **Processor** | **Meta Platforms Ireland Ltd.** |
| **Role** | **Sub-processor of the BSP**, and a direct counterparty for the WABA. Registered separately because a single DPA with the BSP does not bind Meta. |
| **Data subjects / data** | As P5. |
| **Purpose** | WhatsApp Business Cloud API platform. |
| **Processing location** | **US / IE.** |
| **Sub-processors** | `UNVERIFIED`. |
| **DPA status** | **`NOT ENGAGED`.** |
| **Named owner** | **CEO** |
| **Transfer mechanism** | **`BLOCKED — pending counsel`.** |
| **Review date** | 2026-11-30 |

### P7 — Avatar resolution service

| Field | Value |
| --- | --- |
| **Processor** | **Gravatar** (public API). |
| **Role** | **Direct processor, and an outbound disclosure.** Not a passive lookup — we transmit a derived identifier to a third party on every render. |
| **Data subjects** | Every user who logs in and has an avatar. |
| **Data categories** | **A one-way hash of the lowercased email address.** No email is transmitted. |
| **Purpose** | Avatar display. |
| **Processing location** | **US / CDN.** |
| **Sub-processors** | `UNVERIFIED`. |
| **DPA status** | **`NOT ENGAGED`.** |
| **Named owner** | **CTO** |
| **Transfer mechanism** | **`BLOCKED — pending counsel`**, and the legal question is sharper than for the others: **a hash of an email is personal data in our hands and remains linkable by Gravatar.** Disabling avatars is the cheap fix if counsel objects; the cost is a product change, not a legal one. |
| **Review date** | 2026-11-30 |

### P8 — Monitoring and log aggregation

| Field | Value |
| --- | --- |
| **Processor** | **`UNDECIDED`** — Grafana Cloud (free tier) or self-hosted Netdata. |
| **Role** | **Direct processor.** |
| **Data subjects** | **Unknown, and that is the finding.** Container and system logs capture whatever the application logs. If any log line contains an email, phone number or a person's name, monitoring becomes a processor of that data. |
| **Data categories** | **Currently assumed to be none. `UNVERIFIED` — we have not audited what the application logs.** Log/metric egress is a transfer in its own right and the safest control is that nothing identifying is logged at all. |
| **Purpose** | `node_exporter` metrics and container log aggregation. |
| **Processing location** | **US** if Grafana Cloud. **In-region** if self-hosted Netdata — which is strictly better and costs one container. |
| **Sub-processors** | `UNVERIFIED`. |
| **DPA status** | **`NOT ENGAGED`.** |
| **Named owner** | **CTO** |
| **Transfer mechanism** | **`BLOCKED — pending counsel`** if Grafana Cloud. **Not applicable** if self-hosted. |
| **Review date** | 2026-11-30 |

### P9 — Source control

| Field | Value |
| --- | --- |
| **Processor** | **GitHub, Inc.** Monorepo `apps/web`, `services/directus`, `docs/`. |
| **Role** | **Direct processor — with a standing prohibition.** |
| **Data** | **Must contain none.** Code, schemas, ADRs, documentation. **Secrets by reference only** — the comms ADR §8 is explicit that no provider credential lives in the repo. |
| **Purpose** | Version control and CI. |
| **Processing location** | **US.** |
| **Sub-processors** | `UNVERIFIED`. |
| **DPA status** | **`NOT ENGAGED`** (GitHub terms + enterprise agreement, not a negotiated DPA). |
| **Named owner** | **CTO** |
| **Transfer mechanism** | **`BLOCKED — pending counsel`** *if* personal data ever reaches the repo. **This row's control is a prohibition, not a contract: no personal data in source control, ever.** The org name `apostolic-faith-church` is decided; repo creation is credential-gated ([AFC-165](/AFC/issues/AFC-165)). |
| **Review date** | 2026-11-30, and on every repo-creation event |

### P10 — Prototype environment

| Field | Value |
| --- | --- |
| **Processor** | **Directus Cloud** + **Vercel**. |
| **Role** | **Direct processor — prototype only.** |
| **Data** | **Must be synthetic only.** Seeding a prototype with real personal data would be an entirely unassessed transfer, including children's and health data. |
| **Purpose** | Design and demonstration before production exists. |
| **Processing location** | **US.** |
| **Sub-processors** | `UNVERIFIED`. |
| **DPA status** | **`NOT ENGAGED`.** |
| **Named owner** | **CTO** |
| **Transfer mechanism** | **Not applicable while synthetic. Becomes `BLOCKED — pending counsel` the moment real data is loaded — which is why "prototype only" is a control and not a label.** |
| **Review date** | Before any production go-live decision |

### P11 — Staff operations messaging

| Field | Value |
| --- | --- |
| **Processor** | **Telegram Bot API.** |
| **Role** | **Direct processor.** P3 priority: staff alerts only. |
| **Data** | **None by design.** The spec requires personal data to be carried **out of** message text — alerts reference a record, not a person. |
| **Purpose** | Staff operational alerts. Not a data-subject channel. |
| **Processing location** | **UAE.** |
| **Sub-processors** | `UNVERIFIED`. |
| **DPA status** | **`NOT ENGAGED`.** |
| **Named owner** | **CTO** |
| **Transfer mechanism** | **`BLOCKED — pending counsel`** on the transfer itself, but the exposure is designed out. **Chat must never be shipped to minors** — safeguarding policy §14 forbids adult-to-minor private messaging. This row stays P3 and does not graduate. |
| **Review date** | 2026-11-30 |

---

## 2. Considered and excluded — recorded so the register is not re-litigated

| Candidate | Why excluded |
| --- | --- |
| **Mautic** (outbound marketing platform) | **Rejected by ADR.** Marketing is built in-app. **No marketing processor exists.** |
| **Payments processor** | **None selected.** Giving is handled in-app in v1. If a payment processor is added, it enters this register as a new row with a named owner before any transaction. |
| **Caddy / TLS termination** | Infrastructure software, self-hosted on P1. Not a separate processor. |
| **Lettering / AI services** | None engaged. No personal data is sent to any model provider. If that changes, it is a new row. |

---

## 3. Count, cost and the decision this register enables

| | Count |
| --- | --- |
| Processors in the register | **11** |
| of which **named, not chosen** (candidate rows) | **5** — P2, P3, P5, P8, and the BSP half of P5/P6 |
| of which **NOT ENGAGED** | **11 of 11** |
| of which `BLOCKED — pending counsel` on transfer | **10 of 11** (P4 is not, while Termii holds NG traffic) |
| **Recurring exposure if the ₦5,000/processor fee applies** | **up to ₦55,000/yr**, on top of a CAR of up to ₦500,000/yr |

**The decision this enables, and it is a real one:** five rows are candidates that no one has chosen. Each candidate row that gets dropped before go-live is **₦5,000/year saved** and one DPA negotiation removed. **The two rows worth thinking hardest about before anyone signs anything are P2 (backup) and P8 (monitoring)** — P2 because it carries the full dataset off-site and nobody has decided where, and P8 because we have not audited what our own logs contain.

---

## 4. Storage conditions R1–R6 — recorded as satisfied, not argued

The board's conditions on storing youth and camp data are **R1–R6**. This register does **not** re-open them. What it records is their **current status honestly**:

| Condition | Status |
| --- | --- |
| Retention **enforced by system** | **NOT MET — but for a different reason than before.** The engine now **exists** ([AFC-167](/AFC/issues/AFC-167), [ADR-0002](/AFC/issues/AFC-169#document-adr-0002-roles-are-bootstrap-not-migrations) D1–D6, proven by `tests/db/60`–`65`). What is missing is that nothing invokes it: there is no scheduler, no policy rows are seeded, `delete_enabled` defaults `false`, and review findings F1–F6 are still open ([AFC-200](/AFC/issues/AFC-200), [AFC-205](/AFC/issues/AFC-205), [AFC-215](/AFC/issues/AFC-215)). A built engine that is dark is not enforcement. |
| Records deleted at end of retention | **NOT MET.** `retention.run` can delete in `live` mode, and no policy exists to trigger it and no scheduler calls it. |
| Erasure complete across backups | **NOT MET — mechanism now decided, nothing built.** [ADR-0005](/AFC/issues/AFC-169#document-adr-0005-erasure-lag-is-the-backup-window) fixes the mechanism (no WAL; 30/12/**3**; external hash-chained `erasure_ledger`; gated restore), which reduces the media bound from 12 months to ~90 days. There is still **no backup job of any kind** in the repository, so there is nothing to enforce against. |
| Access limited to need-to-know | Met by design (Directus RBAC + branch scoping). |
| Segregation of children's and health data | **NOT MET.** Same instance, same volume, same proxy as attendance and giving — separated by application-layer permissions only. |
| Encryption in transit and at rest | Met by design (TLS via Caddy; disk encryption `UNVERIFIED`). |

**This is the most consequential thing in this document.** Storage is permitted under R1–R6; **three of the six conditions are not met by a system today.** That does not block storing the data, and it does not block this register. It means the board's own condition is being met by **process rather than by system**, and the board should know that rather than discover it at audit. Plan §5.2 records the same thing and it has not changed.

---

## 5. Open items — counsel questions, recorded with question number, not decided

**This register decides no retention duration and no legal basis.** Those are counsel questions. Each is recorded as open against the question number on [AFC-160](/AFC/issues/AFC-160).

| Ref | Open question | Register rows affected | Status |
| --- | --- | --- | --- |
| **Q21** | Cross-border transfer ground for the hosting jurisdiction named by `DEPLOY_REGION`, and whether children's + health data must be Nigeria-resident. Interacts with the non-segregation fact. | P1, P2, and every non-NG comms row | **OPEN — `BLOCKED — pending counsel`** |
| **Q20** | **Criminal-offence data has no lawful basis, no collection modelled and no retention rule.** It appears in no checklist row. Volunteer background checks are required by policy §13. | P1, P2 | **OPEN** |
| **Q (backup erasure)** | Acceptable position on records deleted from the primary store persisting up to 12 months in backup media. | P2 | **OPEN** |
| **Q (s.30(1)(d))** | The determination brief §1.4 found **NDPA s.30(1)(d)** supplies a lawful basis for sensitive processing by a religious non-profit — **conditioned on** (i) processing relating solely to members or persons with regular contact, and (ii) **no disclosure outside the entity without explicit consent**. Condition (ii) directly constrains every processor DPA on this register. | **All 11 rows** | **OPEN — this is the single most consequential open item in the register** |
| **Q (retention durations)** | Every duration in [policy §9](/AFC/issues/AFC-148#document-safeguarding-policy), and whether they are over-retention. The plan flags an 8-year-old's special-category record held for roughly **17 years**. | P1, P2 | **OPEN — not decided here** |
| **Q (LIA)** | Whether any processing relies on legitimate interests, and whether a legitimate interest assessment is required. | To be determined | **OPEN** |

**Counting what this register does not decide: 6 open counsel items, 10 rows blocked on one of them, and 0 rows with an executed DPA.** The register is complete as a register and empty as a contract position. Both halves of that sentence are deliberate.

---

## 6. What this register does not do — the explicit gap list

| # | Gap | Why | Unblock owner and action |
| --- | --- | --- | --- |
| G1 | **No named human owner on any row.** The DPCO/DPO seat is unfilled. | Plan §1.3: no named candidate, no Schedule 3 evidence on file, no payroll. | **CEO** — complete the combined counsel + DPCO engagement ([AFC-160](/AFC/issues/AFC-160)), target signature **2026-10-20**, DPO effective **2026-10-31**. Then name the human on every `HUMAN REQUIRED` row. |
| G2 | **Zero DPAs executed.** 11 of 11 rows are `NOT ENGAGED`. | Nothing can be signed before the transfer mechanism is answered. | **CEO** — cannot start until Q21 reports. |
| G3 | **Hosting region value is unset.** *(Was: "region unpinned". Resolved on mechanism by AFC-171; the value is now a separate, smaller gap.)* | The region is now a declared required parameter — `DEPLOY_REGION` in `services/directus/.env.example` — with no default, and ADR "Pin the production hosting region" requires every document to refer to it rather than naming a location. That closes the *mechanism* gap: nothing can inherit a region by accident any more. **The value remains unset** because choosing one requires spending on a server and the board rejected both procurement approvals on 2026-10-06. | **CTO** — set the value when a production VPS is funded and purchased; then fill the two `Processing location` cells from the same variable and close this row. Until then the cells stay `UNDECIDED` and Q21 stays open. Priced on [AFC-171](/AFC/issues/AFC-171); the legal question is Q21 on [AFC-160](/AFC/issues/AFC-160). |
| G4 | **Backup vendor undecided.** | Never specified. | **CEO** — choose between Hetzner Storage Box/OBJ and Backblaze B2. **Add one question to that evaluation:** does the vendor support *per-snapshot key deletion*? If yes, [ADR-0005](/AFC/issues/AFC-169#document-adr-0005-erasure-lag-is-the-backup-window) "Buy" becomes available and the ~90-day bound can be beaten. If no, we own the arithmetic in that ADR permanently. Cheapest possible probe, largest effect on the erasure answer. |
| G5 | **Email provider undecided.** Board mandated SMTP transport, not a vendor. | — | **CEO** |
| G6 | **WhatsApp BSP undecided.** | — | **CEO**; note Meta template-approval lead time is outside our control. |
| G7 | **Monitoring vendor undecided, and our own logs are unaudited.** | We do not know whether application logs contain identifying data. | **CTO** — audit log content. If identifying data is logged, that is a processor relationship we did not plan for. |
| G8 | **Sub-processor lists `UNVERIFIED` on all 11 rows.** | Not obtained from any vendor. | **CEO** — request the current sub-processor list from each vendor as part of the DPA. Do not rely on a vendor's marketing page. |
| G9 | **No processor has been engaged and no personal data exists.** | Nothing has been built. | — This is the reason the register is cheap to write and the reason it is worth writing now. |

---

## 7. Review

| Trigger | Action |
| --- | --- |
| Any processor added, removed or swapped | Update §1 the same day. **Processor count is a cost line — ₦5,000 per engaged processor per 12 months.** |
| Q21 reports | Rewrite the `BLOCKED — pending counsel` cells on all 10 affected rows. |
| Q20 reports | Add a criminal-offence data row or record why none is needed. |
| Each SADPR cycle (2027-04-30, 2027-10-31, then semi-annually) | DPO compiles the Art. 13 report **from this register** — see §8. |
| Before production go-live | Every row must read `EXECUTED` with a date, or the processor must not be engaged. **No live personal data before that.** |

---

## 8. How the DPO compiles the GAID Art. 13 semi-annual report from this register

Art. 13(5) prescribes **thirteen items** and applies to **every** controller and processor, not only to a DCPMI. The report must be **compiled by the DPO** and submitted to management, acknowledged by the receiving officer, form part of the RoPA, and be verified by a DPCO at the compliance audit.

**This register is designed so the DPO does not re-derive anything.** Item by item:

| Art. 13 item | Read directly from |
| --- | --- |
| (a) Assessment of privacy notices | Not this register. §8 of the checklist; needs its own source. **Gap — flagged.** |
| (b) Types of data being processed | §1 **Data categories**, per row. Includes the special-category inventory. |
| (c) Principles of data protection | §1 **Purpose** + §5 open items. |
| (d) Lawful bases of data processing | §5 — **Q20, Q s.30(1)(d)**. Counsel supplies the answers; the register holds the questions. |
| (e) The need for DPIA where applicable | §1, rows carrying **children's data** and **special-category data**. P1, P2, P5, P6 are the DPIA triggers. |
| (f) Legitimate Interest Assessment | §5 — open. |
| (g) Ease of data subjects exercising their rights | Requires the rights-handling process; **not owned by this register. Gap — flagged.** |
| (h) Data subjects' complaints and remediation | Feeds from the [breach register](/AFC/issues/AFC-163#document-breach-register) and the complaints process. |
| (i) Notices issued by the Commission | Feeds from the **breach register** — every Commission notification is a row there. |
| (j) Guidance sought from the DPCO | §5, question register. |
| (k) Assessment of data security | §4 R1–R6 status, honestly stated. |
| (l) Legal grounds for cross-border data transfer | §1 **Processing location** + **Transfer mechanism** columns, per row. Ten of eleven rows currently read `BLOCKED — pending counsel`. |
| (m) Breach notification to the Commission and to data subjects | The [breach register](/AFC/issues/AFC-163#document-breach-register) and [72-hour runbook](/AFC/issues/AFC-163#document-breach-runbook). |

**The register that fails this table will not survive its first audit.** That is why §4 reports unmet conditions rather than claiming compliance, and why §5 records open questions instead of guessing answers.
