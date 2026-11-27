# AFC-1256 cutover runbook — integration tree `4a448f9` + this patch

Branch only. Do not deploy until the CTO re-reviews the 0072 guard scope change
and the operator has a deploy window. Never paste the writer token.

## What is already done on staging (no deploy)

- Directus policy `registration_writer` (create-only, 18-field allowlist).
- Role `registration_writer`, access row, and static user
  `registration-writer@staging.bluespace.ng`.
- `NUXT_DIRECTUS_WRITER_TOKEN` in both host env files; token value root-only at
  `/root/afc-staging-writer-token.txt` on CT105.
- `NUXT_TURNSTILE_SECRET_KEY` set to the Cloudflare always-pass test secret.
  Probes must send `turnstile_token`; production must get a real secret.

## The create-only write path

The G3 writer policy is create-only, so Directus answers the POST with
`204 No Content`. `createRegistration` no longer reads `id`/`ticket_code` from
that response. It resolves the created row with the server token:

1. `Idempotency-Key` present: look up `(event, idempotency_key)`.
2. No key: newest row matching the shared normalized contact/name key,
   ordered `-date_created`.
3. Three bounded attempts, then a named `503 registration_readback_failed`.
   The caller retries with the same `Idempotency-Key`; the retry replays.

The writer token keeps no read grant. Reads stay on the server token that the
dedupe path already uses.

## Migration preconditions found on staging

Staging is Directus 11.17.4 with 20 `event_registrations` permission rows. The
resolved public set (anonymous `$t:public_label` + the `portal-public` role/user)
holds **two** create rows and **one** read row:

- `$t:public_label` — create `*` (anonymous)
- `portal-public-feed` (`4c9c0d6b…`) — create `*`, read ticket fields
- `portal-public-feed` (`4c9c0d6b…`) — read `id,event,registration_status,ticket_code`

`0069` refuses more than one public create row and any public non-create row.
`0072` refuses while those exist. The approved migrations deliberately refuse
ambiguity rather than invent or widen a grant.

### Required pre-deploy snapshot (operator, reviewed)

Run this immediately before the new migrations, in the same maintenance window.
It removes only the anonymous public create row and public non-create rows; the
single remaining public create row (`portal-public-feed`) is what `0069`
converges, and `0072` then deletes it. The browser never holds a Directus token,
and no app path reads registrations with the public token, so no read is lost.

```sql
DELETE FROM directus_permissions p
 WHERE p.collection = 'event_registrations'
   AND p.action = 'create'
   AND p.policy IN (SELECT a.policy FROM directus_access a
                     WHERE a.role IS NULL AND a."user" IS NULL);

DELETE FROM directus_permissions p
 WHERE p.collection = 'event_registrations'
   AND p.action <> 'create'
   AND p.policy IN (
     SELECT a.policy FROM directus_access a
      WHERE a.role IS NULL AND a."user" IS NULL
     UNION
     SELECT a.policy FROM directus_access a
       JOIN directus_users u ON u.id = a."user"
      WHERE u.email = 'portal-public@staging.local'
     UNION
     SELECT a.policy FROM directus_access a
      WHERE a.role IN (SELECT u.role FROM directus_users u
                        WHERE u.email = 'portal-public@staging.local'
                          AND u.role IS NOT NULL)
   );
```

Take a `pg_dump` first. The auto-deploy already dumps when migrations are new;
do not rely on it alone.

## The 0072 guard scope correction (needs CTO re-review)

`0276b42`'s final guard refused **any** create row outside `registration_writer`.
Staging legitimately has create rows on Area Admin, Branch Admin and Zone Admin
policies for the staff walk-in route. That route writes with the staff user's
token and stamps `source='staff'`; the writer allowlist deliberately excludes
`source`, so folding staff create into `registration_writer` would break staff
attribution.

The guard is scoped to the public policy set:

```sql
AND p.policy = ANY(v_public_policies)
AND p.policy <> v_writer_id
```

Security outcome is unchanged: public create is zero; a public-set grant the
resolution missed still fails the deploy. Staff/admin create grants are
untouched. Suite 104 now carries a staff `event_registrations` create fixture
and asserts it survives.

This is a change to a CTO-reviewed migration. It is committed as a **draft** and
must not merge or deploy without CTO R2.

## Validated sequence (rolled-back transaction, staging)

1. Pre-snapshot: delete anonymous create + public non-create.
2. `0069` → converges the one remaining public create row to the public
   allowlist.
3. `0070`/`0071` → capacity gate and definer (byte-identical replays).
4. `0072` → validates the writer policy/allowlist, deletes the public create
   row, scopes the false-green guard, installs the consent stamp trigger.
5. Verify: `public_create=0`, `writer_create_fields` is the 18-field allowlist,
   `total=17` inside the transaction.
6. `ROLLBACK`; staging remains at 20 rows, 2 public create, 1 public non-create,
   1 writer policy.

## Deploy (only after CTO approval + window)

1. Merge/push the reviewed integration commit to `origin/staging` (auto-deploy
   target). The health SHA must be the actual integration commit, not `930b872`.
2. Run the pre-deploy snapshot **before** the migration job, or apply the
   migrations by hand in order with `ON_ERROR_STOP=1`.
3. Build/recreate web. Confirm `GET /api/health` SHA equals the deployed commit.
4. Run probes 01–05 with `TURNSTILE_TOKEN` set.
5. Direct anonymous `POST /items/event_registrations` must be `403`.
6. Keep the `pg_dump` until the probes pass.

## Residual read grant — REMOVED 2026-11-27

With operator approval, the live `afc-public-reader` read row on
`event_registrations` was removed from staging:

- permission id `8140`, action `read`,
  fields `id,event,registration_status,ticket_code`,
  policy `afc-public-reader` (`d5cd171c-19cc-454b-8045-7d320f69b52d`);
- before: `total=20`; after: `total=19`; public create remains `2` and public
  non-create remains `1` (the `portal-public-feed` read);
- live public registration re-tested after the removal: `200` with a ticket
  code; the probe row was deleted.

The `afc-public-reader` **create** row (permission id `8139`, fields `*`) still
exists so the policy is not left half-migrated; no user currently holds the
`Public Reader` role. If the role is retired, remove that create row in the same
reviewed snapshot as the rest of the 0072 cutover.
