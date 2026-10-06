# afc-church-portal

Monorepo for the Apostolic Faith Church (Lagos North Area) church portal:
a Nuxt 3 SSR frontend over a self-hosted Directus API and PostgreSQL 16.

**Status: the shell exists, the data does not.** The application source, the
build and the CI checks are real. The Directus project is not deployed, so
nothing behind `/api` has ever read or written a record. Read
[What is real and what is stubbed](#what-is-real-and-what-is-stubbed) before
trusting any part of this repository to do anything.

The repository plan is [`docs/planning/repo-plan.md`](docs/planning/repo-plan.md)
(AFC-147). The permission model is
[`docs/planning/data-model.md`](docs/planning/data-model.md) — §10 for the
matrix, §13 for the rules about how the client is allowed to use it.

---

## Layout

```
afc-church-portal/
├─ apps/
│  └─ web/                     # Nuxt 3 portal (SSR)
│     ├─ pages/                # login, dashboard, people, events, attendance,
│     │                        # visitors, welfare, register
│     ├─ components/           # PageHeader, StatCard, EmptyState,
│     │                        # PermissionGate, CapabilitySummary
│     ├─ composables/          # useApi, useAuth, usePermissions
│     ├─ utils/navigation.ts   # nav declared as data, filtered by capability
│     ├─ server/               # api/auth/*, api/me/permissions, api/register,
│     │                        # api/health, utils/{directus,session,stub}
│     ├─ layouts/              # default (staff), auth (sign-in), public
│     ├─ middleware/           # auth.global, staff, welfare
│     └─ Dockerfile
├─ packages/
│  └─ shared/                  # @afc/shared — types + zod schemas, no build step
├─ services/
│  └─ directus/
│     ├─ .env.example          # variable NAMES only, every value empty
│     ├─ schema/               # migrations, rollback, engine
│     └─ monitoring/
├─ tests/db/                   # database control tests (pglite)
├─ scripts/                    # the compliance gates
├─ docs/                       # PRD, data model, ADRs, wireframes
├─ .github/workflows/ci.yml
├─ .editorconfig
└─ package.json                # pnpm workspace root
```

---

## Requirements

- Node >= 20
- pnpm (the version resolved by `packageManager`, or any pnpm 10)

No database is needed to build, lint or typecheck the frontend.

---

## Commands

| Command | What it does |
| --- | --- |
| `pnpm install` | Resolve the workspace. CI uses `--frozen-lockfile`. |
| `pnpm dev:web` | Run the portal on <http://localhost:3000>. |
| `pnpm build` | `pnpm --filter web build` — produces `apps/web/.output`. |
| `pnpm typecheck` | `packages/shared` on its own tsconfig, then the Nuxt app. |
| `pnpm lint` / `pnpm lint:fix` | ESLint over `apps/web`. |
| `pnpm format` / `pnpm format:check` | Prettier over `apps`, `packages`, `package.json`, `.github`. |
| `pnpm test:db` | Database control tests. **Not** a substitute for the retention gate. |

`format` and `format:check` are deliberately scoped to the paths above.
`pnpm-workspace.yaml`, `docs/`, `scripts/`, `services/` and `tests/` belong to
other workstreams and are not reformatted by this repo's formatter.

### The compliance gates

```
pnpm gate:self-test      # every gate proves it can still fail
pnpm gate:awareness      # awareness_at is never named in application source
pnpm gate:retention      # no retention period is a literal outside the config layer
pnpm gate:migration-privilege
pnpm test:db
```

`apps/` and `packages/` are inside the awareness and retention gates' scan
paths. Adding application source adds it to two compliance controls: nothing in
this tree may name the NDPA s.40(2) breach clock column, and no retention period
may appear as a literal. Both gates are the enforcement path for the retention
work — see the note at the end of this file before you touch them.

---

## What is real and what is stubbed

**Real, and exercised:**

- `packages/shared` — types transcribed from data-model §1–§7 and §10, zod
  schemas for every form in scope, and the role→capability translation. Its
  typecheck runs in CI.
- The auth guard. An unauthenticated request for any staff page is answered
  `302 → /login?redirect=<path>` on the server, before any HTML is rendered.
- The session. A sealed httpOnly cookie (`NUXT_SESSION_SECRET`), never a token
  in `localStorage`.
- `GET /api/me/permissions` — the capabilities endpoint data-model §13 rule 7
  asks for, and the guard/navigation that consume it. Verified against the §10
  matrix: a volunteer gets 14 grants and a 403 on `/welfare`; an area admin gets
  58 and reads every collection; a department leader reads welfare at
  assigned scope.
- `POST /api/register` — validation, the public field allowlist, the
  public-visibility filter, capacity/waitlist and the guardian-consent rule.
- `apps/web/Dockerfile` — multi-stage, non-root, no toolchain in the runtime
  layer.

**Stubbed, and labelled as such in the code:**

- **Authentication against Directus.** `/api/auth/login` is written to exchange
  credentials for a token and read the portal's custom user fields. It has never
  returned a token, because no Directus project exists. Until then it answers
  503 with a message that says so.
- **Seeded stub identities** (`apps/web/server/utils/stub-identities.ts`), used
  only when `NUXT_STUB_AUTH=true`. They compare a published string and hand out a
  session to anyone who asks. The route refuses to serve them when
  `NODE_ENV=production`, which — because the production bundle sets that itself
  — means the stub is unreachable from a built artefact and is a `pnpm dev:web`
  tool only. **Delete the file and the `stubAuth` branch together when Directus
  is deployed.**
- **The capability grants.** They come from a transcription of the §10 table, not
  from the Directus policies that are supposed to implement it. Nothing has
  checked the two against each other; that is CI step 5 in repo-plan §4 and it
  does not exist yet.
- **Every read route.** There is no `GET /api/people`. The five staff pages
  render their guard, their capability check and their restricted-field notice,
  and then say plainly that no query is being made.

**Two gaps worth naming:**

1. **`NUXT_DIRECTUS_PUBLIC_TOKEN` is not in infra-spec §5.** The registration
   proxy needs a token whose Directus policy is the *public* role's, not the
   application's. Using the SSR token on an anonymous write would make the field
   allowlist the only control between the internet and every column on
   `event_registrations`. The variable was added and needs CTO ratification.
2. **The public registration route has no rate limit.** data-model §9 and PRD
   §7.6 both call for one. A per-process limiter would be a false control behind
   more than one worker or behind the reverse proxy, so it was not written. It
   needs a shared store and a decision about the deploy topology.

---

## Permissions, honestly

Three layers, and only the third one is a control:

1. **`packages/shared/src/role-matrix.ts`** — a transcription of data-model §10.
   Feeds navigation and field visibility.
2. **`usePermissions` / `PermissionGate` / the middleware** — reads the
   capabilities the server sent. Defence in depth.
3. **The Directus policy** — the only authoritative control, per data-model §9.
   It does not exist yet.

Two roles named in §10.1 — "designated safeguarding lead" and "camp coordinator"
— are not in `staff_role`. Neither is modelled, so neither is granted the
restricted fields it would have had. That errs towards hiding data, which is the
right direction for a child's record. §10.1 also restricts welfare case details
to "the assigned owner", a record-level grant only the Directus policy can
evaluate; the UI hides those fields for every role outside the allowlist.

One cell in §10 is contradictory and was encoded as written rather than resolved:
the volunteer holds `U (check-in fields only, own)` on `event_registrations`,
while PRD US-8 has a volunteer finding a registrant "by name or ticket code",
which needs a read. The UI therefore offers no visitor a registration list.
See the AFC-174 update on the parent programme issue.

---

## Secrets

`services/directus/.env.example` lists variable **names** with empty values.
Values live in the server `.env` (mode 600) or are injected at deploy. Never
commit a value, and never paste one into an issue, a comment, a document or a
commit message — propose it through the Paperclip secret flow.

---

## Two rules for anyone working in this tree

1. **More than one agent works in this working directory at a time.** Run
   `git status` before every commit and read every path in the diff. Leave a file
   you did not write exactly where it is.
2. **Stage explicit paths.** Never `git add -A`, `git add .` or `git commit -a`.

And a third, specific to this repository:

**Do not weaken `scripts/retention-literal-gate.sh` or
`scripts/run-db-tests.mjs` to make a run green.** They are the enforcement path
for the retention gate under NDPA s.40(2). A red gate you can act on is worth
more than a green gate you bought. If one of them is catching a problem in code
you wrote, that is the gate working.

---

## Not here yet

No GitHub repository, remote or push — the code is committed locally. No compose
stack, Caddyfile or deploy workflow. No `snapshot.yaml` yet, so the schema-drift
step in repo-plan §4 has nothing to diff against.