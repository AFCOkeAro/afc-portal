# Minimum PVE guest for staging — ready-to-run bundle (AFC-443)

Parent: AFC-383 (viewable staging preview at `https://afc-staging.bluespace.ng`).
Scope: staging-only. Nuxt SSR (`web`) behind Caddy. **No Postgres, no Directus
yet.** This file provisions the guest only; it does not change the app.
Production compose (`services/directus/compose.yml`) is untouched.

How to use this file: whoever gets PVE access runs §1, then §2, then §3 in
order. Nothing here needs production data or youth data; staging never holds
either. No secrets appear in this file — values live on the host only.

## 0. Minimum guest spec

- OS: Ubuntu 24.04 LTS (cloud image, e.g. `noble-server-cloudimg-amd64.img`).
- Shape: **minimum 1 vCPU / 2 GB RAM / 25 GB disk**; **recommended 2 vCPU /
  4 GB / 40 GB** if free (staging is web-only, so this is headroom, not a
  requirement).
- Network: 1 vNIC with public IPv4.
- Firewall: 80/443 open to the internet; 22 restricted to the operator's
  address only.
- What you need from the PVE host before you start: `<VMID>`, `<NODE>`,
  `<STORAGE>`, `<BRIDGE>`, `<IP/CIDR>`, `<GW>`. These are placeholders —
  substitute the real values on the PVE shell. Never commit real values.

## 1. Create the guest (qm template)

Run on the PVE host (`<NODE>` shell). Replace every `<...>` placeholder;
do not paste real IPs or keys into issues or commits.

```sh
# 1. Create the VM shell (minimum shape; use --cores 2 --memory 4096 for
#    the recommended shape).
qm create <VMID> \
  --name afc-staging \
  --node <NODE> \
  --memory 2048 \
  --cores 1 \
  --net0 virtio,bridge=<BRIDGE>,firewall=1 \
  --scsihw virtio-scsi-pci

# 2. Attach the Ubuntu 24.04 cloud image (download once per host).
#    Do this only if the image is not already on <STORAGE>.
wget -O /tmp/noble-server-cloudimg-amd64.img \
  https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img
qm importdisk <VMID> /tmp/noble-server-cloudimg-amd64.img <STORAGE>

# 3. Attach the imported disk and grow it to 25 GB minimum.
qm set <VMID> --scsi0 <STORAGE>:vm-<VMID>-disk-0
qm resize <VMID> scsi0 25G

# 4. Attach a cloud-init drive (user-data comes from §2).
qm set <VMID> --ide2 <STORAGE>:cloudinit

# 5. Boot order, serial console, and guest agent.
qm set <VMID> --boot c --bootdisk scsi0
qm set <VMID> --serial0 socket --vga serial0
qm set <VMID> --agent enabled=1

# 6. Static IPv4 via cloud-init (DHCP also works; static is shown because
#    the runbook's DNS step needs a stable address).
qm set <VMID> --ipconfig0 ip=<IP/CIDR>,gw=<GW>
qm set <VMID> --nameserver 1.1.1.1

# 7. Clone alternative: if you keep a golden Ubuntu 24.04 cloud template,
#    replace steps 1-4 above with:
#    qm clone <TEMPLATE-VMID> <VMID> --name afc-staging --full
#    qm resize <VMID> scsi0 25G
#    (then continue from step 5 above.)
```

Firewall (on the PVE host or datacenter firewall for this guest):

```sh
# Allow web, restrict SSH to the operator's address only.
pvesh create /cluster/firewall/rules --type in --action ACCEPT \
  --macro HTTP --comment "afc-staging web"
pvesh create /cluster/firewall/rules --type in --action ACCEPT \
  --macro HTTPS --comment "afc-staging web TLS"
# Replace <OPERATOR-CIDR> on the host; never commit it.
# pvesh create /cluster/firewall/rules --type in --action ACCEPT \
#   --proto tcp --dport 22 --source <OPERATOR-CIDR> --comment "afc-staging ssh"
```

Then start the guest:

```sh
qm start <VMID>
qm status <VMID>
```

## 2. cloud-init user-data snippet

Attach as the guest's user-data (PVE cloud-init drive, or pasted into the
PVE UI under Cloud-Init → User). Placeholders only — the operator adds the
real SSH public key on the host.

```yaml
#cloud-config
hostname: afc-staging
manage_etc_hosts: true

# Operator account. Replace <SSH-PUBKEY> on the host with the real
# ed25519/rsa public key. Never commit the real key.
users:
  - name: afcops
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys:
      - <SSH-PUBKEY>

packages:
  - ca-certificates
  - curl
  - gnupg
  - docker.io
  - docker-compose-plugin

runcmd:
  - systemctl enable --now docker
  - docker compose version
```

The last `runcmd` line must print a Compose v2 version on first boot. If it
does not, stop — do not continue to §3 without a working `docker compose`.
(§3 step b installs Docker from the upstream repo instead if the distro
`docker.io` build is too old; either path is fine as long as
`docker compose version` passes.)

## 3. First boot — from zero to 200

This reuses `services/staging/README.md` §0.1b–d verbatim in condensed
form. Full detail, including the Cloudflare DNS table, lives in the README;
nothing here contradicts it.

### a. Confirm Docker + Compose (§0.1b)

```sh
docker compose version
```

Must print a Compose v2 version. If not, run the README §0.1b Docker-repo
install, then re-check.

### b. Configure (§1 of the README, host only)

```sh
cp services/staging/.env.example services/staging/.env
chmod 600 services/staging/.env
```

Edit `services/staging/.env` on the host (values live **only** here, mode
600). See §4 below for the degraded-safe values.

### c. First boot (§0.1d)

From the repo root on the guest:

```sh
docker compose -f services/staging/compose.yml --env-file services/staging/.env up -d --build
docker compose -f services/staging/compose.yml ps
```

### d. Health check — acceptance (§0.1e)

```sh
curl -fsS https://afc-staging.bluespace.ng/api/health
```

Must answer **200** with `"directusConfigured":false`, e.g.
`{"status":"ok",...,"directusConfigured":false}`. That `false` is the
healthy staging state until the backend cutover, not a failure.

### e. Rollback (same as README §5)

Rollback = redeploy the previous tag. Set `WEB_IMAGE` in the host `.env`
to the last good tag and re-run the start command:

```sh
docker compose -f services/staging/compose.yml --env-file services/staging/.env up -d --build
```

There is no database in this bundle, so there is nothing to migrate back.
Keep the previous image tag until the new one passes step d.

## 4. Staging degraded-safe notes (do not negotiate on the host)

- `NUXT_STUB_AUTH=false` — staging serves the real auth path. The stub is a
  local-dev tool and the production build refuses to serve it.
- `NUXT_SESSION_SECRET` — **required, host only**. Generate on the guest:
  `openssl rand -base64 48`. Never commit it, never paste it into an issue.
- Directus vars stay empty (not deployed yet):
  `NUXT_DIRECTUS_URL`, `NUXT_PUBLIC_DIRECTUS_URL`,
  `NUXT_DIRECTUS_SERVER_TOKEN`, `NUXT_DIRECTUS_PUBLIC_TOKEN`. Empty is the
  supported state: health answers 200 with `directusConfigured:false`;
  sign-in and public registration answer 503 saying Directus is not
  deployed. Do not point these at production.
- No production data and no youth data on staging. Ever.
- No secrets in the repo, in comments, or in pasted logs. Values live in the
  host `.env` (mode 600) or the deploy pipeline.
