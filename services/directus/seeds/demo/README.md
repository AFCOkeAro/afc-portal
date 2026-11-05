# Demo seed + clear (AFC-1086)

Linked, recognizable demo data for every in-scope module, plus a safe
clear-all. Parent: AFC-1084. Ancestor: AFC-1083.

## Where the seed lives

| Path                                                           | What                                                                                                                                                                    |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `001_demo_seed.sql`                                            | Idempotent plant. `INSERT ... ON CONFLICT DO NOTHING` on stable keys, registry rows written only from `RETURNING`.                                                      |
| `002_demo_clear.sql`                                           | Child-to-parent deletes through `demo_seed_registry` with a `DEMO-` prefix fallback on natural-key tables. Refuses sealed tables. Safe on empty; second run is a no-op. |
| `../../schema/migrations/20261105_0068_demo_seed_registry.sql` | Creates `demo_seed_registry` + `demo_admin_actions` (migrator-owned; `directus_app` gets SELECT+INSERT only). Apply before seeding.                                     |

## How to run (staging only, never production)

The scripts run as `directus_migrator` with `SET ROLE`. Never as
`directus_app` (it cannot write several of these columns and holds no
`DELETE` anywhere). The connecting identity must hold the migrator role --
on staging that is the database owner.

```bash
# 1. Migrate (registry tables). Run from the repo root, in filename order
#    with the rest of services/directus/schema/migrations/.
psql "$STAGING_PG_URL" -v ON_ERROR_STOP=1 \
  -f services/directus/schema/migrations/20261105_0068_demo_seed_registry.sql

# 2. Seed (repeatable: re-running plants zero duplicates).
psql "$STAGING_PG_URL" -v ON_ERROR_STOP=1 \
  -c "SET ROLE directus_migrator;" \
  -f services/directus/seeds/demo/001_demo_seed.sql

# 3. Clear (removes only planted rows; NOTICE prints per-table counts).
psql "$STAGING_PG_URL" -v ON_ERROR_STOP=1 \
  -c "SET ROLE directus_migrator;" \
  -f services/directus/seeds/demo/002_demo_clear.sql
```

Prefer the admin UI (`/admin/demo`, super-admin only) or the admin API
(`POST /api/admin/demo/seed`, `POST /api/admin/demo/clear`) on staging:
they run the same scripts through the staging `demoDatabaseUrl`
connection and write a `demo_admin_actions` audit row with the actor and
row counts. The clear API requires the exact confirmation phrase
`DELETE DEMO DATA`.

## Safety guarantees

- **Registry-driven deletes.** Every data `DELETE` names `row_id`s from
  `demo_seed_registry` for its own table. A row the seed never planted
  cannot match, so production data is unreachable even on shared tables.
- **No name matching.** People, households and visitors are recognizable
  (Adeyemi, Okafor, Eze) but carry no `DEMO-` name marker, and the clear
  script deliberately offers **no fallback** for those tables: a name
  match could hit a real namesake. Those tables clear registry-only.
- **`DEMO-` fallback where a natural key exists.** Departments (`code`),
  events (`slug`), registrations (`ticket_code`), invites
  (`invitee_contact_hash`), sessions (`idempotency_key`), campaigns
  (`key`), enrollments (`idempotency_key`), welfare cases (`case_ref`),
  prior-year items (`natural_key`) and imports (`filename`) sweep
  `LIKE 'DEMO-%'` after the registry pass, catching a planted row whose
  registry entry is missing.
- **Sealed registers excluded.** The seed never writes `incidents`,
  `legal_holds`, `retention_runs`, `retention_run_items`,
  `retention_clocks`, `retention_policies`, `member_otp_codes` or
  `member_sessions`, and the clear script raises before deleting anything
  if the registry ever names one of them.
- **Welfare append-only respected.** The seed `INSERT`s
  `welfare_case_events` rows and updates none.
- **No OTP rows.** `member_otp_codes` / `member_sessions` are never seeded.
- **Audit survives clearing.** `demo_admin_actions` is append-only
  (`directus_app`: SELECT+INSERT, no UPDATE/DELETE) and is never cleared.
  Direct `psql` runs have no actor, so the scripts write no audit rows;
  use the API when an actor stamp matters.

## What is linked to what

Same people across 6+ modules: Emmanuel Adeyemi preaches the
2026-08-30 service, leads the DEMO Choir, invites Femi, records the
salvations, opens the welfare case and submits the finance record. Sarah
ushers, owns follow-ups and contributes to the case. Tunde is the youth
profile, the birthday celebration, the Youth Celebration Night
registrant, a blessing recipient and the UNILAG campus row. Chidi is the
welfare case subject and a Group 1 member; Ngozi registers for the
Revival and receives a blessing. Grace converts from visitor to person
and attends the Revival. Emeka leads the youth fellowship and invites to
the youth night. Anchor events: Youth Celebration Night, Lagos North
Revival. Anchor geography: Oke-Aro (zone LAG-NORTH-Z1, area LAG-NORTH) --
reused, never forked.
