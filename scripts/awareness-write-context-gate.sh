#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# AFC awareness_at write-context gate.
#
# WHY THIS EXISTS
#   incidents.awareness_at is the NDPA s.40(2) clock origin. It is set by the
#   database and is immutable afterwards (ADR-0001). Application source has no
#   business naming it at all: not in a form, not in a DTO, not in a TypeScript
#   type, not in a Flow.
#
#   This gate is the CI enforcement of that, and it is deliberately blunt. The
#   enforcement is the Postgres trigger; this is the tripwire for the ordinary
#   mistake -- someone adds the field to a payload because Directus returned it
#   in a read response and now every write path carries a value nobody should be
#   able to set.
#
# CONTRACT
#   exit 0 -> no awareness_at outside the schema layer.
#   exit 1 -> violation found. Prints file:line and the offending text.
#
# NOT ALLOWLISTED, ON PURPOSE
#   services/directus/schema/migrations/**   The schema layer is where the
#                                             column is defined. It is the control.
#   Everything else is scanned, including Directus Flow and endpoint code under
#   services/directus/extensions/, which runs with app privileges.
#
# THE ESCAPE HATCH, AND WHY IT IS VISIBLE
#   A read-only projection that genuinely needs the field (a register read model,
#   a support view) can carry this marker on the line:
#
#     awareness_at  // afc-gate:allow-awareness-read
#
#   The marker suppresses that ONE line and nothing else -- an unmarked
#   awareness_at on the next line of the same file still fails. Every suppressed
#   line is printed as OVERRIDE in the CI log rather than swallowed, so an
#   override cannot be invisible: it shows up in review, and a reviewer can grep
#   every use at once instead of trusting a gate nobody has argued with.
#
#   The marker is an override, not a proof. If you reach for it on a line that
#   writes, you have changed the control and the trigger will stop you.
#
# SELF-TEST
#   A gate nobody has watched fail is not a gate. `--self-test` builds a
#   throwaway tree with a known write context, asserts the scanner REJECTS it,
#   asserts the clean tree is ACCEPTED, and asserts the read marker suppresses
#   exactly one line and not its neighbours. Non-zero exit on any surprise.
# ---------------------------------------------------------------------------
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT" || exit 2

# Exactly the tree where a payload, a form, a DTO or a Flow could carry the
# column. Not services/directus/monitoring -- the exporter queries read it by
# design and are reviewed as part of this control. Not scripts/ -- the control
# tests have to name the column to assert on it.
SCAN_DIRS=(
  "apps"
  "packages"
  "services/directus/extensions"
)

PATTERN='awareness_at(_source)?'
MARKER='afc-gate:allow-awareness-read'
EXTS='*.ts *.tsx *.js *.mjs *.cjs *.vue *.sql *.json *.graphql *.yaml *.yml'

scan() {
  # $1 = base dir (the self-test points this at a fixture tree)
  local base="$1"
  local violations=0
  local f p

  for f in $(find "$base" \
      \( -path '*/node_modules' -o -path '*/.git' -o -path '*/dist' -o -path '*/.nuxt' \) -prune -o \
      -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.mjs' \
               -o -name '*.cjs' -o -name '*.vue' -o -name '*.sql' -o -name '*.json' \
               -o -name '*.graphql' -o -name '*.yaml' -o -name '*.yml' \) -print 2>/dev/null); do
    [ -n "$f" ] || continue

    case "$f" in
      */schema/migrations/*) continue ;;   # the schema layer defines the column
      *awareness-gate-fixtures*) continue ;; # the negative fixture below
      *) ;;
    esac

    local matched
    matched="$(grep -En "$PATTERN" "$f" 2>/dev/null || true)"
    [ -n "$matched" ] || continue

    while IFS= read -r p; do
      [ -n "$p" ] || continue
      case "$p" in
        *"$MARKER"*)
          # suppressed, but said out loud
          printf 'OVERRIDE %s:%s: %s\n' "$f" "${p%%:*}" "${p#*:}"
          ;;
        *)
          printf 'VIOLATION %s:%s: %s\n' "$f" "${p%%:*}" "${p#*:}" >&2
          violations=$((violations + 1))
          ;;
      esac
    done <<< "$matched"
  done

  return $((violations > 0 ? 1 : 0))
}

self_test() {
  local rc
  # not local: the EXIT trap fires after this function's scope is gone, and
  # `set -u` would turn that into an unbound-variable error
  AFC_GATE_TMP="$(mktemp -d)"
  tmp="$AFC_GATE_TMP"
  trap 'rm -rf "${AFC_GATE_TMP:-}"' EXIT

  mkdir -p "$tmp/clean/services/directus/extensions" "$tmp/dirty/services/directus/extensions"
  printf 'export const summary = ref;\n' \
    > "$tmp/clean/services/directus/extensions/ok.ts"
  printf 'export const row = { ref: 1 };  // afc-gate:allow-awareness-read\n' \
    > "$tmp/clean/services/directus/extensions/projection.ts"

  scan "$tmp/clean"; rc=$?
  if [ "$rc" -ne 0 ]; then
    echo "SELF-TEST FAILED: a clean tree was rejected" >&2
    return 1
  fi
  echo "  self-test ok: clean tree accepted"

  # A marked line is an override, and an override must be reported rather than
  # swallowed -- but it must suppress that line and nothing else.
  printf 'export const projection = { awareness_at };  // afc-gate:allow-awareness-read\n' \
    > "$tmp/dirty/services/directus/extensions/payload.ts"
  local out
  out="$(scan "$tmp/dirty" 2>/dev/null || true)"
  if ! printf '%s' "$out" | grep -q '^OVERRIDE '; then
    echo "SELF-TEST FAILED: a suppressed line was not reported as an OVERRIDE" >&2
    return 1
  fi
  echo "  self-test ok: a marked read-only line is reported as an override"

  printf 'export const row = { awareness_at };\n' >> "$tmp/dirty/services/directus/extensions/payload.ts"
  if scan "$tmp/dirty" >/dev/null 2>&1; then
    echo "SELF-TEST FAILED: the marker disarmed the whole file, not one line" >&2
    return 1
  fi
  echo "  self-test ok: the marker is line-scoped, not file-scoped"

  # The schema layer defines the column, so it must stay allowlisted.
  mkdir -p "$tmp/clean/services/directus/schema/migrations"
  printf "SELECT awareness_at FROM incidents;\n" \
    > "$tmp/clean/services/directus/schema/migrations/20261006_0002_x.sql"
  if ! scan "$tmp/clean" >/dev/null 2>&1; then
    echo "SELF-TEST FAILED: the schema layer was flagged, it should be allowlisted" >&2
    return 1
  fi
  echo "  self-test ok: schema layer allowlisted"

  # And the exit code itself must be the thing under test: a gate that prints a
  # violation and exits 0 is worse than no gate, because CI goes green.
  printf 'export const row = { awareness_at };\n' > "$tmp/clean/services/directus/extensions/ok.ts"
  scan "$tmp/clean" >/dev/null 2>&1
  if [ $? -eq 0 ]; then
    echo "SELF-TEST FAILED: a violation was found but the exit code was 0" >&2
    return 1
  fi
  echo "  self-test ok: a violation produces a non-zero exit"
  return 0
}

if [ "${1:-}" = "--self-test" ]; then
  self_test
  exit $?
fi

existing=0
rc=0
for d in "${SCAN_DIRS[@]}"; do
  [ -d "$d" ] || continue
  existing=$((existing + 1))
  # scan returns 1 on violation; that must reach the exit code, not just stdout
  if ! scan "$d"; then
    rc=1
  fi
done

if [ "$existing" -eq 0 ]; then
  echo "awareness gate: no scanned directories exist yet (apps/, packages/, services/directus/extensions/)" >&2
  echo "awareness gate: vacuously clean, but NOT enforced -- nothing to scan" >&2
  exit 1
fi

if [ "$rc" -ne 0 ]; then
  echo "awareness gate: awareness_at found outside the schema layer" >&2
  echo "awareness gate: the database sets that column and application source must not name it." >&2
  exit 1
fi

echo "awareness gate: no awareness_at outside the schema layer"
exit 0