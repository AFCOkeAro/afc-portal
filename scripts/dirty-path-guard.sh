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
# TWO MODES
#   (default, no args)   guard()      -- is the WORKING TREE clean on the
#                                        compliance path?
#   --check-commit [REV] check_commit() -- does COMMIT REV touch a compliance
#                                        path without a registered claim and a
#                                        reviewer?
#
#   The refusal is the product. A dirty-tree refusal cannot refuse a good-faith
#   commit that includes a file it has no way to attribute -- that needs
#   attribution, which needs isolation. Until isolation lands, this is the only
#   control standing, so both modes refuse and neither has a bypass.
#
# THE CLAIM REGISTRY  (.provenance/claims/<ISSUE>.json)
#   R1 of the provenance rule: every change lands on an issue with a named
#   author, or it does not land. A boolean answer cannot express that, so the
#   guard emits and reads a registry instead of a verdict. One file per claiming
#   issue, written by the run that owns the work, so the isolation layer in
#   step 2 has a machine-readable provenance source rather than a git log.
#
#   {
#     "issue":        "AFC-175",
#     "authorAgentId":"<agent-uuid>",
#     "claimedAt":    "2026-10-06T02:57:00Z",
#     "paths":        ["scripts/dirty-path-guard.sh", ".provenance/claims/**"]
#   }
#
#   `paths` are glob patterns, repo-relative, matched with fnmatch semantics.
#   A claim is an assertion by a run about its own work. It is not a licence:
#   it cannot make an unreviewed commit reviewable, and it cannot exempt a file
#   from the literal gate. It answers "who claims this", not "is this correct".
#   R4 says CI is the second reviewer for every mechanically checkable control;
#   the registry is how a claim becomes something CI can check.
#
#   The registry is NOT an allowlist for the dirty-tree guard. It is not read in
#   that mode at all. A quarantined file stays refused.
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

# R2 of the provenance rule: the paths where a commit needs a named reviewer.
# This is NOT the same list as GUARDED_PATHS. bootstrap/ is on the compliance
# path for dirty-state purposes but is not in R2, and R2 names
# scripts/retention-literal-gate.sh specifically rather than all of scripts/.
# Two lists, two different rules; conflating them would either under-scope R2 or
# over-scope the dirty guard. Kept separate on purpose.
REVIEW_REQUIRED_PATHS=(
  "services/directus/schema/engine/**"
  "services/directus/schema/migrations/**"
  "tests/db/**"
  "scripts/retention-literal-gate.sh"
)

CLAIMS_DIR=".provenance/claims"

# fnmatch-ish: '*' matches within a path segment, '**' matches across them.
glob_match() {
  local pat="$1" str="$2"
  # BASH GLOB IS NOT A REGEX ENGINE, AND `**` IS NOT A THING IN IT.
  #
  # In a [[ x == pattern ]] test there is exactly one wildcard, '*', and it
  # already crosses '/'. So '*' and '**' are the same thing in this engine and
  # collapsing a run of stars to one is not a simplification -- it is the
  # correct translation of git's '**' into the engine that is actually here.
  # A trailing '/' is given the same treatment, since "everything under dir" is
  # what every directory pattern in this file means.
  #
  # This replaces a sed pipeline that was wrong three ways, each independently
  # sufficient to make the R2 check refuse to see anything:
  #   '**' -> '.*'    demanded a literal '.' straight after the prefix, so
  #                   'tests/db/**' matched tests/db/.hidden and NOTHING else.
  #                   Not one real test file has a leading dot.
  #   '*'  -> '[^/]*' a REGEX bracket expression, which bash glob reads as the
  #                   character class "none of ^, / or \". Wrong vocabulary.
  #   the subject was regex-escaped, inserting backslashes that the pattern
  #                   could not then match -- so even a correct pattern failed.
  #
  # MEASURED on this repository's own history, before the fix: check_commit()
  # flagged zero paths across all 11 commits, printed no COMMIT line at all, and
  # exited 0 -- while d76d03f and 65e7631 both touch the compliance path and
  # carry no Reviewed-by trailer. The gate reported the absence of the violation
  # it exists to detect. A gate that cannot see its own defect is worse than no
  # gate, because a green exit gets read as assurance.
  #
  # Caught by assertions 9a, 9b and 9e, all three of which were failing against
  # this defect. A self-test that fails is doing its job. A self-test nobody ran
  # is not a self-test.
  while [[ "$pat" == *"**"* ]]; do pat="${pat//\*\*/\*}"; done
  [[ "$pat" == */ ]] && pat="${pat}*"
  # shellcheck disable=SC2053
  [[ "$str" == $pat ]]
}

review_required() {
  local path="$1" p
  for p in "${REVIEW_REQUIRED_PATHS[@]}"; do
    glob_match "$p" "$path" && return 0
  done
  return 1
}

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

  # 9. COMMIT SHAPE. A compliance-path commit that is clean, carries a reviewer,
  #    carries an issue, and still contains code a different agent wrote mid-run.
  #
  #    This is the shape per-issue workspaces make unrepresentable, and the shape
  #    the shared tree produces constantly. Until isolation lands, the gate can
  #    catch it only as a CLAIM MISMATCH: the commit says it is issue X, and the
  #    registered claim for X does not cover one of the paths it touches. That is
  #    detectable. It is NOT the same as detecting the real thing, and the
  #    self-test says so -- a check that pretends to close the gap is worse than
  #    an honest one, because it retires the reason to build isolation.
  mkdir -p "$repo/.provenance/claims"
  printf 'SELECT 4;\n' > "$repo/tests/db/70_agent_b.sql"

  # 9a. A compliance-path commit with NO claim, no reviewer, no issue MUST fail.
  git -C "$repo" add -A
  git -C "$repo" commit -q -m "feat(retention): something nobody claimed"
  if check_commit "$repo" "HEAD^..HEAD" >/dev/null 2>&1; then
    echo "SELF-TEST FAIL: commit check accepted an unclaimed compliance-path commit"
    rc=1
  else
    echo "  self-test ok: unclaimed compliance-path commit rejected"
  fi

  # 9b. A claim that names a DIFFERENT issue than the commit MUST fail. This is
  #     the mid-run cross-contamination shape: the commit is attributed to issue
  #     X, but the file it carries belongs to Y's claim.
  #
  #     The commit MUST carry its own R2 file. It did not originally, so the
  #     commit under test touched nothing on the compliance path, check_commit
  #     found no violation in it, and the assertion went green while inspecting
  #     the PREVIOUS step's commit -- which 9a had deliberately made violating.
  #     A green assertion that proves nothing about its own subject is worse
  #     than a red one, so 71_agent_b.sql exists to give 9b something to fail
  #     on. Each step now also checks exactly one commit, via HEAD^..HEAD.
  printf 'SELECT 5;\n' > "$repo/tests/db/71_agent_b.sql"
  cat > "$repo/.provenance/claims/AFC-999.json" <<'JSON'
{ "issue": "AFC-999", "authorAgentId": "agent-elsewhere",
  "claimedAt": "2026-10-06T02:57:00Z", "paths": ["tests/db/10_insert_contract.sql"] }
JSON
  git -C "$repo" add -A
  git -C "$repo" commit -q -m "feat(retention): claim mismatch

Issue: AFC-999
Reviewed-by: Someone
"
  out=$(check_commit "$repo" "HEAD^..HEAD" 2>&1)
  if [ $? -eq 0 ]; then
    echo "SELF-TEST FAIL: commit check accepted a compliance-path commit no claim covers"
    rc=1
  elif ! printf '%s' "$out" | grep -q '71_agent_b.sql'; then
    echo "SELF-TEST FAIL: commit check failed without naming the unclaimed path"
    echo "$out" | sed 's/^/    /'
    rc=1
  else
    echo "  self-test ok: mid-run cross-contamination shape caught by claim mismatch"
  fi

  # 9c. Claimed AND reviewed AND clean MUST pass, or the check is useless.
  cat > "$repo/.provenance/claims/AFC-999.json" <<'JSON'
{ "issue": "AFC-999", "authorAgentId": "agent-elsewhere",
  "claimedAt": "2026-10-06T02:57:00Z", "paths": ["tests/db/**", ".provenance/**"] }
JSON
  git -C "$repo" add -A
  git -C "$repo" commit -q -m "feat(retention): now claimed and reviewed

Issue: AFC-999
Reviewed-by: Someone
"
  if check_commit "$repo" "HEAD^..HEAD" >/dev/null 2>&1; then
    echo "  self-test ok: claimed, reviewed, clean compliance-path commit accepted"
  else
    echo "SELF-TEST FAIL: commit check rejected a properly claimed and reviewed commit"
    rc=1
  fi

  # 9d. A NON-compliance commit MUST need neither. Otherwise every commit in the
  #     repo carries two trailers and the rule stops meaning anything.
  printf 'print("ui")\n' > "$repo/apps/web/other.vue"
  git -C "$repo" add -A
  git -C "$repo" commit -q -m "feat(web): ordinary change, no trailers"
  if check_commit "$repo" "HEAD^..HEAD" >/dev/null 2>&1; then
    echo "  self-test ok: non-compliance commit needs no claim and no reviewer"
  else
    echo "SELF-TEST FAIL: commit check demanded a reviewer for a non-compliance commit"
    rc=1
  fi

  # 9e. THE DOTTED-FILENAME REGRESSION. glob_match() used to regex-escape its
  #     SUBJECT, which turned every '.' in a filename into a literal
  #     backslash-dot. "tests/db/**" then matched no real test file at all,
  #     check_commit() flagged nothing, and it exited 0 on a history that really
  #     did hold two commits with no Reviewed-by trailer. Asserted against the
  #     real filename from that history rather than a synthetic one, because the
  #     dot is the whole cause.
  #
  #     The second half matters as much as the first: a matcher that flags
  #     everything under tests/db/ would pass assertion one and refuse every
  #     legitimate commit, so prove it discriminates a single character.
  if review_required "tests/db/60_retention_due_date.sql"; then
    if review_required "tests/assert.sql"; then
      # The discriminator is the DIRECTORY, not the dot. 'tests/' is guarded for
      # dirt (is__guarded, prefix match) but is NOT on the R2 list, which names
      # tests/db/**. A matcher loose enough to satisfy the first assertion by
      # claiming all of tests/ would demand a reviewer for every test helper in
      # the repo, so prove the boundary is respected.
      echo "SELF-TEST FAIL: review_required flagged tests/assert.sql; R2 names tests/db/**, not tests/"
      rc=1
    elif review_required "scripts/dirty-path-guard.sh"; then
      # The sharpest instance of the two-lists decision: this file lives under
      # scripts/, which the DIRTY guard covers, but R2 names
      # scripts/retention-literal-gate.sh specifically. Conflating them would
      # demand a reviewer on every script in the repo.
      echo "SELF-TEST FAIL: review_required flagged scripts/dirty-path-guard.sh; R2 names one script, not scripts/"
      rc=1
    elif review_required "docs/adr/ADR-0003-control-suite-real-engine.md"; then
      echo "SELF-TEST FAIL: review_required flagged a path outside the R2 list"
      rc=1
    elif ! review_required "services/directus/schema/migrations/rollback/x.down.sql"; then
      # ...and '**' must still cross a '/', or a rollback script written during
      # an incident is unreviewable, which is the exact moment review matters.
      echo "SELF-TEST FAIL: review_required did not match a nested path under migrations/**"
      rc=1
    else
      echo "  self-test ok: dotted compliance-path filename matched; R2 boundaries respected"
    fi
  else
    echo "SELF-TEST FAIL: review_required did not match tests/db/60_retention_due_date.sql"
    rc=1
  fi

  # 10. Not a git repository MUST exit 2, not 0.
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

# ---------------------------------------------------------------------------
# Claim registry: emit + read.
# ---------------------------------------------------------------------------
emit_claims() {
  local root="${1:-$ROOT_DEFAULT}"
  echo "claims registry:"
  local f
  if [ -d "$root/$CLAIMS_DIR" ]; then
    for f in "$root/$CLAIMS_DIR"/*.json; do
      [ -e "$f" ] || continue
      echo "  ${f#"$root/"}"
      node -e '
        const d=require(process.argv[1]);
        const p=(d.paths||[]).join(" ");
        process.stdout.write(`    issue=${d.issue} author=${d.authorAgentId} paths=${p}\n`);
      ' "$f" 2>/dev/null || echo "    UNREADABLE (not valid JSON) -- treated as no claim"
    done
  else
    echo "  (none)"
  fi
}

# Does any registered claim cover this path?
claimed_by() {
  local root="$1" path="$2"
  [ -d "$root/$CLAIMS_DIR" ] || return 1
  local f
  for f in "$root/$CLAIMS_DIR"/*.json; do
    [ -e "$f" ] || continue
    node -e '
      const fs=require("fs");
      let d; try { d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); } catch { process.exit(1); }
      const path=process.argv[2];
      const globs=d.paths||[];
      const toRe=(g)=>new RegExp("^"+g.replace(/\*\*/g,"\u0000").replace(/\*/g,"[^/]*").replace(/\u0000/g,".*")+"$");
      if(globs.some((g)=>toRe(g).test(path))) { process.stdout.write(d.issue||""); process.exit(0); }
      process.exit(1);
    ' "$f" "$path" && return 0
  done
  return 1
}

# ---------------------------------------------------------------------------
# Commit check. R1 (a registered claim) + R2 (a named reviewer).
# ---------------------------------------------------------------------------
check_commit() {
  local root="${1:-$ROOT_DEFAULT}" range="${2:-HEAD}"
  local rc=0
  local rev subject body
  local -a revs
  mapfile -t revs < <(git -C "$root" rev-list "$range" 2>/dev/null) || {
    echo "DIRTY-GUARD FAIL: cannot resolve revision range '$range'."
    return 2
  }
  [ "${#revs[@]}" -gt 0 ] || { echo "no commits in '$range'"; return 0; }

  echo "claim check on $(printf '%s ' "${revs[@]}")"
  emit_claims "$root"

  for rev in "${revs[@]}"; do
    subject=$(git -C "$root" log -1 --format=%s "$rev")
    body=$(git -C "$root" log -1 --format=%B "$rev")

    local -a touched=()
    mapfile -t touched < <(git -C "$root" diff-tree --no-commit-id --name-only -r "$rev")
    local -a flagged=()
    local p
    for p in ${touched+"${touched[@]}"}; do
      review_required "$p" && flagged+=("$p")
    done
    [ "${#flagged[@]}" -eq 0 ] && continue

    echo "COMMIT ${rev:0:12} $subject"
    echo "  touches the R2 compliance path:"
    for p in "${flagged[@]}"; do echo "    $p"; done

    # R2 -- named reviewer, as a trailer.
    local reviewer
    reviewer=$(printf '%s
' "$body" | sed -n 's/^Reviewed-by:[[:space:]]*//p' | head -1)
    if [ -z "$reviewer" ]; then
      echo "  R2 VIOLATION: no 'Reviewed-by:' trailer."
      echo "    A compliance-path commit needs a named reviewer. Add:"
      echo "        Reviewed-by: <agent or reviewer>"
      rc=1
    else
      echo "  ok  Reviewed-by: $reviewer"
    fi

    # R1 -- a registered claim covering every flagged path, and the commit
    # naming the claiming issue.
    for p in "${flagged[@]}"; do
      local claim
      if ! claim=$(claimed_by "$root" "$p"); then
        echo "  R1 VIOLATION: no registered claim covers $p"
        echo "    Add $CLAIMS_DIR/<ISSUE>.json listing it, then re-run."
        rc=1
        continue
      fi
      echo "  ok  claimed by $claim -> $p"
    done

    local issue
    issue=$(printf '%s
' "$body" | sed -n 's/^Issue:[[:space:]]*//p' | head -1)
    if [ -z "$issue" ]; then
      echo "  R1 VIOLATION: no 'Issue:' trailer, so the commit names no originating issue."
      rc=1
    else
      echo "  ok  Issue: $issue"
    fi
  done

  if [ "$rc" -eq 1 ]; then
    cat <<'MSG'

FAIL: a compliance-path commit has no registered claim or no named reviewer.

This is R1 and R2 of the provenance rule, checked mechanically because R4 makes
CI the second reviewer for every control a machine can decide.

  - R1: every change lands on an issue with a named author, or it does not
    land. Register the claim in .provenance/claims/<ISSUE>.json and add an
    `Issue:` trailer.
  - R2: a commit touching the compliance path carries a `Reviewed-by:` trailer.

A claim registry entry asserts who wrote the change. It is not a substitute for
a review, and it cannot exempt anything from the retention-literal gate.
MSG
  fi
  return "$rc"
}

if [ "${1:-}" = "--self-test" ]; then
  echo "Dirty-path guard self-test"
  self_test
  exit $?
fi

case "${1:-}" in
  "")                 guard "${2:-$ROOT_DEFAULT}"; exit $? ;;
  "--check-commit")   check_commit "${2:-$ROOT_DEFAULT}" "${3:-HEAD}"; exit $? ;;
  "--claims")         emit_claims "${2:-$ROOT_DEFAULT}"; exit 0 ;;
  --self-test)        : ;;
  *) echo "usage: $0 [--self-test|--claims|--check-commit [REV]]" >&2; exit 2 ;;
esac