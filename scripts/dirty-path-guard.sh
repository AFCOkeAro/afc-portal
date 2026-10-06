#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# AFC compliance-path dirty guard. AFC-175.
#
# WHY THIS EXISTS
#   More than one agent writes into this one working directory at a time. Git
#   has no concept of an agent and the Paperclip activity log records
#   issue.* / environment.* events, not which run wrote which file. So when
#   unreviewed code appears on the compliance path, provenance is not
#   recoverable after the fact -- and the only reliable moment to notice is
#   BEFORE it is committed, under somebody else's commit message.
#
#   The gates in this directory prove a property of what is in the tree. They
#   cannot prove who put it there. This guard closes that gap: it is the one
#   check that refuses to certify a compliance-path file that is not yet in a
#   reviewed commit.
#
# CONTRACT
#   exit 0 -> every compliance-path file is committed, or does not exist.
#   exit 1 -> at least one compliance-path path is modified, staged, or
#             untracked. Prints the offending path and the exact
#             `git status --porcelain` line that proved it.
#   exit 2 -> the guard could not read git state at all. That is a failure, not
#             a pass. A guard that cannot see the tree does not get to say the
#             tree is fine.
#
# GUARDED PATHS
#   scripts/                    every gate and every test harness. A modified
#                                gate is an unreviewed change to a control.
#   services/directus/schema/  migrations, the retention engine, bootstrap
#                                roles. Irreversible in production.
#   tests/                      the control suites themselves. A dirty suite is
#                                a suite whose evidence nobody produced.
#
#   apps/, packages/ and the repo root are deliberately NOT guarded. AFC-174
#   is mid-flight in those directories and this guard must not be a reason a
#   legitimate concurrent change cannot exist. The guard is scoped to the
#   compliance path and says so.
#
# WHAT THIS GUARD DOES NOT DO
#   It does not write to the working tree. It does not stage, stash, reset,
#   checkout, or install a hook. It reports. A guard that repairs the tree can
#   destroy the evidence of the thing it is reporting, and a pre-commit hook
#   that silently stages a file is how unattributable code gets shipped with a
#   clean-looking diff.
#
#   It has no allowlist. There is deliberately no way to mark a dirty file as
#   expected. If a compliance-path file is not committed, the guard fails --
#   including for files under quarantine. A quarantined file IS an
#   unattributable compliance-path file; exempting it would make the guard
#   green on exactly the tree it exists to condemn. Resolve the quarantine at
#   the source (commit it reviewed, or delete it), not in this script.
#
# SELF-TEST
#   A gate nobody has watched fail is not a gate. `--self-test` builds a
#   throwaway git repository, plants one defect at a time, and asserts the
#   guard rejects each one and accepts the clean tree. Non-zero exit on any
#   surprise, in either direction.
# ---------------------------------------------------------------------------
set -uo pipefail

# Paths whose dirty state is unshippable. Prefixes, matched against the
# repo-relative path, so a directory can be added without editing the parser.
GUARDED_PATHS=(
  "scripts/"
  "services/directus/schema/"
  "tests/"
)

ROOT_DEFAULT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Is $1 (repo-relative) under a guarded prefix?
is_guarded() {
  local path="$1" p
  for p in "${GUARDED_PATHS[@]}"; do
    case "$path" in
      "$p"*) return 0 ;;
    esac
  done
  return 1
}

# Strip the two status columns and a rename/copy "old -> new" arrow.
# Porcelain v1 format: XY <space> <path>. Paths with spaces are fine here
# because everything after column 3 is the path.
porcelain_path() {
  local line="$1"
  printf '%s' "${line:3}"
}

# ---------------------------------------------------------------------------
# The check.
# ---------------------------------------------------------------------------
guard() {
  local root="${1:-$ROOT_DEFAULT}"
  local rc=0
  local line code path

  if ! git -C "$root" rev-parse --git-dir >/dev/null 2>&1; then
    echo "DIRTY-GUARD FAIL: $root is not inside a git repository."
    echo "  A guard that cannot read the tree does not get to certify it."
    return 2
  fi

  # --untracked-files=all so a file inside a brand-new untracked DIRECTORY is
  # still named individually. The default collapses an untracked directory to
  # one "dir/" entry, which is exactly the shape that hides an engine file
  # under services/directus/schema/engine/.
  local status
  status=$(git -C "$root" status --porcelain --untracked-files=all -- \
             "${GUARDED_PATHS[@]}" 2>/dev/null)
  if [ $? -ne 0 ]; then
    echo "DIRTY-GUARD FAIL: 'git status --porcelain' failed in $root."
    return 2
  fi

  if [ -z "$status" ]; then
    echo "dirty-path guard: compliance path is clean (${#GUARDED_PATHS[@]} guarded paths)"
    return 0
  fi

  while IFS= read -r line; do
    [ -n "$line" ] || continue
    code="${line:0:2}"
    path="$(porcelain_path "$line")"

    # git quotes paths containing non-ASCII or control characters, and a
    # rename is printed as "old -> new". Take the destination: that is the
    # path that would ship.
    case "$path" in
      *' -> '*) path="${path##* -> }" ;;
    esac
    path="${path%\"}"
    path="${path#\"}"

    # Fail closed on anything this parser does not understand. A guard that
    # silently skips a path it cannot read is worse than no guard, because it
    # reports "clean".
    if [ "${code:0:1}" = '"' ] || printf '%s' "$path" | grep -q '^"'; then
      echo "DIRTY-GUARD FAIL: could not parse a git status line; refusing to certify the tree."
      echo "  $line"
      rc=2
      continue
    fi

    if is_guarded "$path"; then
      echo "DIRTY-GUARD VIOLATION [$code] $path"
      echo "    $line"
      rc=1
    fi
  done <<< "$status"

  if [ "$rc" -eq 1 ]; then
    cat <<'MSG'

FAIL: the compliance path has unattributed changes.

One or more files under scripts/, services/directus/schema/ or tests/ are
modified, staged, or untracked. On the compliance path that means unreviewed
control code that is one `git add -A` from shipping under someone else's
commit message.

There is no allowlist and no bypass. To clear this:

  - Land the change deliberately, in its own commit, with a message that says
    what it changes about the control. Then it has an author and a review.
  - Or delete it, if it was not meant to be here.

Do NOT weaken, disable, or conditionally skip this guard to make a run pass.
MSG
  fi

  return "$rc"
}

# ---------------------------------------------------------------------------
# Self-test
# ---------------------------------------------------------------------------
self_test() {
  local rc=0
  local tmp
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' RETURN

  # A real repository, not a mock: the whole point is that the guard reads
  # git's own answer, so the self-test has to ask git.
  local repo="$tmp/repo"
  mkdir -p "$repo/scripts" "$repo/services/directus/schema/engine" \
           "$repo/services/directus/schema/migrations" "$repo/tests/db" \
           "$repo/apps/web" "$repo/docs"
  git -C "$repo" init -q
  git -C "$repo" config user.email guard@afc.test
  git -C "$repo" config user.name  "AFC guard self-test"
  printf 'echo original\n'  > "$repo/scripts/gate.sh"
  printf 'SELECT 1;\n'        > "$repo/services/directus/schema/migrations/0001.sql"
  printf 'SELECT 2;\n'        > "$repo/tests/db/assert.sql"
  printf 'print("x")\n'      > "$repo/apps/web/app.vue"
  printf '# notes\n'         > "$repo/docs/notes.md"
  git -C "$repo" add -A
  git -C "$repo" commit -q -m "clean tree"

  # 0. Sanity: the fixture really is clean, so a later pass is meaningful.
  if ! guard "$repo" >/dev/null 2>&1; then
    echo "SELF-TEST FAIL: guard rejected a repository it just created clean"
    rc=1
  else
    echo "  self-test ok: clean tree accepted"
  fi

  # 1. A modified tracked compliance-path file MUST be rejected.
  printf 'echo weakened\n' >> "$repo/scripts/gate.sh"
  local out
  out=$(guard "$repo" 2>&1)
  if [ $? -eq 0 ]; then
    echo "SELF-TEST FAIL: guard accepted a modified scripts/ file"
    rc=1
  elif ! printf '%s' "$out" | grep -q 'scripts/gate.sh'; then
    echo "SELF-TEST FAIL: guard failed without naming scripts/gate.sh"
    echo "$out" | sed 's/^/    /'
    rc=1
  elif ! printf '%s' "$out" | grep -qE '^ +M scripts/gate\.sh$'; then
    # The porcelain line itself -- " M scripts/gate.sh" -- has to be in the
    # output, because that line is the evidence and a reader has to be able to
    # paste it into `git status --porcelain` and see the same thing.
    echo "SELF-TEST FAIL: guard failed without echoing the git status line"
    echo "$out" | sed 's/^/    /'
    rc=1
  else
    echo "  self-test ok: modified tracked file rejected, path and status line named"
  fi
  git -C "$repo" checkout -q -- scripts/gate.sh

  # 2. An untracked file under the engine MUST be rejected. This is the exact
  #    shape of the AFC-175 quarantine: a new engine directory is collapsed to
  #    one entry by the default git status, so --untracked-files=all is what
  #    makes this assertion true rather than accidentally true.
  printf 'CREATE FUNCTION retention.x();\n' > "$repo/services/directus/schema/engine/0001_x.sql"
  if guard "$repo" >/dev/null 2>&1; then
    echo "SELF-TEST FAIL: guard accepted an untracked file under schema/engine/"
    rc=1
  else
    echo "  self-test ok: untracked engine file rejected"
  fi
  rm -f "$repo/services/directus/schema/engine/0001_x.sql"

  # 3. An untracked compliance-path test MUST be rejected.
  printf 'SELECT 3;\n' > "$repo/tests/db/60_new.sql"
  if guard "$repo" >/dev/null 2>&1; then
    echo "SELF-TEST FAIL: guard accepted an untracked file under tests/"
    rc=1
  else
    echo "  self-test ok: untracked test file rejected"
  fi
  rm -f "$repo/tests/db/60_new.sql"

  # 4. Staged-but-uncommitted MUST be rejected. `git add` without a commit is
  #    still unshippable, and it is the state an agent leaves behind right
  #    before it is interrupted.
  printf 'echo staged\n' > "$repo/scripts/staged.sh"
  git -C "$repo" add scripts/staged.sh
  if guard "$repo" >/dev/null 2>&1; then
    echo "SELF-TEST FAIL: guard accepted a staged-but-uncommitted file"
    rc=1
  else
    echo "  self-test ok: staged-but-uncommitted file rejected"
  fi
  git -C "$repo" reset -q
  rm -f "$repo/scripts/staged.sh"

  # 5. Dirty OUTSIDE the compliance path MUST be accepted. A guard that is
  #    really "the repo must be clean" would block every legitimate concurrent
  #    agent, which is how a guard gets disabled.
  printf 'print("dirty")\n' > "$repo/apps/web/app.vue"
  printf 'unreviewed\n'      > "$repo/docs/scratch.md"
  if guard "$repo" >/dev/null 2>&1; then
    echo "  self-test ok: dirt outside the compliance path accepted"
  else
    echo "SELF-TEST FAIL: guard rejected dirt outside the compliance path"
    rc=1
  fi
  git -C "$repo" checkout -q -- apps/web/app.vue
  rm -f "$repo/docs/scratch.md"

  # 6. A DELETED tracked compliance-path file MUST be rejected. Deleting the
  #    control suite that proves a control holds is how a control stops being
  #    enforced while every gate still reports green.
  rm -f "$repo/tests/db/assert.sql"
  if guard "$repo" >/dev/null 2>&1; then
    echo "SELF-TEST FAIL: guard accepted a deleted compliance-path file"
    rc=1
  else
    echo "  self-test ok: deleted compliance-path file rejected"
  fi
  git -C "$repo" checkout -q -- tests/db/assert.sql

  # 7. The guard MUST NOT mutate the tree. A reporting guard that stages or
  #    resets something is a guard that can destroy the evidence it reports.
  printf 'echo tampered\n' >> "$repo/scripts/gate.sh"
  local before after
  before=$(git -C "$repo" status --porcelain --untracked-files=all)
  guard "$repo" >/dev/null 2>&1
  after=$(git -C "$repo" status --porcelain --untracked-files=all)
  if [ "$before" != "$after" ]; then
    echo "SELF-TEST FAIL: guard mutated the working tree"
    echo "    before: $before"
    echo "    after:  $after"
    rc=1
  else
    echo "  self-test ok: guard did not mutate the working tree"
  fi
  git -C "$repo" checkout -q -- scripts/gate.sh

  # 8. Not a git repository MUST exit 2, not 0.
  mkdir -p "$tmp/not-a-repo"
  guard "$tmp/not-a-repo" >/dev/null 2>&1
  if [ $? -ne 2 ]; then
    echo "SELF-TEST FAIL: guard did not exit 2 outside a git repository"
    rc=1
  else
    echo "  self-test ok: non-repository fails closed with exit 2"
  fi

  return $rc
}

if [ "${1:-}" = "--self-test" ]; then
  echo "Dirty-path guard self-test"
  self_test
  exit $?
fi

guard "${2:-$ROOT_DEFAULT}"
exit $?