# AFC-1247 — Directus 11 policy patch

Branch: `afc-1247-v11-policy` (from `930b872`). Prep only; no live deploy.

The original `0069/0072` migrations assume Directus v10 `directus_permissions.role`. Staging is Directus 11.17.4, where permissions bind to `directus_permissions.policy` and `directus_policies`; roles reach policies through `directus_access`.

This branch adds the v11 path:

- `0069` and `0072` detect the `policy` column and return without touching v10-style role rows.
- `20261127_0073_directus11_policy_writer_cutover.sql`:
  - creates the `registration_writer` policy (no admin/app access);
  - creates the `registration_writer` role and its policy access row;
  - grants exactly the 18-field create allowlist on `event_registrations`;
  - removes every public `event_registrations` permission (create/read/update/delete);
  - installs the server-side `consent_signed_at` stamp trigger.
- `createRegistration` now reads the created `ticket_code`/`registration_status` with the server token. The writer remains create-only, so it does not need a read grant.

Validation used an explicit `BEGIN … ROLLBACK` against staging; the live permission set was unchanged.

Operator steps after CTO review:

1. Create a Directus user assigned to the `registration_writer` role, mint its static token, and store it as `NUXT_DIRECTUS_WRITER_TOKEN` on the host. Never post the token.
2. Configure `NUXT_TURNSTILE_SECRET_KEY` with the staging test secret and make probe payloads send a `turnstile_token`; without a secret the route fails closed with `503 bot_verification_unavailable`.
3. Deploy the reviewed tree, confirm `GET /api/health` SHA, then run probes 01–05.

Do not apply `0069/0072` directly to a v11 database; they are guarded now, but the writer token and Turnstile configuration must exist before the public grant is revoked.
