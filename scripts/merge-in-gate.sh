#!/usr/bin/env bash
# scripts/merge-in-gate.sh -- the merge-in protocol of step 3 (AFC-196), enforced
# as a git commit-msg hook on the shared repository.
#
# WHY A commit-msg HOOK AND NOT A MERGE HOOK. The obvious enforcement point for
# "a non-compliant change must not reach main" is a pre-merge hook. On this
# repository that does not work: git's pre-merge-commit hook runs AFTER the merge
# is resolved and AFTER git has cleared MERGE_HEAD, so the hook cannot recover
# which commits the merge is introducing. `git rev-parse MERGE_HEAD` fails there
# ("Needed a single revision") and `.git/MERGE_HEAD` is gone -- verified, not
# assumed. The legacy pre-merge hook is deprecated and equally blind. A merge gate
# built on it would be a gate that cannot see what it is gating, which is the
# "looks enforced, is not" failure this whole provenance rule exists to prevent.
#
# So the gate sits one step earlier, at the only choke point git actually gives
# us: the commit. Every path into main -- merge, rebase, cherry-pick, direct
# commit -- creates a commit object, and at commit-msg time the exact set of files
# and the exact message are both known. That is strictly stronger than a merge
# gate: it refuses the bad commit before it has an identity, so there is no
# unreviewed compliance-path commit anywhere for a later merge to admit. A merge
# gate only bounds where bad commits LAND; this bounds where they are MADE.
#
# HOW IT CHECKS, WITHOUT A SECOND IMPLEMENTATION OF R1/R2. It does not re-decide
# the rules. It materialises the staged tree into a temporary, DANGLING commit
# object (`git write-tree` + `git commit-tree`, parented on HEAD) and hands that
# object to the SAME `scripts/dirty-path-guard.sh --check-commit` the CI file
# calls. One rule, one implementation, no drift. The object is never referenced
# by a branch and never pushed; `git commit` re-derives its own. If the guard
# cannot run -- including the case where the guard itself is syntactically broken
# -- the gate REFUSES, because a gate that cannot answer must not answer "pass".
#
# SCOPE. Strict on the compliance path only:
#     services/directus/schema/engine/**
#     services/directus/schema/migrations/**
#     tests/db/**
#     scripts/retention-literal-gate.sh
#   (that list is the guard's, not this file's; this file adds no paths of its
#   own, precisely so the two cannot disagree about what is strict). Everything
#   outside it commits with no claim, no reviewer, and no human step. The strict
#   set is bounded on purpose: widening it past the compliance path is what makes
#   an isolation layer get abandoned under deadline pressure.
#
# WHAT IT DOES NOT COVER, stated so nobody is misled. It cannot judge whether the
# retention semantics are the RIGHT ones -- that is design-level intent, no
# mechanical gate can decide it, and the board has instructed that this gap stays
# documented until a security reviewer is funded. This gate must never be
# described as covering it.
#
# INSTALL / ROLLBACK:
#   bash scripts/merge-in-gate.sh --install     # idempotent
#   bash scripts/merge-in-gate.sh --uninstall   # idempotent
#   bash scripts/merge-in-gate.sh --self-test   # prove it can refuse
#   bash scripts/merge-in-gate.sh --explain     # what it checks, in prose

set -euo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SELF_FILE="$SELF_DIR/$(basename "${BASH_SOURCE[0]}")"
ROOT_DEFAULT="$(cd "$SELF_DIR/.." && pwd)"
GUARD="$ROOT_DEFAULT/scripts/dirty-path-guard.sh"

usage() {
  cat <<'USAGE'
usage: scripts/merge-in-gate.sh [--install|--uninstall|--self-test|--explain]

  (no args)   act as a commit-msg hook. Reads the staged tree and the commit
              message file that git passes as $1, and refuses a non-compliant
              compliance-path commit. Intended for git, not for hand use.
  --install     install as the repository's commit-msg hook (idempotent).
  --uninstall   remove the installed hook, only if this script installed it.
  --self-test   drive real `git commit`s and assert refusals and allows.
  --explain     print what the gate checks and where it is wired.
USAGE
}

hooks_dir() { git -C "$ROOT_DEFAULT" rev-parse --git-common-dir; }

install_hook() {
  local dir hook
  dir="$(hooks_dir)/hooks"
  hook="$dir/commit-msg"
  mkdir -p "$dir"
  # A launcher, not a copy: the logic stays reviewable in scripts/, and a fix
  # lands by editing this file rather than by re-installing a stale snapshot.
  if [ -f "$hook" ] && ! grep -q 'merge-in-gate.sh' "$hook"; then
    echo "refusing to install: $hook already exists and is not ours" >&2
    return 1
  fi
  cat > "$hook" <<EOF
#!/usr/bin/env bash
# Installed by scripts/merge-in-gate.sh --install. Edit the source, not this.
exec bash "$SELF_FILE" "\$@"
EOF
  chmod +x "$hook"
  echo "merge-in gate installed at $hook"
}

uninstall_hook() {
  local hook
  hook="$(hooks_dir)/hooks/commit-msg"
  if [ -f "$hook" ] && grep -q 'merge-in-gate.sh' "$hook"; then
    rm -f "$hook"
    echo "merge-in gate uninstalled"
  elif [ -f "$hook" ]; then
    echo "refusing to remove $hook: it was not installed by merge-in-gate.sh"
  else
    echo "no merge-in hook installed"
  fi
}

explain() {
  cat <<'MSG'
merge-in gate -- step 3 of the provenance rule (AFC-196)

Enforcement point : git commit-msg hook in this repository.
Why there, not a merge hook
                  : a pre-merge hook cannot recover what a merge is introducing
                    (git clears MERGE_HEAD before pre-merge-commit runs), so a
                    merge gate here would be blind. The commit is the choke point
                    every path into main passes through, and it is strictly
                    stronger: it refuses a non-compliant commit before the commit
                    has an identity.
How it checks    : materialises the staged tree into a temporary dangling commit
                    object (git write-tree + git commit-tree) and asks, via
                    scripts/dirty-path-guard.sh, the SAME --check-commit the
                    CI file asks. One rule, one implementation.
Fail-closed      : if the guard cannot run, the commit is refused. A gate that
                    cannot answer never answers "pass".

Strict on        : services/directus/schema/engine/**
                   services/directus/schema/migrations/**
                   tests/db/**
                   scripts/retention-literal-gate.sh
                    (the guard owns that list; this file adds none, so the two
                    cannot disagree about what is strict)
Everything else  : commits with no claim, no reviewer, no human step.

Not covered, and not claimed to be: whether the retention semantics are the
RIGHT ones. Board-instructed residual gap; no mechanical gate decides intent.
MSG
}

# The hook body. git calls commit-msg with the message file as $1. Unlike
# pre-commit -- which modern git runs with NO arguments at all, so it cannot see
# the message -- commit-msg reliably receives the file (verified: `git commit -m`
# yields argc=1, argv[1]=.git/COMMIT_EDITMSG, with the staged tree intact). That
# asymmetry is the whole reason this gate is commit-msg and not pre-commit.
run_as_hook() {
  local msg_file="${1:-}" root head tree sha guard_rc

  root="$(git rev-parse --show-toplevel)"
  head="$(git rev-parse --verify HEAD 2>/dev/null || true)"

  # A repository's very first commit has no HEAD to parent the synthetic commit
  # on. This gate governs changes on top of an existing history; bootstrapping an
  # empty repository is out of its scope, so it steps aside rather than
  # fabricating a parent. (The real repository's root commit is checked by the
  # guard's own --self-test assertion 11e, not by this hook.)
  if [ -z "$head" ]; then
    exit 0
  fi

  # Nothing staged is not this gate's business; let git produce its own empty
  # commit if that is what was asked for.
  if git diff --cached --quiet; then
    exit 0
  fi

  # The guard must exist and parse before we trust it. `bash -n` costs
  # milliseconds and turns "the guard is broken" from a confusing downstream
  # failure into an honest refusal. (Verified necessary: an in-progress edit to
  # dirty-path-guard.sh in a shared tree made it syntactically invalid, and the
  # naive version of this gate reported that as a policy violation.)
  if ! bash -n "$GUARD" 2>/dev/null; then
    cat >&2 <<MSG

merge-in gate: REFUSED -- the provenance guard cannot run.

$GUARD does not parse (bash -n fails), so this gate cannot answer whether the
staged compliance-path change is compliant. It refuses rather than assume.

  This is not a policy violation in your change. Fix or finish the guard, then
  commit. Refusing here is the fail-closed path: an unparseable guard must not
  read as "nothing to check".
MSG
    exit 1
  fi

  # Materialise the staged tree as a dangling commit on top of HEAD. It is not
  # referenced by any ref and `git commit` will not use it; it exists only so the
  # guard has a commit-shaped object to inspect, which keeps the rule in one
  # place instead of two.
  # A pre-commit/commit-msg hook on a repository that already has a history
  # (guaranteed here: the scaffold of the repo itself was committed before this
  # hook could matter) -- so HEAD always exists and the one-commit range
  # `$sha^..$sha` is always well-formed. The guard's dispatcher accepts exactly
  # one argument after --check-commit, so --root is deliberately NOT used.
  tree="$(git write-tree)"
  sha="$(git commit-tree "$tree" -p "$head" -F "$msg_file")"

  # Scope the check to EXACTLY this commit. A bare sha makes the guard walk every
  # ancestor, which re-reports settled history as if it were new: on this repo the
  # walk reaches a pre-existing malformed claim (AFC-205, author=undefined) and
  # the gate then refuses an innocent commit. `$sha^..$sha` is the one-commit
  # range the guard documents.
  set +e
  bash "$GUARD" --check-commit "$sha^..$sha"
  guard_rc=$?
  set -e

  if [ "$guard_rc" -eq 0 ]; then
    exit 0
  fi

  cat >&2 <<'MSG'

merge-in gate: REFUSED. This compliance-path commit is not compliant.

The staged change touches the compliance path and violates the provenance rule
(R1 claim / R2 reviewer). To fix, on this branch:

  * R1  add an `Issue:` trailer naming the issue, and register a claim in
         .provenance/claims/<ISSUE>.json for that same issue with a non-empty
         authorAgentId and every compliance path you touched.
  * R2  add a `Reviewed-by: <agent>` trailer naming a reviewer, or a reviews[]
         record in the claim file with reviewIssue, reviewerAgentId, verdict and
         this commit's sha.

Reviewer designation is the CTO on a Coder compliance-path commit, and
Operations (CEO) as a disclosure -- not a review -- on a CTO one. A claim is an
assertion of authorship, never a licence: it exempts nothing.

Nothing outside the compliance path needs any of this. If you believe this gate
is wrong about your change, the fix is to the guard, not to this check.
MSG
  exit "$guard_rc"
}

# A gate nobody has watched fail is untested, not enforced. Drive REAL git
# commits in throwaway repositories -- the hook installed via core.hooksPath, so
# a refusal is a claim about git's behaviour and not about a function calling
# itself.
self_test() {
  local rc=0 a b
  echo "merge-in gate self-test"
  # tmp is deliberately NOT local: the EXIT trap below dereferences it at shell
  # exit, which happens after this function has returned and its locals are gone.
  # A `local tmp` made the trap read an unset name and turn a passing self-test
  # into a non-zero exit.
  tmp="$(mktemp -d)"
  trap 'rm -rf "${tmp:-}"' EXIT

  make_repo() {
    local d="$1"
    mkdir -p "$d/scripts" "$d/services/directus/schema/engine" "$d/.provenance/claims" "$d/apps" "$d/hooks"
    cp "$GUARD" "$d/scripts/dirty-path-guard.sh"
    cp "$ROOT_DEFAULT/scripts/r2-grandfathered.json" "$d/scripts/r2-grandfathered.json" 2>/dev/null \
      || echo '{"grandfathered":[]}' > "$d/scripts/r2-grandfathered.json"
    cp "$SELF_FILE" "$d/scripts/merge-in-gate.sh"
    : > "$d/apps/app.ts"
    git -C "$d" init -q -b main
    git -C "$d" config user.email gate@test
    git -C "$d" config user.name gate
    cat > "$d/hooks/commit-msg" <<EOF
#!/usr/bin/env bash
exec bash "$d/scripts/merge-in-gate.sh" "\$@"
EOF
    chmod +x "$d/hooks/commit-msg"
    git -C "$d" config core.hooksPath "$d/hooks"
    git -C "$d" add -A && git -C "$d" commit -qm "chore: scaffold"
  }

  # commit_b <repo> <subject> [body] -> returns git commit's exit code, using -m
  # so git materialises a real message file (the shape every agent commit uses,
  # and the shape the hook reads).
  commit_b() {
    local d="$1" subj="$2" body="${3:-}"
    ( cd "$d" && git commit -q -m "$subj" ${body:+-m "$body"} ) >/dev/null 2>&1
    return $?
  }

  # --- R2: compliance path, claimed, but no reviewer trailer ---------------
  a="$tmp/r2"; make_repo "$a"
  echo 'CREATE TABLE x(i int);' > "$a/services/directus/schema/engine/e.sql"
  cat > "$a/.provenance/claims/AFC-1.json" <<'J'
{"issue":"AFC-1","authorAgentId":"8f6e42d7-fb6e-4e6c-904b-dfdda50000ed","claimedAt":"2026-10-06T00:00:00Z","paths":["services/directus/schema/engine/**"]}
J
  git -C "$a" add -A
  if commit_b "$a" "feat: compliance change, no reviewer" "Issue: AFC-1"; then
    echo "SELF-TEST FAIL: gate ALLOWED a compliance-path commit with no reviewer (R2)"
    rc=1
  else
    echo "  self-test ok: compliance-path commit with no reviewer REFUSED (R2)"
  fi

  # --- R1: compliance path, reviewed, but no claim -------------------------
  echo 'CREATE TABLE z(i int);' > "$a/services/directus/schema/engine/z.sql"
  git -C "$a" add -A
  if commit_b "$a" "feat: compliance change, no claim" "Issue: AFC-2
Reviewed-by: 8f6e42d7-fb6e-4e6c-904b-dfdda50000ed"; then
    echo "SELF-TEST FAIL: gate ALLOWED a compliance-path commit with no claim (R1)"
    rc=1
  else
    echo "  self-test ok: compliance-path commit with no claim REFUSED (R1)"
  fi

  # --- the compliant shape must be ALLOWED (a gate that only ever refuses is
  #     not a control, it is an outage) -----------------------------------
  echo 'CREATE TABLE y(i int);' > "$a/services/directus/schema/engine/y.sql"
  cat > "$a/.provenance/claims/AFC-3.json" <<'J'
{"issue":"AFC-3","authorAgentId":"8f6e42d7-fb6e-4e6c-904b-dfdda50000ed","claimedAt":"2026-10-06T00:00:00Z","paths":["services/directus/schema/engine/**"]}
J
  git -C "$a" add -A
  if commit_b "$a" "feat: compliance change, claimed and reviewed" "Issue: AFC-3
Reviewed-by: 8f6e42d7-fb6e-4e6c-904b-dfdda50000ed"; then
    echo "  self-test ok: claimed + reviewed compliance-path commit ALLOWED"
  else
    echo "SELF-TEST FAIL: gate REFUSED a compliant compliance-path commit"
    rc=1
  fi

  # --- non-compliance path: no claim, no reviewer, no human step ----------
  echo 'export const z = 1' > "$a/apps/web.ts"
  git -C "$a" add -A
  if commit_b "$a" "feat(web): ordinary change" "Issue: AFC-9"; then
    echo "  self-test ok: non-compliance-path commit ALLOWED with no human step"
  else
    echo "SELF-TEST FAIL: gate refused a non-compliance-path commit (over-bounded)"
    rc=1
  fi

  # --- fail-closed: an unparseable guard must REFUSE, not wave through -----
  b="$tmp/broken"; make_repo "$b"
  # Corrupt the guard in the throwaway repo so `bash -n` fails.
  printf '#!/usr/bin/env bash\nif [ ; then\n' > "$b/scripts/dirty-path-guard.sh"
  echo 'CREATE TABLE q(i int);' > "$b/services/directus/schema/engine/q.sql"
  cat > "$b/.provenance/claims/AFC-5.json" <<'J'
{"issue":"AFC-5","authorAgentId":"8f6e42d7-fb6e-4e6c-904b-dfdda50000ed","claimedAt":"2026-10-06T00:00:00Z","paths":["services/directus/schema/engine/**"]}
J
  git -C "$b" add -A
  if commit_b "$b" "feat: compliance change while the guard is broken" "Issue: AFC-5
Reviewed-by: 8f6e42d7-fb6e-4e6c-904b-dfdda50000ed"; then
    echo "SELF-TEST FAIL: gate ALLOWED a commit while the guard was unparseable (did not fail closed)"
    rc=1
  else
    echo "  self-test ok: unparseable guard REFUSES the commit (fail-closed)"
  fi

  # --- an inherited, already-settled violation must not make every later
  #     innocent commit look guilty (the bare-sha ancestor-walk defect) -----
  # Built by hand rather than with make_repo, because the settled commit has to
  # be made BEFORE the hook is installed: this gate only governs what it can see
  # staged, and a history that the gate itself would have refused is not
  # "settled" -- it never happened. The real-world shape this reproduces is a
  # repository that grew a malformed claim before the gate existed (this repo has
  # one: AFC-205, author=undefined).
  c="$tmp/settled"
  mkdir -p "$c/scripts" "$c/services/directus/schema/engine" "$c/.provenance/claims" "$c/apps" "$c/hooks"
  cp "$GUARD" "$c/scripts/dirty-path-guard.sh"
  cp "$ROOT_DEFAULT/scripts/r2-grandfathered.json" "$c/scripts/r2-grandfathered.json" 2>/dev/null \
    || echo '{"grandfathered":[]}' > "$c/scripts/r2-grandfathered.json"
  cp "$SELF_FILE" "$c/scripts/merge-in-gate.sh"
  : > "$c/apps/app.ts"
  git -C "$c" init -q -b main
  git -C "$c" config user.email gate@test
  git -C "$c" config user.name gate
  git -C "$c" add -A && git -C "$c" commit -qm "chore: scaffold"
  # The settled, now-ungoverned history: a compliance change with a malformed
  # claim. No hook is installed yet, so git does what git does.
  echo 'CREATE TABLE old(i int);' > "$c/services/directus/schema/engine/old.sql"
  cat > "$c/.provenance/claims/AFC-OLD.json" <<'J'
{"issue":"AFC-OLD","paths":["services/directus/schema/engine/**"]}
J
  git -C "$c" add -A && git -C "$c" commit -qm "feat: historical change with a malformed claim" -m "Issue: AFC-OLD" >/dev/null 2>&1
  # NOW install the gate.
  cat > "$c/hooks/commit-msg" <<EOF
#!/usr/bin/env bash
exec bash "$c/scripts/merge-in-gate.sh" "\$@"
EOF
  chmod +x "$c/hooks/commit-msg"
  git -C "$c" config core.hooksPath "$c/hooks"
  # An innocent NON-compliance commit on top of that settled history.
  echo 'export const innocent = 1' > "$c/apps/innocent.ts"
  git -C "$c" add apps/innocent.ts
  if commit_b "$c" "feat(web): innocent change on top of settled history" "Issue: AFC-NEW"; then
    echo "  self-test ok: settled history does not taint a later non-compliance commit"
  else
    echo "SELF-TEST FAIL: an ancestor's settled violation refused an unrelated commit (ancestor-walk)"
    rc=1
  fi

  return $rc
}

case "${1:-}" in
  --install) install_hook ;;
  --uninstall) uninstall_hook ;;
  --self-test) self_test ;;
  --explain) explain ;;
  --help|-h) usage ;;
  # git calls a commit-msg hook with the message file path as the only argument
  # (e.g. .git/COMMIT_EDITMSG). That is a hook invocation, not a flag, so any
  # argument that is not one of our flags means "act as the hook". Only an
  # explicit --something-that-is-not-a-hook-flag is a usage error.
  -*) usage; exit 2 ;;
  *) run_as_hook "$@" ;;
esac