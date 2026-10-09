#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# AFC ADR uniqueness gate.
#
# WHY THIS EXISTS
#   ADR numbers are the canonical cross-reference identifier for architectural
#   decisions. When two ADRs share a number, every bare reference to that
#   number is ambiguous — a reader has a 50/50 chance of landing on the
#   wrong document. On a security control (e.g. a privilege boundary), an
#   ambiguous pointer is worse than none: it reads as authoritative and
#   resolves wrongly.
#
#   This happened on main: ADR-0006 was assigned to two different decisions
#   (register seal rollback and retention schema EXECUTE revocation). The
#   engine's revocation comment cited "ADR-0006" alone, making it impossible
#   to know which document justified the privilege boundary.
#
#   This gate is the CI enforcement: no two files in docs/adr/ may claim
#   the same ADR number.
#
# CONTRACT
#   exit 0 -> all ADR numbers are unique.
#   exit 1 -> duplicate found. Prints the number and all files claiming it.
#
# SELF-TEST
#   `--self-test` creates a throwaway tree with a known duplicate, asserts
#   the gate REJECTS it, then asserts the gate ACCEPTS the clean tree.
#   Non-zero exit on any surprise.
# ---------------------------------------------------------------------------

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# --- Self-test mode ---------------------------------------------------------

if [[ "${1:-}" == "--self-test" ]]; then
  TMPDIR="$(mktemp -d)"
  trap 'rm -rf "$TMPDIR"' EXIT

  # Build a clean tree
  mkdir -p "$TMPDIR/clean/docs/adr"
  touch "$TMPDIR/clean/docs/adr/ADR-0001-test.md"
  touch "$TMPDIR/clean/docs/adr/ADR-0002-test.md"
  touch "$TMPDIR/clean/docs/adr/ADR-0003-test.md"

  # Build a tree with a duplicate
  mkdir -p "$TMPDIR/dirty/docs/adr"
  touch "$TMPDIR/dirty/docs/adr/ADR-0001-test.md"
  touch "$TMPDIR/dirty/docs/adr/ADR-0002-test.md"
  touch "$TMPDIR/dirty/docs/adr/ADR-0002-duplicate.md"

  # Test 1: clean tree should pass
  echo "self-test: clean tree should pass..."
  if ! bash "$SCRIPT_DIR/adr-uniqueness-gate.sh" --root "$TMPDIR/clean" >/dev/null 2>&1; then
    echo "FAIL: clean tree was rejected"
    exit 1
  fi
  echo "  PASS"

  # Test 2: dirty tree should fail
  echo "self-test: dirty tree should fail..."
  if bash "$SCRIPT_DIR/adr-uniqueness-gate.sh" --root "$TMPDIR/dirty" >/dev/null 2>&1; then
    echo "FAIL: dirty tree was accepted"
    exit 1
  fi
  echo "  PASS"

  # Test 3: empty tree should pass
  echo "self-test: empty tree should pass..."
  mkdir -p "$TMPDIR/empty/docs/adr"
  if ! bash "$SCRIPT_DIR/adr-uniqueness-gate.sh" --root "$TMPDIR/empty" >/dev/null 2>&1; then
    echo "FAIL: empty tree was rejected"
    exit 1
  fi
  echo "  PASS"

  echo "self-test: all passed"
  exit 0
fi

# --- Argument parsing -------------------------------------------------------

ROOT="$REPO_ROOT"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --root)
      ROOT="$2"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

# --- Gate logic -------------------------------------------------------------

ADR_DIR="$ROOT/docs/adr"

if [[ ! -d "$ADR_DIR" ]]; then
  # No ADR directory means no ADRs, which means no duplicates
  exit 0
fi

# Extract ADR numbers from filenames and find duplicates
# We use the filename pattern ADR-NNNN-*.md
# Write to a temp file to avoid pipefail issues with grep returning 1 on no matches
TMPFILE=$(mktemp)
trap 'rm -f "$TMPFILE"' EXIT
find "$ADR_DIR" -maxdepth 1 -name "ADR-*.md" -type f | \
  grep -oE 'ADR-[0-9]{4}' > "$TMPFILE" 2>/dev/null || true
DUPLICATES=$(sort "$TMPFILE" | uniq -d)

if [[ -n "$DUPLICATES" ]]; then
  echo "ADR uniqueness gate: FAIL"
  echo ""
  echo "The following ADR numbers are claimed by multiple files:"
  echo ""

  while IFS= read -r num; do
    echo "  $num:"
    find "$ADR_DIR" -maxdepth 1 -name "${num}-*.md" -type f | sort | while IFS= read -r f; do
      echo "    $(basename "$f")"
    done
    echo ""
  done <<< "$DUPLICATES"

  echo "Each ADR number must be unique. Rename one of the files to the next free number."
  exit 1
fi

exit 0
