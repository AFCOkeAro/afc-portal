# Staging deploy runbook — VPS, web only (AFC-385)

Parent: AFC-383 (board chose VPS for the staging preview). Sibling AFC-384
owns build verification — this runbook reuses it and does not repeat it.

Scope: staging-only. Nuxt SSR (`web`) behind Caddy on a fresh VPS. **No
postgres, no Directus yet.** Production compose
(`services/directus/compose.yml`) is untouched.

## 0. What you need

- A fresh VPS with Docker + the Compose plugin and ports 80/443 reachable.
- This repo (or at least `services/staging/` + `apps/web/` for a local build).
- A staging domain pointing at the VPS (DNS A record). The Caddyfile ships
  with the placeholder `staging.example.org` — replace it first.
- One generated session secret (host only, never committed):
  `openssl rand -base64 48`.

## 1. Configure

1. Copy the env template on the host and lock it down:
   `cp services/staging/.env.example services/staging/.env && chmod 600 services/staging/.env`
2. Edit `services/staging/.env` (values live **only** here):
   | Variable | Staging value |
   | --- | --- |
   | `WEB_IMAGE` | Image tag from CI (AFC-384), or empty for a local `build` |
   | `NUXT_STUB_AUTH` | `false` — staging serves the real auth path |
   | `NUXT_SESSION_SECRET` | **required** — output of `openssl rand -base64 48` |
   | `NUXT_DIRECTUS_URL`, `NUXT_PUBLIC_DIRECTUS_URL`, `NUXT_DIRECTUS_SERVER_TOKEN`, `NUXT_DIRECTUS_PUBLIC_TOKEN` | empty — Directus is not deployed; the app is degraded-safe (health 200 with `directusConfigured:false`; login/register answer 503) |
3. In `services/staging/Caddyfile`, replace `staging.example.org` with the
   board-provided staging domain.
4. `NITRO_HOST 0.0.0.0` / `NITRO_PORT 3000` are fixed in `compose.yml`
   (matching `apps/web/Dockerfile`); there is nothing to set.

## 2. Start

From the repo root on the VPS:

```sh
docker compose -f services/staging/compose.yml --env-file services/staging/.env up -d --build
docker compose -f services/staging/compose.yml ps
```

## 3. Verify (acceptance: 200 on `/api/health`)

```sh
curl -fsS http://localhost:3000/api/health
curl -fsS https://<staging-domain>/api/health
```

Both answer `200` with `{"status":"ok",...}`. Expect
`"directusConfigured":false` until the backend cutover — that is the healthy
staging state, not a failure. Caddy serves gzip with `Strict-Transport-Security`
(HSTS), `X-Content-Type-Options: nosniff` and `X-Frame-Options: DENY`
(see the `Caddyfile`).

## 4. Staging access control — options only, not implemented

Pick one before sharing the URL; none is wired in this bundle:

- Caddy `basic_auth` on the staging site block (cheapest, one shared login).
- IP allowlist / firewall rule for the reviewers' addresses.
- Tailscale/ZeroTier on the VPS so staging never binds publicly.

Do not invent per-user staging accounts in the app for this.

## 5. Rollback

Rollback = redeploy the previous tag. Set `WEB_IMAGE` in the host `.env` to
the last good tag and re-run the start command. There is no database in this
bundle, so there is nothing to migrate back. Keep the previous image tag
until the new one passes §3.

## 6. Constraints (do not negotiate on the host)

- No production data and no youth data on staging. Ever.
- No secrets in the repo, in comments, or in pasted logs. Values live in the
  host `.env` (mode 600) or the deploy pipeline.
- `NUXT_STUB_AUTH` stays `false`. The stub is a local-dev tool and the
  production build refuses to serve it regardless.
