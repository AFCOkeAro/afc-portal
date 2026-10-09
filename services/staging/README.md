# Staging deploy runbook — VPS, web only (AFC-386)

Parent: AFC-383 (board chose new VPS, domain afc-staging.bluespace.ng).
Sibling AFC-384 owns build verification — this runbook reuses it and does not
repeat it.

Scope: staging-only. Nuxt SSR (`web`) behind Caddy on a fresh VPS. **No
postgres, no Directus yet.** Production compose
(`services/directus/compose.yml`) is untouched.

Staging domain: `afc-staging.bluespace.ng`. To change it again, replace that
address in `services/staging/Caddyfile` (one site block, nothing else).

## 0. What you need

- A fresh VPS (see §0.1 for sizing) with Docker + the Compose plugin and
  ports 80/443 reachable.
- This repo (or at least `services/staging/` + `apps/web/` for a local build).
- DNS for `afc-staging.bluespace.ng` pointing at the VPS (see §0.1c).
- One generated session secret (host only, never committed):
  `openssl rand -base64 48`.
- SSH access to the VPS. Access details come from the board via the CTO —
  never ask for credentials in issue comments.

## 0.1 New-VPS operator section — from zero to 200

Follow these steps in order on a brand-new VPS. Nothing here needs production
data or youth data; staging never holds either.

### a. Size the server

Per `docs/planning/infra-spec.md` §3: staging is web-only (Nuxt SSR + Caddy,
no Postgres, no Directus), so it needs less than production launch
(4 vCPU / 8 GB / 80 GB NVMe). Provision **minimum 1 vCPU / 2 GB RAM /
25 GB disk**; **recommended 2 vCPU / 4 GB / 40 GB** (the infra-spec Prototype
row) for headroom. Ubuntu 24.04 LTS. Open ports 80 and 443 to the internet;
restrict SSH (port 22) to the operator's address.

### b. Install Docker plus the Compose plugin

On the fresh VPS (Ubuntu 24.04 LTS):

```sh
sudo apt-get update && sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update && sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
sudo systemctl enable --now docker
docker compose version
```

The last command must print a Compose v2 version. If it does not, stop —
do not continue to first boot without a working `docker compose`.

### c. Point the domain at the VPS (Cloudflare DNS)

In the Cloudflare dashboard for `bluespace.ng`, add both records (create the
AAAA only if the VPS has an IPv6 address), replacing `<VPS-IP>` with the
VPS addresses and keeping the proxy on:

| Type | Name | Content | Proxy status |
| --- | --- | --- | --- |
| A | `afc-staging` | `<VPS-IPv4>` | Proxied (orange cloud on) |
| AAAA | `afc-staging` | `<VPS-IPv6>` | Proxied (orange cloud on) |

Wait for propagation, then confirm from any machine:

```sh
dig +short afc-staging.bluespace.ng
```

It must answer the VPS IP(s). Caddy obtains the TLS certificate
automatically on first boot; no manual certificate step exists.

### d. First boot

From the repo root on the VPS (configure first per §1, then boot):

```sh
docker compose -f services/staging/compose.yml --env-file services/staging/.env up -d --build
docker compose -f services/staging/compose.yml ps
```

### e. Health check (acceptance)

```sh
GET https://afc-staging.bluespace.ng/api/health
```

must answer **200** with `"directusConfigured":false, e.g.:

```sh
curl -fsS https://afc-staging.bluespace.ng/api/health
```

Expected body shape: `{"status":"ok",...,"directusConfigured":false}`. That
`false` is the healthy staging state until the backend cutover, not a
failure. If the check fails, see §2–§3 of the Configure/Start/Verify
sections below, then §5 (Rollback): rollback equals redeploying the previous
`WEB_IMAGE` tag (set `WEB_IMAGE` in the host `.env` to the last good tag
and re-run the start command).

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
3. `services/staging/Caddyfile` already targets `afc-staging.bluespace.ng`.
    Only edit it if the board changes the domain again.
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
curl -fsS https://afc-staging.bluespace.ng/api/health
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
