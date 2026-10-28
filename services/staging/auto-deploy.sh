#!/usr/bin/env bash
# AFC-820: staging auto-deploy. Runs on CT105 under a systemd timer.
#
# Pulls origin/main and, when it moved, stages it: pg_dump first, then only
# the migration files new since the deployed SHA (ON_ERROR_STOP, abort
# before the build on failure), then the standard rebuild (bump
# NUXT_PUBLIC_BUILD_SHA, build with the arg, force-recreate) with a
# SHA-proof health check at the end.
#
# Migrations stay human-written and CI-gated; this script only applies what
# already passed on main. It never touches rollback/ files. If the working
# tree is dirty, or the deployed SHA is not an ancestor of origin/main, it
# refuses and a human deploys by hand.
set -uo pipefail

REPO=/opt/afc-portal-git
COMPOSE_DIR="$REPO/services/staging"
ENV_FILE="$COMPOSE_DIR/.env"
DB_CONTAINER=staging-postgres-1
DB_USER=afc_portal
DB_NAME=afc_portal

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }

cd "$REPO" || { log "FATAL: cannot cd $REPO"; exit 1; }
git fetch origin main >/dev/null 2>&1 || { log "FATAL: fetch failed"; exit 1; }
REMOTE="$(git rev-parse origin/main)"
CURRENT="$(sed -n 's/^NUXT_PUBLIC_BUILD_SHA=//p' "$ENV_FILE" | head -1)"
if [ "$REMOTE" = "$CURRENT" ]; then
  log "staging current at ${REMOTE:0:7}; nothing to do"
  exit 0
fi
log "deploying ${CURRENT:0:7} -> ${REMOTE:0:7}"
if ! git merge-base --is-ancestor "$CURRENT" "$REMOTE" 2>/dev/null; then
  log "FATAL: deployed SHA $CURRENT is not an ancestor of $REMOTE; deploy by hand"
  exit 1
fi
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  log "FATAL: working tree dirty; refusing to pull over it"
  exit 1
fi
git pull --ff-only origin main >/dev/null 2>&1 || { log "FATAL: pull failed"; exit 1; }

# The host .env value feeds BOTH the build arg and the container's runtime
# value (compose interpolates ${NUXT_PUBLIC_BUILD_SHA} for each), so the
# marker must move BEFORE build+recreate. Fail-closed companion:
# SERVED_SHA remembers what the live container actually reports, and every
# failure path below restores the marker to it, so a failed deploy retries
# instead of declaring victory over a stale container (2026-10-28: moving
# the bump after health broke every deploy, as the fresh container booted
# with the stale runtime value and could never report the new SHA).
served_sha() {
  local wip
  wip="$(docker inspect staging-web-1 --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' 2>/dev/null)" || return 0
  [ -z "$wip" ] && return 0
  curl -s --max-time 10 "http://$wip:3000/api/health" 2>/dev/null | grep -o '"sha":"[0-9a-f]*"' | cut -d'"' -f4
}
SERVED_SHA="$(served_sha)"
restore_marker() {
  if [ -n "$SERVED_SHA" ] && [ "$SERVED_SHA" != "$REMOTE" ]; then
    sed -i "s/^NUXT_PUBLIC_BUILD_SHA=.*/NUXT_PUBLIC_BUILD_SHA=$SERVED_SHA/" "$ENV_FILE"
    log "marker restored to served ${SERVED_SHA:0:7} after failed deploy"
  fi
}

mapfile -t MIGRATIONS < <(git diff --name-only "$CURRENT..$REMOTE" -- 'services/directus/schema/migrations/*.sql' ':!*/rollback/*' | sort)
if [ "${#MIGRATIONS[@]}" -gt 0 ]; then
  DUMP="/root/afc-staging-auto-$(date -u +%Y%m%dT%H%M%SZ).dump"
  log "new migrations: ${#MIGRATIONS[@]}; dumping to $DUMP"
  docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" -Fc > "$DUMP" 2>/dev/null \
    || { log "FATAL: pg_dump failed; aborting before any migration"; exit 1; }
  for migration in "${MIGRATIONS[@]}"; do
    log "applying $migration"
    docker exec -i "$DB_CONTAINER" psql -U "$DB_USER" -d "$DB_NAME" \
      -v ON_ERROR_STOP=1 -f - < "$REPO/$migration" >/dev/null 2>&1 \
      || { log "FATAL: $migration failed; database left as-is past this file, web NOT rebuilt; restore from $DUMP if needed"; exit 1; }
  done
else
  log "no new migrations"
fi

# Marker first: compose interpolates the host .env value both as the
# build arg AND as the live container value, so the new SHA must be in
# place before build+recreate. restore_marker (above) covers failures.
sed -i "s/^NUXT_PUBLIC_BUILD_SHA=.*/NUXT_PUBLIC_BUILD_SHA=$REMOTE/" "$ENV_FILE"
cd "$COMPOSE_DIR" || exit 1
docker compose build --build-arg "NUXT_PUBLIC_BUILD_SHA=$REMOTE" web >/dev/null 2>&1 \
  || { restore_marker; log "FATAL: web build failed; old container still running"; exit 1; }
docker compose up -d --force-recreate web >/dev/null 2>&1 \
  || { restore_marker; log "FATAL: recreate failed"; exit 1; }

WIP="$(docker inspect staging-web-1 --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}')"
SERVED=""
for _ in $(seq 1 12); do
  sleep 10
  SERVED="$(curl -s --max-time 10 "http://$WIP:3000/api/health" | grep -o '"sha":"[0-9a-f]*"' | cut -d'"' -f4)"
  if [ "$SERVED" = "$REMOTE" ]; then
    log "staging now serves ${REMOTE:0:7}; healthy"
    exit 0
  fi
done
restore_marker
log "FATAL: health check never reported $REMOTE (last saw ${SERVED:-nothing})"
exit 1
