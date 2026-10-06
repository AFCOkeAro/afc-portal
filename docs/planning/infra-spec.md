# Infrastructure Specification — Church Portal

**Issue:** AFC-147 · **Parent:** AFC-146 · **Owner:** CTO (MediaTech)
**Decision:** Self-hosted production (VPS + Docker), managed prototype first · **Version:** v1 (2026-10-05)

---

## 1. Recommendation

**Prototype on managed, run production self-hosted.**

1. **Prototype / Phase 0–1 (fast, low risk):** Directus Cloud (Open Innovation Grant, $99/mo) + Nuxt on Vercel. Gets a working environment in days with managed backups and upgrades.
2. **Production (Phase 2+):** one VPS running Docker Compose — **Directus + PostgreSQL 16 + Caddy** — with the **Nuxt 3 frontend as a separate container on the same VPS**. This is the cheapest total-cost answer at our scale and gives full data ownership.

**Why self-hosted wins on total cost:** under the Directus Open Innovation Grant, an eligible organization (< $5M annual revenue, < 50 employees) has **fully permissive, no-cost self-hosted licensing**. Directus Cloud for a qualifying org is $99/mo ($1,188/yr) for hosting only; the non-qualifying Team tier is $499/mo billed annually. A Hetzner CX33 VPS is ~€6.49/mo (~$7). Self-hosting a single small app is therefore far cheaper, and the operational load is modest (one Compose stack, nightly backups, a monitoring check).

**Why we still start managed:** it removes server setup from the critical path while the schema and frontend stabilise. The Compose stack is built in parallel and cut over when the app is ready.

### Licence note (must confirm)
Directus is source-available under the Monospace Sustainable Core Licence. Organizations under **$5M annual revenue and 50 employees** qualify for the **Open Innovation Grant** (free self-hosted). The church is expected to qualify → **CTO to confirm before production** (open question OQ-5). If it does not, fallback is Directus Cloud Team at ~$499/mo annual.

---

## 2. Deployment topology

```
                    ┌───────────────────────── VPS (Hetzner CX33, 4 vCPU / 8 GB) ─────────────────────────┐
 Internet ──443──▶  │  Caddy (reverse proxy + automatic TLS + HSTS + rate limit)                        │
                    │    ├── portal.<domain>      →  web  (Nuxt 3 SSR, Node 22, :3000)                   │
                    │    ├── api.<domain>         →  directus (:8055)                                    │
                    │    └── (optional) admin.<domain> → directus (:8055)  [IP-restricted]              │
                    │                                                                                    │
                    │  directus ──▶ postgres:16 (volume: pgdata)                                        │
                    │      └── uploads volume (assets)  ──nightly──▶  S3-compatible object storage      │
                    │  db-backup (cron container)  ──nightly──▶  local volume + object storage          │
                    └────────────────────────────────────────────────────────────────────────────────────┘
```

**Does the frontend need its own server?** No. It is a **separate deployment/service**, but it can run as a second container on the same VPS behind Caddy. Splitting it later (Nuxt → Vercel/static/CDN) is a cheap, reversible change because the frontend talks only to the Directus API. Keeping it separate in Compose means it is independently deployable and can be moved without touching the backend.

**Public vs staff surfaces:** the public registration pages and the staff portal are the same Nuxt app with different routes and auth guards. Directus Studio (`admin.<domain>`) is exposed only to super/area admins and should be IP-restricted or behind an access proxy.

---

## 3. Server sizing

| Environment | Spec | Suggested plan | Notes |
| --- | --- | --- | --- |
| Prototype | 2 vCPU / 4 GB / 40 GB | Managed (Directus Cloud) | No server ops |
| Production (launch) | 4 vCPU / 8 GB / 80 GB NVMe | **Hetzner CX33** (~€6.49/mo) | Comfortable for ≤12 branches, ≤5k people |
| Production (growth) | 8 vCPU / 16 GB / 160 GB | Hetzner CX43 (~€11.99/mo) | If traffic/DB grows |
| Database | co-located Postgres 16 container | – | Move to managed Postgres if scale demands |

**Rationale:** the workload is light (small relational DB, low concurrency, mostly reads). 4 vCPU / 8 GB leaves headroom for Postgres, Directus, Nuxt SSR, and Caddy on one host. Enable Hetzner automated backups (+20%) as a second layer.

**Scale triggers to resize or split:** CPU sustained > 70%, RAM > 80%, DB > 40 GB, or > 200k API requests/day. First split = move Postgres to a managed instance; second = move Nuxt to Vercel/CDN.

---

## 4. Docker Compose outline

`services/directus/compose.yml` (names only; no secret values):

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER} -d ${POSTGRES_DB}"]
      interval: 10s
      timeout: 5s
      retries: 5

  directus:
    image: directus/directus:11
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      KEY: ${DIRECTUS_KEY}
      SECRET: ${DIRECTUS_SECRET}
      DB_CLIENT: pg
      DB_HOST: postgres
      DB_PORT: 5432
      DB_DATABASE: ${POSTGRES_DB}
      DB_USER: ${POSTGRES_USER}
      DB_PASSWORD: ${POSTGRES_PASSWORD}
      ADMIN_EMAIL: ${DIRECTUS_ADMIN_EMAIL}
      ADMIN_PASSWORD: ${DIRECTUS_ADMIN_PASSWORD}
      PUBLIC_URL: ${DIRECTUS_PUBLIC_URL}
      STORAGE_LOCATIONS: local
      STORAGE_LOCAL_DRIVER: local
      STORAGE_LOCAL_ROOT: /directus/uploads
      EMAIL_TRANSPORT: smtp
      EMAIL_FROM: ${EMAIL_FROM}
      EMAIL_SMTP_HOST: ${EMAIL_SMTP_HOST}
      EMAIL_SMTP_PORT: ${EMAIL_SMTP_PORT}
      EMAIL_SMTP_USER: ${EMAIL_SMTP_USER}
      EMAIL_SMTP_PASSWORD: ${EMAIL_SMTP_PASSWORD}
      EMAIL_SMTP_SECURE: "true"
      RATE_LIMITER_ENABLED: "true"
    volumes:
      - uploads:/directus/uploads
      - ./extensions:/directus/extensions

  web:
    build: ../../apps/web
    restart: unless-stopped
    depends_on:
      - directus
    environment:
      NUXT_PUBLIC_DIRECTUS_URL: ${DIRECTUS_PUBLIC_URL}
      NUXT_DIRECTUS_SERVER_TOKEN: ${NUXT_DIRECTUS_SERVER_TOKEN}
      NUXT_PUBLIC_SITE_URL: ${SITE_URL}

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on:
      - web
      - directus

  db-backup:
    image: postgres:16-alpine
    restart: unless-stopped
    entrypoint: ["/bin/sh", "/backup/backup.sh"]
    environment:
      PGPASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      S3_ENDPOINT: ${S3_ENDPOINT}
      S3_BUCKET: ${S3_BUCKET}
      S3_ACCESS_KEY: ${S3_ACCESS_KEY}
      S3_SECRET_KEY: ${S3_SECRET_KEY}
    volumes:
      - ./backup:/backup:ro
      - backupdata:/backups

volumes:
  pgdata:
  uploads:
  caddy_data:
  caddy_config:
  backupdata:
```

`Caddyfile` outline:

```
portal.example.org {
    encode gzip zstd
    reverse_proxy web:3000
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
    }
}
api.example.org {
    encode gzip zstd
    rate_limit { zone api { match { path /items/event_registrations* } events 20 } }
    reverse_proxy directus:8055
}
```

---

## 5. Environment variables (names only — never commit values)

`services/directus/.env.example` (committed) and `.env` (git-ignored):

| Variable | Purpose |
| --- | --- |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Database |
| `DIRECTUS_KEY`, `DIRECTUS_SECRET` | Directus token signing/encryption |
| `DIRECTUS_ADMIN_EMAIL`, `DIRECTUS_ADMIN_PASSWORD` | Bootstrap admin |
| `DIRECTUS_PUBLIC_URL` | Backend public URL |
| `SITE_URL` | Frontend public URL |
| `NUXT_PUBLIC_DIRECTUS_URL` | API base for the browser |
| `NUXT_DIRECTUS_SERVER_TOKEN` | Server-side scoped token (SSR) |
| `EMAIL_FROM`, `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`, `EMAIL_SMTP_USER`, `EMAIL_SMTP_PASSWORD` | Transactional email |
| `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` | Backup/media object storage |
| `SENTRY_DSN` | Error tracking (optional) |
| `UPTIME_CHECK_URL` | Monitoring probe target (optional) |

**Secret handling:** values live only in the server `.env` (mode 600) or, better, in GitHub Actions/OIDC-injected secrets at deploy. `.env.example` lists names with empty/placeholder values. Never commit `.env`, never paste secrets into issues or docs.

---

## 6. Backup, media, and retention

| Item | Plan |
| --- | --- |
| Database | Nightly `pg_dump -Fc` (cron container) + Postgres WAL archiving if available |
| Media | Nightly sync of the `uploads` volume to S3-compatible object storage (`rclone`/`aws s3 sync`) |
| Off-site | Backups pushed to object storage (Hetzner Storage Box/OBJ or Backblaze B2) |
| Retention | 30 daily, 12 weekly, 12 monthly |
| Restore test | Quarterly drill into a scratch container; documented runbook |
| Targets | **RPO ≤ 24h**, **RTO ≤ 4h** |
| Protection | Versioning/immutability on the backup bucket; separate credentials from app tokens |

---

## 7. Monitoring and observability

| Layer | Tool | What it watches |
| --- | --- | --- |
| Uptime | UptimeRobot / Better Stack (free/cheap) | `portal` + `api` health endpoints, TLS expiry |
| Errors | Sentry (frontend + Directus extension optional) | JS and server errors, release tagging |
| Host | `node_exporter` + Grafana Cloud free / Netdata | CPU, RAM, disk, container health |
| Logs | Docker logs → `loki`/journald or a hosted log drain | Caddy access logs, Directus errors |
| Backups | Backup script exit status → alert | Failure to produce a nightly backup |
| Business | Directus dashboard + `/server/health` | DB reachability, counts |

**SLOs (initial):** availability 99.5% monthly; API p95 < 500 ms; registration success > 99%. Alerts: page on `api` down > 5 min or disk > 85%.

---

## 8. Estimated monthly cost

### Option B — self-hosted production (recommended)

| Item | Cost / month |
| --- | --- |
| Hetzner CX33 (4 vCPU / 8 GB / 80 GB) | €6.49 (~$7.00) |
| Hetzner automated backups (+20%) | €1.30 (~$1.40) |
| IPv4 (if required) | ~€0.50 (~$0.55) |
| Object storage for backups/media (~50 GB) | ~€2.50–6.50 (~$3–7) |
| Domain `.org` amortised | ~$1.00 |
| Transactional email (Resend free / Postmark) | $0–15 |
| Sentry / uptime (free tiers) | $0 |
| **Total** | **~$14–32 / month** |

### Option A — managed prototype

| Item | Cost / month |
| --- | --- |
| Directus Cloud (Open Innovation Grant, hosting) | $99 |
| Vercel (Hobby) | $0 |
| Email (Resend free tier) | $0 |
| **Total** | **~$99 / month** |

**Recommendation:** prototype on Option A only as long as it accelerates delivery (weeks, not months); move to Option B for production. At $99/mo, Option A costs ~$1,100/yr more than Option B — worth it short-term for zero server ops, not worth it at steady state.

*Prices are list rates captured 2026-10-05 (Hetzner CX33 €6.49/mo net; Directus Cloud OIG $99/mo; Team $499/mo annual). Verify at purchase; providers adjust pricing.*

---

## 9. Security posture

- TLS 1.2+ everywhere via Caddy automatic certificates; HSTS.
- Studio admin surface limited to super/area admins and IP-restricted or behind a proxy.
- Least-privilege Directus roles; public role is create-only on registrations.
- Rate limiting on public registration endpoints; bot mitigation (Caddy/Turnstile) if abuse appears.
- OS patching via unattended-upgrades; Docker images pinned to major tags and updated on a schedule.
- Secrets only in env/secret store; separate credentials for backups.
- No production code or secrets in this planning phase.

---

## 10. Rollback and release

- Every deploy keeps the previous container image tag; rollback = redeploy previous tag.
- DB migrations (Directus schema changes) are applied via snapshot/migration and are reversible or forward-fixed; take a pre-deploy backup.
- Public feature changes ship behind a config flag where practical (e.g. registration open/closed, waitlist).
