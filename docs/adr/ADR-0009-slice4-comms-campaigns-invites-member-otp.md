# ADR-0009 — Slice 4: communications, invitations, campaigns, member OTP

**Status:** Accepted · **Date:** 2026-10-20 · **Owner:** CTO (MediaTech) · **Issue:** AFC-464
**Sources:** [prd-addendum-v4](../planning/prd-addendum-v4.md) §3–§4,§6 · [data-model-v4](../planning/data-model-v4.md) §3–§5 · [integrations-addendum](../planning/integrations-addendum.md) · [mautic-adr](../planning/adr-mautic-vs-in-app.md)

## Context

Slice 4 adds the first outbound-messaging and campaign-automation surface to the portal, plus the first non-staff authenticated role (member via phone OTP). Nothing in this domain exists in code yet: no `communications`/`campaigns`/`event_invites` collections, no consent resolver, no scheduler tick, no OTP flow. The v4 planning docs already fix the data model; this ADR records the build decisions and their order.

## Decisions

1. **Consent is resolved at audience time, basis stored on the recipient row** (`communication_recipients.consent_basis`). A send with no resolvable basis is excluded with a reason — never queued. No manual override path exists. *(Security & least privilege lens; NDPA: a consent failure is a data-protection incident, not a UI annoyance.)*
2. **One delivery log for everything.** Campaign sends, invite sends, and manual sends all write `communications` + `communication_recipients` with `source_kind` (`manual|campaign|invite|…`). No parallel log tables. *(Architecture lens: one aggregate for delivery status.)*
3. **Campaign runtime is a `campaign-tick` in the existing Symfony Notifier worker**: every minute, single-instance lock, chunks of 500, idempotency key `campaign:{campaign}:step:{step}:person:{person}:{window}`. Directus Flows own triggers/enrolment only — not the state machine. *(Testing lens: "which steps are due at T for P" is a pure unit-testable function; nested Flows are not. Deployment lens: new entry point in an existing container, rollback = remove the cron line.)*
4. **Kill switch semantics:** `campaigns.status = paused` holds pending enrollments (does not delete queued sends); `communication_channels.enabled = false` holds a whole channel. Both take effect within one scheduler tick. Pause/resume transitions are Flow-guarded and audit-logged with actor, reason, scope.
5. **WhatsApp→SMS fallback:** fires 4h after `sent_at` when `has_activity(r)` is false (`delivered_at OR read_at OR inbound_reply_at`), ≤1/person/24h per campaign family, SMS consent still required, `delivered_at` is the documented activity proxy until the BSP confirms read/inbound webhooks (OQ-R5). Run `notes` state which signals were available.
6. **Member OTP ships behind a SecurityEngineer gate.** Phone-OTP design (rate limit, attempt lockout, enumeration resistance, session scope restricted to own `person` record, `member_access_expires_at` support) must carry a recorded SecurityEngineer verdict before OTP endpoints are enabled in any user-facing path. Schema scaffolding may proceed; enablement may not. *(Risk lens: a new auth path for thousands of members is the highest-risk item in this slice — a one-way door.)*
7. **Reaffirm in-app over Mautic.** No new service, secret, or dependency for campaigns (integrations-addendum §5). Revisit trigger stays: ~100k msgs/month or non-technical authorship need. *(Build vs buy lens.)*

## Alternatives considered

- **Mautic/external suite for campaigns** — rejected in mautic-adr (second source of truth, operator cost); reaffirmed here.
- **Consent checked in UI only** — rejected; UI checks are bypassable, the resolver is the enforcement point and the audit trail.
- **Password-based member login** — rejected; members have no managed credentials, OTP over WhatsApp/SMS matches the channel reality (OQ-R7).
- **Separate delivery log per surface** — rejected; wireframes v3 already show one log, duplication would fork delivery-status truth.

## Consequences

- Coder tracks (delegated, AFC-464 children): (a) comms/templates/consent/delivery-log schema + resolver; (b) invitations with rate limits + opt-out; (c) campaign engine + 8 families + tick; (d) member role + OTP (enablement gated on SecurityEngineer verdict).
- Scheduler SLO: a due step begins within 5 min of its window 99% of time; tick duration + exclusions-by-reason are logged metrics; campaign anomaly → Telegram staff alert.
- Cost: SMS is the only per-message cost; `daily_cap` per channel set from the real rate card at procurement, owner = area admin. Procurement lead times (WABA, template approval, Termii sender ID) start in MVP per integrations-addendum §10 — engineering does not wait on them, go-live does.
- Tech-debt ledger: `read_at` proxy assumption (revisit when BSP confirms webhooks); `filter` allowlist on `campaign_audiences` (extend deliberately, never to raw SQL).

## Sign-off

- CTO: accepted (this ADR). SecurityEngineer: required before member OTP enablement (tracked as AFC-464 child). CEO/Board: procurement items I1–I4 (owner CEO) + bulk-threshold decision C7.
