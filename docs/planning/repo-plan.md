# GitHub Repository Plan — Church Portal

**Issue:** AFC-147 · **Parent:** AFC-146 · **Owner:** CTO (MediaTech) · **Version:** v1 (2026-10-05)

---

## 1. Repository

- **Name:** `afc-church-portal` (GitHub org: the AFC/church org TBD — open question OQ-6).
- **Visibility:** private during development; may stay private (contains internal schema and infrastructure).
- **Default branch:** `main` (protected).
- **Licence:** code we write is proprietary/internal unless the board chooses otherwise. Third-party licences respected (see §7).

---

## 2. Monorepo structure

```
afc-church-portal/
├─ apps/
│  └─ web/                     # Nuxt 3 portal (SSR)
│     ├─ pages/                # routes: login, dashboard, people, events, attendance, visitors, welfare, register
│     ├─ components/           # shared UI (use Nuxt UI)
│     ├─ composables/          # useApi (Directus client), useAuth, usePermissions
│     ├─ server/               # SSR server routes / public registration proxy
│     ├─ layouts/
│     ├─ middleware/           # auth + role guards
│     └─ Dockerfile
├─ services/
│  └─ directus/
│     ├─ compose.yml           # local + production stack
│     ├─ Caddyfile
│     ├─ .env.example          # variable names only
│     ├─ schema/
│     │  ├─ snapshot.yaml      # committed schema snapshot (source of truth)
│     │  └─ migrations/        # ordered SQL/JS migrations
│     ├─ extensions/           # Flow hooks / custom endpoints (ticket code, branch_ids sync)
│     └─ backup/backup.sh
├─ packages/
│  └─ shared/                  # shared types/schemas (zod) for forms + API contracts
├─ docs/
│  ├─ prd.md                   # mirrored from issue document
│  ├─ data-model.md
│  ├─ permission-matrix.md     # portable spec (see data model §13)
│  ├─ infra.md
│  ├─ runbook.md               # restore, deploy, incident
│  └─ adr/                     # architecture decision records
├─ .github/
│  └─ workflows/
│     ├─ ci.yml                # lint, typecheck, build, permission tests, schema drift
│     ├─ deploy-staging.yml
│     └─ deploy-prod.yml
├─ .gitignore
├─ .editorconfig
├─ package.json                # pnpm workspace root
├─ pnpm-workspace.yaml
└─ README.md
```

**Why a monorepo:** one PR can change the schema, the frontend, and the docs together; CI can validate cross-cutting concerns (schema drift + permission tests) in one place. Directus extensions and the Nuxt app share types from `packages/shared`.

---

## 3. Branch strategy

- **Trunk-based** on `main`; `main` is always deployable to staging.
- Short-lived branches: `feat/<slug>`, `fix/<slug>`, `chore/<slug>`, `schema/<slug>`.
- **PR required** to merge; at least one approval. Critical paths (auth, permissions, data migrations) require a second reviewer (CTO or SecurityEngineer).
- Merge method: **squash** (linear history).
- `release-*` tags for production cuts (e.g. `v0.3.0`).
- Optional `staging` branch is unnecessary; staging deploys from `main` on merge.
- **Staging-first standard** (board ruling 2026-10-21): branch PR, merge to `main`, rebuild staging, QA verify on staging. Until `deploy-staging.yml` automation lands, the operator rebuilds staging after every PR merge; QA verification on staging gates the next production cut, never the other way round.
- **Push immediately:** land small complete PRs as soon as CI is green — never hold finished commits for a batch. One issue, one PR, promptly.

---

## 4. CI (GitHub Actions)

`ci.yml` on every PR and push to `main`:

1. **Lint + format** — ESLint + Prettier (frontend, extensions).
2. **Typecheck** — `nuxt typecheck` / `tsc --noEmit`.
3. **Build** — `pnpm --filter web build`.
4. **Unit tests** — composables, shared schemas (zod), Flow logic.
5. **Permission tests** — spin up an ephemeral Directus + Postgres (Docker service), apply migrations, seed fixtures, and assert the permission matrix (positive + negative cases from `data-model` §10/§12).
6. **Schema drift** — run `directus schema snapshot` against the ephemeral instance and diff against `services/directus/schema/snapshot.yaml`; fail if drift.
7. **Accessibility (optional)** — axe on key public pages.

`deploy-staging.yml` on `main`: build + push image, deploy to staging, run smoke test.
`deploy-prod.yml`: manual `workflow_dispatch` with environment approval; takes a pre-deploy DB backup, applies migrations, deploys previous-tag rollback on failure.

---

## 5. Schema as code

- `services/directus/schema/snapshot.yaml` is generated with `npx directus schema snapshot ./schema/snapshot.yaml` and **committed**. It is the reviewable source of truth for collections, fields, relations, and permissions.
- Changes are made in a development Directus, snapshotted, and committed in the same PR as the migration.
- CI diffs a fresh snapshot against the committed one to catch untracked Studio edits.
- Migrations in `schema/migrations/` apply deterministic changes (indexes, constraints, seed reference data such as branches/departments) on deploy.
- Production schema changes require a pre-deploy backup and are reviewed on critical paths.

---

## 6. Secrets handling

- **Never commit** `.env`, tokens, keys, or connection strings. `.gitignore` covers `.env*` except `.env.example`.
- `.env.example` lists variable **names** with placeholder values only (see `infra-spec` §5).
- CI/CD secrets live in **GitHub Actions Environments** (`staging`, `production`) with required reviewers on production.
- Prefer short-lived/deploy-scoped credentials. Rotation intervals, triggers, the procedure and the access review live in **[`docs/security/credential-inventory.md`](../security/credential-inventory.md)** — that artefact is the record; this plan points at it and does not duplicate it. `DIRECTUS_KEY`/`DIRECTUS_SECRET`: **180 days**, and immediately on any §2.2 trigger (suspected exposure, unexpected use, restore/clone, provisioning-path trust change). Owner: CTO. Reviewer: SecurityEngineer.
- **`retention_job`** — the login that can execute live record erasure, not yet provisioned: **90 days**, and immediately on any §2.2 trigger, same owner and reviewer, same inventory row. It is inventoried precisely because it looks like a variable and behaves like a credential.
- Any credential that must be stored in Paperclip is proposed as a secret via the secret-proposal flow — never pasted into issues, comments, or files.
- Client-side code uses only `NUXT_PUBLIC_*` values (no secrets); server-side SSR uses a scoped token.

---

## 7. Licence notes

| Component | Licence | Obligation |
| --- | --- | --- |
| Directus | Monospace Sustainable Core Licence (source-available) | Free self-hosted under the Open Innovation Grant for orgs < $5M revenue & < 50 employees; confirm eligibility (OQ-5). Track vendor licence changes. |
| Nuxt 3 / Vue | MIT | Attribution in `README` if redistributed |
| Nuxt UI | MIT | OK |
| PostgreSQL | PostgreSQL Licence (BSD-like) | OK |
| Caddy | Apache-2.0 | OK |
| AgencyOS reference | MIT | If we copy patterns/code, retain the MIT attribution and do **not** import its Stripe/branding (per AFC-146 plan). Reimplement, don't vendor. |

We start from AgencyOS as an **architectural reference** (Nuxt + Directus client-portal pattern), not as a fork. Any copied file keeps its original licence header and attribution in `docs/ATTRIBUTIONS.md`.

---

## 8. Developer experience

- `pnpm install` at root; `pnpm dev:stack` runs `docker compose up` for Directus + Postgres.
- `pnpm --filter web dev` runs the frontend against the local Directus.
- Seed script (`services/directus/schema/migrations/seed.*`) creates demo branches, people, events, and role users so a new dev can exercise the whole flow.
- `docs/runbook.md` covers local setup, deploy, restore, and common incidents.
- Conventional commits; PR template with a testing checklist and lens-based review prompts.

---

## 9. Repository setup checklist (execution deferred)

- [ ] Create GitHub repo `afc-church-portal` (private).
- [ ] Enable branch protection on `main` (require PR + 1 approval + status checks).
- [ ] Create `staging` and `production` Actions environments; add secrets there.
- [ ] Add `CODEOWNERS` (CTO on `services/directus/schema/**` and `.github/**`).
- [ ] Add PR + issue templates.
- [ ] Protect `main` from force-push and deletion.

*No repository is created in this planning phase; this is the plan for Phase 1.*
