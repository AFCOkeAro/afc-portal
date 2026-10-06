# Integrations Specification — Church Portal

**Issue:** AFC-150 · **Parent:** AFC-146 · **Owner:** CTO (MediaTech) · **Version:** v1 (2026-10-05)
**Planning only — no code, no deployments, no secrets.**

This spec covers the integrations the board listed: **Gravatar, Email, Telegram, SMS, WhatsApp, Backup, Users Management, the weekly birthday-reminder webhook, and data import/export.** Email/SMS/WhatsApp ride on the existing communications stack (Directus Flows + the **Symfony Notifier worker**, SMTP default) from the [comms ADR](/AFC/issues/AFC-149#document-comms-adr); they are summarised here, not re-designed.

**Cross-cutting rules (all integrations):**
- **Secrets are referenced, never stored.** Each integration stores a `secret_ref` (e.g. `env.TELEGRAM_BOT_TOKEN`); the value lives only in the Paperclip/GitHub secret store. Never in the database, UI, docs, or repo.
- **Server-side only.** Outbound calls and callbacks run server-side (Directus Flow/worker/SSR route), never in the browser.
- **Least privilege.** Each integration gets the narrowest scope/token it needs; rate-limited and monitored.
- **Fail-safe, idempotent.** External calls are retried with idempotency keys; a failed integration must not corrupt core records.
- **Observability.** Every send/import/backup writes a log row with status, provider reference, and cost where billable.

---

## 1. Gravatar (person avatars)

**Purpose:** show a person's external avatar from their email without storing one, with an uploaded photo as the authoritative fallback.

| Item | Detail |
| --- | --- |
| What | Gravatar lookups by MD5/SHA-256 hash of the lowercased, trimmed email |
| API | Public, keyless: `https://www.gravatar.com/avatar/{hash}?d=404&s=200` (return 404 so we can fall back) |
| Auth | None (public) |
| Secret | None |
| Data stored | `people.gravatar_hash` (derived from email), `people.avatar_url` (resolved) — **no email is sent anywhere new**; the hash is one-way |
| Fallback | `people.photo` (uploaded) → initials avatar → generic placeholder |
| Flow | `gravatar.resolve` on email change: compute hash, store; UI resolves URL at render |
| Privacy | Publishing a hash is not a data disclosure (one-way). Respect `consent_media`: no avatar shown publicly without consent |
| Failure | Degrade to placeholder; never block the page |
| Portability | Isolated resolver in `useApi`/SSR; swappable |

**Recommendation:** on by default; the uploaded photo always wins when present.

---

## 2. Email

**Purpose:** transactional email (registration confirmations, reminders, task/meeting reminders) and email-channel communications (greetings, announcements).

| Item | Detail |
| --- | --- |
| Transport | **SMTP via Symfony Mailer** (default, per the comms ADR) |
| Sender | Church domain (e.g. `no-reply@portal.<church-domain>`); SPF, DKIM, DMARC required |
| Secret | `env.SMTP_DSN` / `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD` (referenced by name) |
| Flow | `comms.send` → Notifier worker renders + sends; `communications` + `communication_recipients` record status |
| Templates | `message_templates` (subject + body with `{{variables}}`) |
| Bounce/complaint | Provider webhook → `delivery_status`; hard bounce → mark contact invalid |
| Cost | Free/included with SMTP provider; track volume |
| Failure | Queue + retry; record `failed` with redacted error |

---

## 3. Telegram

**Purpose:** internal ops notifications and reminders (new-visitor alerts, overdue follow-ups, birthday reminders, backup/incident alerts, task assignments) to staff chats/channels. Outbound-first in v1 (no inbound command handling).

| Item | Detail |
| --- | --- |
| API | Telegram Bot API (`https://api.telegram.org/bot{token}/sendMessage`, `sendDocument`) |
| Auth | Bot token from **@BotFather** |
| Secret | `env.TELEGRAM_BOT_TOKEN`; chat/group IDs stored in a `telegram_destinations` config (non-secret) |
| Transport | Prefer a **Symfony Notifier `telegram` bridge** (chat channel) so it shares the worker; otherwise a thin custom transport |
| Destinations | Named groups (e.g. `office-alerts`, `youth-leads`, `campus-coordinators`) mapped to chat IDs, scoped per area/zone/branch |
| Messages | Plain text/Markdown; no sensitive personal data in message bodies (link back to the portal instead) |
| Flow | `notify.telegram` triggered by Directus events (new visitor, overdue task, incident) |
| Rate limits | Respect Telegram limits (≈30 msg/s global, 20/min per group); batch and throttle |
| Security | Bot token is a high-value secret; rotate on exposure; grants **no** access to church data |
| Failure | Log + retry with backoff; never block the triggering action |

**Recommendation:** Telegram is for **staff alerts**, not member outreach (members use Email/WhatsApp/SMS). Keep personal data out of message text.

---

## 4. SMS

**Purpose:** SMS-channel communications (reminders, greetings, event notices, opt-in driven).

| Item | Detail |
| --- | --- |
| Provider | **Termii** (Nigeria-first) via `symfony/termii-notifier`; fallback Twilio/Infobip Notifier bridges; Africa's Talking via thin custom transport |
| Secret | `env.TERMII_API_KEY` (or provider key) referenced by name |
| Sender ID | Registered sender ID; DND/NCC compliance |
| Consent | Channel-level `sms` consent; opt-out keyword writes a `consent_records` denial; honour DND |
| Cost | Per-message, NGN; `communication_recipients.estimated_cost`; send-size/approval gate |
| Flow | `comms.send` (shared) + `comms.delivery_webhook` |
| Failure | Queue/retry; `delivery_status = failed/undelivered`; cost reconciliation |

---

## 5. WhatsApp

**Purpose:** WhatsApp-channel communications via the official WhatsApp Business Platform.

| Item | Detail |
| --- | --- |
| API | **WhatsApp Business Cloud API (Meta)**, via a Business Solution Provider (360dialog / Infobip / Twilio) |
| Auth | Church owns the **WhatsApp Business Account (WABA)** and phone number; provider issues a token |
| Secret | `env.WHATSAPP_TOKEN` / provider key referenced by name |
| Templates | Business-initiated messages require **provider-approved templates**; `message_templates.provider_template_id` + `approval_status` |
| Window | 24-hour customer-service window for free-form replies; we stay outbound-first in v1 |
| Consent | `whatsapp` channel consent; guardian consent for minors; opt-out handling |
| Cost | Per-conversation/message; track and cap |
| Flow | `comms.send` via a thin Notifier transport; webhook → status |
| Failure | Record failure reason; never auto-retry beyond provider policy |

---

## 6. Backup

**Purpose:** protect data and media; support restore (see [infra-spec](/AFC/issues/AFC-147#document-infra-spec) §6).

| Item | Detail |
| --- | --- |
| Database | Nightly `pg_dump -Fc` + WAL archiving where available |
| Media | Nightly sync of the uploads volume to S3-compatible object storage |
| Off-site | Backups pushed to object storage with versioning/immutability |
| Retention | 30 daily, 12 weekly, 12 monthly; quarterly restore drill |
| Secrets | Separate backup credentials (never the app token); `secret_ref` only |
| Alerting | Backup job exit status → alert (Telegram/email) on failure |
| Targets | RPO ≤ 24h, RTO ≤ 4h |
| Board-facing | A **Backup** status page in the portal (last success, size, drill date) for admins |

---

## 7. Users Management

**Purpose:** manage staff/user accounts, scopes, and roles without a separate IAM.

| Item | Detail |
| --- | --- |
| Platform | Directus users + roles/policies (custom fields: area/zone/branch/department/household scopes, `staff_role`, `access_expires_at`) |
| Admin UI | Super/area admins manage users in the portal (scoped subset) or Directus Studio |
| Provisioning | Admin creates user → assigns scope + role; Flow computes `zone_ids`/`branch_ids`/`department_ids` |
| Deactivation | Disable account on transfer/retirement; preserve audit history |
| Guest/school contact | Time-boxed account (`access_expires_at`), field-limited, no people access |
| MFA | Enable where Directus supports; required for super/area admins |
| Audit | Directus activity log on user changes |
| Boundary | Engineering agents are granted only the access their charter requires (no broad IAM grants) |

---

## 8. Weekly birthday-reminder webhook

**Purpose:** fire a scheduled webhook each week with upcoming birthdays/wedding anniversaries so an external system (or the comms worker) can greet people.

| Item | Detail |
| --- | --- |
| Trigger | Directus scheduled Flow, weekly (configurable day/time, Africa/Lagos) |
| Payload | JSON: `{ week_start, week_end, scope, birthdays:[{person_id, name, branch, date}], anniversaries:[{person_id, couple, branch, date}] }` — **no contact values**; IDs + names only |
| Auth | Outbound request signed with HMAC-SHA256 header; `env.BIRTHDAY_WEBHOOK_SECRET` referenced by name |
| Destination | Configurable URL (`birthday_webhook_url`); default = internal comms worker endpoint |
| Privacy | Payload carries no phone/email; the consumer fetches/queues greetings through the consent-gated comms module |
| Idempotency | `Idempotency-Key: birthday:{week_start}`; consumer must dedupe |
| Failure | Retry with backoff; log; never block the schedule |

---

## 9. Data import / export

**Purpose:** onboard data, upload prior-year data, and allow permitted exports (CSV).

| Item | Detail |
| --- | --- |
| Export | Server-side CSV export per domain (attendance, blessings, people, households, finance, campus, events) — permission-scoped, streams the current filtered query |
| Import | CSV upload with a **published template per domain**; validate → dry-run errors → commit; idempotent (natural keys: `(branch, month)`, `(session, category, sex)`, person dedupe on name+phone/email) |
| Prior-year | Imports carry `source = import` and a `data_year` so compare-with-previous-year works |
| Provenance | Every imported row records `import_batch`, `imported_by`, `imported_at` |
| Limits | File size cap; async job for large files (Flow → file → notification) |
| Security | Import/export restricted to area/super admins (or scoped branch admins for their own data); no secrets in files |
| Failure | Row-level error report; partial import is explicit and reversible by batch |

---

## 10. Integration summary matrix

| Integration | Direction | Auth | Secret ref | Cost model | v1 phase |
| --- | --- | --- | --- | --- | --- |
| Gravatar | outbound read | none | – | free | MVP |
| Email (SMTP) | outbound | SMTP | `env.SMTP_DSN` | included | MVP |
| Telegram | outbound | bot token | `env.TELEGRAM_BOT_TOKEN` | free | P3 |
| SMS | outbound | API key | `env.TERMII_API_KEY` | per message | P4 |
| WhatsApp | outbound | BSP token | `env.WHATSAPP_TOKEN` | per message | P4 |
| Backup | internal + object storage | key | `env.S3_*` | storage | P1 |
| Users Management | internal | Directus | – | free | MVP |
| Birthday webhook | outbound | HMAC | `env.BIRTHDAY_WEBHOOK_SECRET` | free | P4 |
| Import/export | internal | Directus | – | free | P6 (prior-year earlier if data exists) |

**Provider abstraction:** SMS/WhatsApp/Email/Telegram all resolve through the Notifier worker transport layer, so a provider swap is a DSN/config change, not a code change (own the integration surface).

---

*Companion: [prd-expansion](/AFC/issues/AFC-150#document-prd-expansion), [data-model-expansion](/AFC/issues/AFC-150#document-data-model-expansion), [address-evaluation](/AFC/issues/AFC-150#document-address-evaluation), [comms ADR](/AFC/issues/AFC-149#document-comms-adr). Planning only — no secrets, no live calls.*
