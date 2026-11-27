# AFC-1256 cutover runbook — Directus 11 writer cutover

Status: **deployed to staging at `79ace74`** (2026-11-27). CTO approved the
0072 public-scoped guard and the deploy. Probes 01–05 pass. This file is the
reproducible record; it contains no secret values.

## Deployed tree

`origin/staging` at `79ace74`:

- `4a448f9` — merge the CTO-reviewed `0276b42` v11 policy migrations into the
  `930b872` hardening tree.
- `2c93231` — deploy merge onto `ed19fa8`; kept the G2 server-token capacity
  pre-check and both the AFC-1217 Caddy rate limit and the AFC-1222 log line.
- `ae90830` — staging compose now passes `NUXT_DIRECTUS_WRITER_TOKEN` and
  `NUXT_TURNSTILE_SECRET_KEY` to the web container.
- `a22f5de` — no-key readback orders by `created_at` (the live column), not
  `date_created`.
- `c8fd99a` — Directus 11 sanitizes the capacity trigger refusal to a generic
  500; the route now re-reads the seat count and maps at/over capacity to the
  existing 409/waitlist path instead of a bare 502.
- `79ace74` — `0073` registers `event_registrations.idempotency_key` in
  `directus_fields` and documents the Directus restart.

## Live configuration (no values here)

- Directus policy `registration_writer` (create-only, exactly 18 fields),
  role `registration_writer`, access row, and static user
  `registration-writer@staging.bluespace.ng`.
- `NUXT_DIRECTUS_WRITER_TOKEN` in both host env files; token value root-only at
  `/root/afc-staging-writer-token.txt` on CT105.
- `NUXT_TURNSTILE_SECRET_KEY` set to the Cloudflare always-pass test secret.
  Probes send `turnstile_token`; production must get a real secret.
- `NUXT_DIRECTUS_PUBLIC_TOKEN` is the `portal-public@staging.local` static token.
  The git checkout's "public" token was actually the staging admin token; the
  cutover moved it to `NUXT_DIRECTUS_SERVER_TOKEN` and put the portal-public
  token back in the public slot.
- The server token is therefore the staging admin static token. It works, but a
  scoped staging service token is the least-privilege follow-up.

## Create-only write path

The G3 writer policy is create-only, so Directus answers the POST with
`204 No Content`. `createRegistration` does not read the create response; it
resolves the row with the server token:

1. `Idempotency-Key` present: look up `(event, idempotency_key)`.
2. No key: newest row matching the shared normalized contact/name key,
   ordered `-created_at`.
3. Three bounded attempts, then a named `503 registration_readback_failed`.
   The caller retries with the same key and the retry replays.

The writer token keeps no read grant.

`0073` is required for step 1: 0070 added the column and grants but not the
Directus `directus_fields` metadata, so Directus silently ignored the key on
create and refused to filter/read it. **After applying 0073, restart Directus**
(or reload its schema cache) or the field stays invisible to the API.

## Migration sequence that was applied

1. Pre-snapshot removed the anonymous `$t:public_label` create row and the
   `portal-public-feed` read row. That left exactly one public create row
   (`portal-public-feed`) for `0069`; public create count 2 → 1, public
   non-create 1 → 0, total 19 → 17.
2. `0069` converged the remaining public create row to the 18-field public
   allowlist.
3. `0070`/`0071` installed the capacity gate and its definer.
4. `0072` validated the writer policy/allowlist, deleted the public create row,
   scoped the false-green guard to the public policy set, and installed the
   consent stamp trigger.
5. `0073` registered the idempotency field metadata; Directus was restarted.

Post-deploy state: `event_registrations` permissions = 16; public create = 0;
public non-create = 0; writer create = 1 with the exact 18-field allowlist;
three legitimate staff/admin create grants survive; consent and capacity
triggers present.

The `0072` guard is scoped to `p.policy = ANY(v_public_policies)`. Staff/admin
create grants for the staff walk-in route (`source='staff'`) are legitimate and
must survive; the writer allowlist excludes `source`.

## Validation on `79ace74`

- `GET /api/health` → `{"status":"ok","sha":"79ace74493cd6bddf70f0ab65174141f180bb9f2","registrationOpen":true}`.
- Probe 01 (one-seat event, two concurrent POSTs): one `200` winner, one
  `409 event_full`.
- Probe 02 (same `Idempotency-Key` twice): same id and ticket, second answer
  `replay: true`.
- Probe 03 (direct anonymous POST to Directus): `403`.
- Probe 04 (rotating XFF): shared bucket answered `429` with `Retry-After` and
  `retryAfterMs`.
- Probe 05 (writer token cleared, web recreated): `503
  registration_writer_unavailable`; after restoring the token and recreating
  web, a fresh registration returned `200`.
- Synthetic probe rows and the synthetic one-seat event were deleted after the
  run.

## Rollback

- Pre-cutover dump: `/root/afc-staging-pre-afc1256-20261127T012726Z.dump` on
  CT105. Auto-deploy also wrote dumps under `/root/afc-staging-auto-*.dump` at
  each migration step.
- Restore the DB dump, restore the previous env, then recreate `web` and
  `directus`. A DB restore alone does not reload Directus's schema cache.
- Env backups from the token-topology correction are root-only
  `/root/afc-env-staging-*.bak` on CT105.
- Do not restore a dump without also restoring the matching `.env`; the public
  and server token slots are not interchangeable.

## Future deploy checklist

1. `pg_dump` first.
2. If starting from a pre-cutover DB, run the pre-snapshot in the same window.
3. Apply `0069`–`0073` with `ON_ERROR_STOP=1`.
4. Restart Directus after `0073` so the idempotency field is loaded.
5. Build/recreate web.
6. Confirm `/api/health` SHA equals the deployed commit.
7. Run probes 01–05 with `TURNSTILE_TOKEN`; direct anonymous POST must be `403`.
8. Keep the dump until the probes pass.

## Residual

`afc-public-reader` still has a **create** row on `event_registrations`
(permission id `8139`, fields `*`). No user holds the `Public Reader` role, so
it is inert. Remove it in a reviewed snapshot if the role is retired.
