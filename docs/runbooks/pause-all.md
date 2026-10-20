# Pause-all procedure — AFC-486 (US-C5, ADR-0009 decision 4), single action AFC-525

Owner: area admin. Effect window: one scheduler tick. This is the single
action that stops a bad message reaching the congregation. No deploy, no
secret, no new service.

## Single action (acceptance)

POST `/api/hardening/pause-all` with `{ "reason": "...", "disable_channels": false }`
— or press **Pause all now** on `/hardening/status`. One call:

1. pauses every `active` campaign (`status = paused`, `paused_at`, `paused_by`,
   `pause_reason`);
2. when `disable_channels: true` (optionally scoped by `channel`), disables
   the channel(s) (`communication_channels.enabled = false`);
3. logs `pause_drill` to `hardening_monitor_checks` (ok + ids/counts only);
4. returns the staff-channel announcement (`hardeningAlert`: ids + counts
   only, never message content).

Area admin only (`pause_owner_area_admin` otherwise). The manual per-campaign
/ per-channel steps below remain documented as what this route does.

## What "paused" means

- `campaigns.status = paused` holds pending enrollments: rows stay
  (`state = paused`), nothing queued is deleted, and the very next tick
  excludes them (suite §74.4 pins this on the due-read).
- `communication_channels.enabled = false` holds a whole channel within
  one tick (same suite, same guarantee).
- Both transitions are Flow-guarded and audit-logged with actor, reason,
  and scope (`paused_by` / `pause_reason` shadow the Directus activity
  log — 0006 stated choice 4).

## Pause everything (in this order)

1. Pause each active campaign: set `status = paused` with reason
   (e.g. "suspected wrong template — AFC-486 drill"). The campaign list
   shows the state flip on the next poll.
2. If the fault is channel-wide (provider incident, template revoked),
   disable the channel: `communication_channels.enabled = false` for the
   affected channel. This holds even campaigns nobody thought to pause.
3. Confirm on the next tick: `campaign_due_enrollments(now())` returns
   zero rows for paused campaigns / disabled channels, and
   `GET /api/hardening/status` shows `queue_depth` draining to the held
   rows only. Log `pause_drill` to `hardening_monitor_checks`.
4. Announce in the staff channel (Telegram): what was paused, why, scope,
   who did it. Ids and counts only — never message content.

## Resume

1. Fix the cause (template re-approved, copy corrected, audience fixed).
2. Preview counts before re-activation (US-C1 AC2: eligible + excluded by
   reason visible before activation).
3. Set `status = active`; enrollments resume from `next_step_at` — held
   rows were kept, not deleted, so nothing is lost and nothing double-sends
   (send-key UNIQUE, US-C2 AC2).
4. Watch the first tick's run row: sent/delivered/failed/opted_out plus
   estimated vs actual cost (US-C2 AC1).

## Last exercised

2026-10-20 — Coder (AFC-486). Database half verified by suite §74.4
(kill-switch acceptance: pausing removes enrollments from the very next
due-read, rows held not deleted; resume restores them) and the worker
half by tests/web/campaign-tick.contract.mjs (tickHold, chunked replay
with zero re-queues). Monitor half logged by suite §82.6 (monitor log
append-only) and the pause_drill check in hardening_monitoring.json.
See drill-log.md.
