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
#   The registry is read in --check-commit mode for two things.
#
#   R1 -- `paths`: which claim covers which file.
#   R2 -- `reviews[]`: a review that happened but left no trailer on the commit.
#
#     {
#       "reviews": [{
#         "commit":                 "<full sha>",
#         "reviewIssue":            "AFC-197",
#         "reviewerAgentId":        "<agent-uuid>",
#         "reviewerName":           "Coder",
#         "verdict":                "ship with fixes",
#         "findings":               "F1-F6",
#         "trailerPresentOnCommit": false
#       }]
#     }
#
#   R2 has two acceptable forms (AFC-194 section 8.4, CEO ruling 2026-10-06):
#   a `Reviewed-by:` trailer, OR an entry like the one above. A claim entry
#   counts only when it names the commit sha, a review issue, a reviewer and a
#   verdict. An entry missing any of those is a VIOLATION, not a skip -- a
#   partial entry that counted would let the registry certify commits nobody
#   read, which is the exact failure the registry exists to prevent.
#
#   The record is stronger than the trailer it substitutes for: a trailer names
#   a person, this names a person, an issue, a verdict and the findings.
#   `trailerPresentOnCommit: false` keeps the deviation declared rather than
#   hidden.
#
# THE R2 GRANDFATHER LIST  (scripts/r2-grandfathered.json)
#   Three commits are exempt from R2 with the reason attached, by CEO ruling:
#   they have no recorded review, and adding one retroactively would be a
#   fabrication. The file is named and auditable rather than a mystery, and the
#   exemption PRINTS every time it is used.
#
#   It is deliberately under scripts/, which is a DIRTY-guarded prefix. An
#   exemption list that no gate watches is a back door with a changelog: adding
#   an entry to an unguarded file would silence R2 for any commit in history.
#   Here, editing it is itself an unreviewed compliance-path change until it is
#   committed.
#
#   Fail-closed: no file, or no entries, means no exemption. A missing file can
#   only make the gate stricter.
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

# The R2 grandfather list. Lives under scripts/ on purpose -- see the header.
GRANDFATHERED_FILE="scripts/r2-grandfathered.json"

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

# ---------------------------------------------------------------------------
  # 9f-9k. R2 FORM 2 -- THE CLAIM REGISTRY AS A REVIEW RECORD.
  #
  #     Shape, and why these assertions are grouped the way they are.
  #
  #     ONE compliance-path commit, created once and inspected repeatedly. Its
  #     sha is fixed the moment it lands, so every fixture below is a variation
  #     of what the registry says about that same sha. That ordering is forced:
  #     a reviews[] entry must name the commit it reviewed, so it is written
  #     AFTER the commit -- exactly how .provenance/claims/AFC-167.json and
  #     AFC-193.json came to exist under AFC-195.
  #
  #     The commit carries an `Issue:` trailer and sits under a registered
  #     claim, so R1 is clean throughout and every red below is R2 and nothing
  #     else. A test that can fail for two reasons proves nothing about either.
  #
  #     Each inspection is scoped to "$rev9f^..$rev9f". A bare sha passed as the
  #     range makes git rev-list walk every ancestor, and these assertions would
  #     then be reporting on commits planted by earlier steps -- a green check
  #     that proves nothing about its own subject.
  printf 'SELECT 6;\n' > "$repo/tests/db/72_record_under_test.sql"
  git -C "$repo" add -A
  git -C "$repo" commit -q -m "feat(retention): the commit every R2 form-2 fixture reads

Issue: AFC-998
"
  local rev9f
  rev9f=$(git -C "$repo" rev-parse HEAD)
  local rev_range="$rev9f^..$rev9f"

  # The reviews[] entry the fixture will carry for $rev9f.
  #   $1 = a field name to omit, or "NONE" for an empty reviews[] array.
  write_claim_996() {
    node -e '
      const fs = require("fs");
      const out = process.argv[1], sha = process.argv[2], drop = process.argv[3];
      const entry = {
        commit: sha,
        reviewIssue: "AFC-995",
        reviewerAgentId: "agent-reviewer",
        verdict: "approve",
        findings: "F1"
      };
      const claim = {
        issue: "AFC-996",
        authorAgentId: "agent-author",
        claimedAt: "2026-10-06T02:57:00Z",
        paths: ["tests/db/**", ".provenance/**"]
      };
      if (drop === "NONE") {
        claim.reviews = [];
      } else {
        if (drop) delete entry[drop];
        claim.reviews = [entry];
      }
      fs.writeFileSync(out, JSON.stringify(claim, null, 2) + "\n");
    ' "$repo/.provenance/claims/AFC-996.json" "$rev9f" "${1:-}"
  }

  # 9f. A COMPLETE reviews[] entry MUST satisfy R2 on a commit with no trailer.
  #
  #     This is the whole of Option A. AFC-197's verdict on d76d03f is a real
  #     review and the trailer cannot be added without rewriting the commit, so
  #     a finished review that left no trailer has to count. If this ever goes
  #     red the honest options are a history rewrite or a rule change -- not a
  #     quieter gate.
  write_claim_996 ""
  git -C "$repo" add -A
  git -C "$repo" commit -q -m "chore(provenance): record the review of 72_record_under_test"
  out=$(check_commit "$repo" "$rev_range" 2>&1)
  if [ $? -ne 0 ]; then
    echo "SELF-TEST FAIL: a complete reviews[] entry did not satisfy R2"
    echo "$out" | sed 's/^/    /'
    rc=1
  elif ! printf '%s' "$out" | grep -q 'R2 review record'; then
    echo "SELF-TEST FAIL: commit passed, but not via the claim-file review record"
    echo "$out" | sed 's/^/    /'
    rc=1
  elif ! printf '%s' "$out" | grep -q 'AFC-995'; then
    echo "SELF-TEST FAIL: review record accepted without printing the review issue"
    echo "$out" | sed 's/^/    /'
    rc=1
  else
    echo "  self-test ok: complete claim-file review record accepted with no trailer"
  fi

  # 9g. THE LOAD-BEARING ASSERTION. A reviews[] entry missing ANY ONE of the
  #     four required fields MUST be a violation -- not a pass, not a skip.
  #
  #     A gate that accepts a partial entry is worse than one that ignores the
  #     registry outright: it would print "ok" for a commit the registry says
  #     nothing about, and the claim file would then be the reason nobody
  #     noticed. Four drops, four violations.
  local fld
  for fld in commit reviewIssue reviewerAgentId verdict; do
    write_claim_996 "$fld"
    git -C "$repo" add -A
    git -C "$repo" commit -q -m "chore(provenance): drop $fld from the review record fixture"
    out=$(check_commit "$repo" "$rev_range" 2>&1)
    if [ $? -eq 0 ]; then
      echo "SELF-TEST FAIL: a reviews[] entry missing '$fld' was accepted as a review"
      echo "$out" | sed 's/^/    /'
      rc=1
    elif ! printf '%s' "$out" | grep -q "INCOMPLETE\|missing $fld\|no 'Reviewed-by:' trailer"; then
      # Two legitimate routes to one verdict. An entry that still names this sha
      # but lacks a field is reported as INCOMPLETE and the field is named.
      # Dropping `commit` itself leaves an entry that names nothing at all, so
      # it surfaces as an absent record -- same violation, different route.
      # Asserting the verdict rather than the wording keeps this test about the
      # gate's decision and not about my phrasing.
      echo "SELF-TEST FAIL: missing '$fld' was rejected without saying why"
      echo "$out" | sed 's/^/    /'
      rc=1
    else
      echo "  self-test ok: reviews[] missing '$fld' rejected"
    fi
  done

  # 9h. NEITHER trailer NOR record still fails. The positive case must not have
  #     made the gate permissive: a compliance-path commit with nothing behind
  #     it is the original violation and has to stay one.
  #
  #     The claim keeps its file and an EMPTY reviews[] array, so this also
  #     proves an empty array is not mistaken for a review. Deleting the file
  #     would have tested a different thing.
  write_claim_996 "NONE"
  git -C "$repo" add -A
  git -C "$repo" commit -q -m "chore(provenance): empty the review record fixture"
  out=$(check_commit "$repo" "$rev_range" 2>&1)
  if [ "$?" -eq 0 ]; then
    echo "SELF-TEST FAIL: a commit with neither trailer nor record passed"
    echo "$out" | sed 's/^/    /'
    rc=1
  elif ! printf '%s' "$out" | grep -q "no 'Reviewed-by:' trailer"; then
    echo "SELF-TEST FAIL: unreviewed commit failed without the R2 explanation"
    echo "$out" | sed 's/^/    /'
    rc=1
  else
    echo "  self-test ok: no trailer and no record still fails, and says why"
  fi

  # 9i. A GRANDFATHERED sha passes AND PRINTS ITS REASON.
  #
  #     The printing IS the assertion, not a nicety. An exemption that is
  #     silent is indistinguishable from a clean pass to anyone reading CI,
  #     which is precisely how a grandfathered commit becomes an invisible hole.
  #     The output has to carry GRANDFATHERED and the reason, every single time.
  #
  #     The claim above is already empty, so this is the only thing standing
  #     between the commit and a violation -- which is also the real-world shape:
  #     an exemption is consulted precisely when nothing else would pass.
  cat > "$repo/$GRANDFATHERED_FILE" <<JSON
{ "entries": [
  { "commit": "$rev9f", "short": "${rev9f:0:7}",
    "reason": "No recorded review; exempt by declaration so the debt stays visible." }
] }
JSON
  git -C "$repo" add -A
  git -C "$repo" commit -q -m "chore(provenance): declare the fixture exemption"
  out=$(check_commit "$repo" "$rev_range" 2>&1)
  if [ "$?" -ne 0 ]; then
    echo "SELF-TEST FAIL: a grandfathered commit did not pass"
    echo "$out" | sed 's/^/    /'
    rc=1
  elif ! printf '%s' "$out" | grep -q 'R2 GRANDFATHERED'; then
    echo "SELF-TEST FAIL: grandfathered commit passed WITHOUT printing its status"
    echo "$out" | sed 's/^/    /'
    rc=1
  elif ! printf '%s' "$out" | grep -q 'debt stays visible'; then
    echo "SELF-TEST FAIL: grandfather status printed without the reason"
    echo "$out" | sed 's/^/    /'
    rc=1
  else
    echo "  self-test ok: grandfathered sha passes and prints its reason"
  fi

  # 9j. An exemption with NO REASON is not an exemption. Otherwise the list is
  #     just a place to add shas with no justification, which is Option C turned
  #     back into the thing C was chosen over.
  cat > "$repo/$GRANDFATHERED_FILE" <<JSON
{ "entries": [ { "commit": "$rev9f", "short": "${rev9f:0:7}", "reason": "" } ] }
JSON
  git -C "$repo" add -A
  git -C "$repo" commit -q -m "chore(provenance): unreasoned exemption fixture"
  if check_commit "$repo" "$rev_range" >/dev/null 2>&1; then
    echo "SELF-TEST FAIL: a grandfather entry with no reason was honoured"
    rc=1
  else
    echo "  self-test ok: grandfather entry without a reason refused"
  fi

  # 9k. Fail closed on a CORRUPT list. A grandfather file that will not parse
  #     must not read as "no exemptions, everything else is fine". It has to
  #     make the gate red, or a truncated file is a silent green.
  printf '{ this is not json\n' > "$repo/$GRANDFATHERED_FILE"
  git -C "$repo" add -A
  git -C "$repo" commit -q -m "chore(provenance): corrupt exemption fixture"
  if check_commit "$repo" "$rev_range" >/dev/null 2>&1; then
    echo "SELF-TEST FAIL: a corrupt grandfather list was read as valid"
    rc=1
  else
    echo "  self-test ok: corrupt grandfather list fails closed"
  fi

  rm -f "$repo/$GRANDFATHERED_FILE" "$repo/.provenance/claims/AFC-996.json"
  git -C "$repo" add -A
  git -C "$repo" commit -q -m "chore(provenance): drop the R2 form-2 fixtures"  # 10. Not a git repository MUST exit 2, not 0.
  mkdir -p "$tmp/not-a-repo"
  guard "$tmp/not-a-repo" >/dev/null 2>&1
  if [ $? -ne 2 ]; then
    echo "SELF-TEST FAIL: guard did not exit 2 outside a git repository"
    rc=1
  else
    echo "  self-test ok: non-repository fails closed with exit 2"
  fi

  # 11. THE CLI WIRING REGRESSION. AFC-212.
  #
  #     Everything above this line calls guard() and check_commit() DIRECTLY, in
  #     a throwaway repo, with arguments arranged by the caller. That is the one
  #     thing it cannot see: whether the `case` dispatcher in front of those
  #     functions passes them in the order they declare.
  #
  #     It did not. check_commit() takes (ROOT, REV); the dispatcher passed
  #     ($2, $3) into those slots, so the documented form
  #
  #         bash scripts/dirty-path-guard.sh --check-commit 84e65f7
  #
  #     put "84e65f7" in the ROOT slot. git -C "84e65f7" reads nothing, the
  #     empty rev list printed "no commits in 'HEAD'", and the guard exited 0
  #     on a history that really did hold compliance-path commits with no
  #     reviewer. Assertion 9e fixed the MATCHER; the wiring stayed reversed, so
  #     the documented command stayed green. Two commits' worth of "fixed"
  #     (b126d7d, AFC-195) and the gate never once ran through its own CLI.
  #
  #     So these three assertions invoke the script as a SUBPROCESS, by path,
  #     in a repository it can only find the way a real invocation finds it:
  #     from its own location, since ROOT_DEFAULT is derived from BASH_SOURCE.
  #     The fixture therefore has to carry the script at <repo>/scripts/, and
  #     each assertion passes ONE argument, exactly as usage: documents it.
  #
  #     Two separate repositories, not two commits in one: `rev-list <sha>`
  #     walks a commit AND ALL ITS ANCESTORS, so asserting "this sha is clean"
  #     in a repo whose parent commit is deliberately violating would exit 1
  #     for the wrong reason. One repository, one commit, one commit's history.
  #
  #     Each fixture also gets a NON-compliance commit first, so the commit
  #     under test is not the repository's ROOT commit. `git diff-tree` prints
  #     nothing for a root commit unless it is passed --root (see check_commit),
  #     so a root commit under test would be flagged by nobody and 11a would
  #     pass for the wrong reason -- the exact shape of a green assertion that
  #     proves nothing, which is how this defect survived once already.
  local cli_script="$tmp/cli-script"
  cp "$0" "$cli_script"
  chmod +x "$cli_script"

  local bad_repo="$tmp/cli-bad"
  mkdir -p "$bad_repo/scripts" "$bad_repo/tests/db" "$bad_repo/$CLAIMS_DIR"
  git -C "$bad_repo" init -q
  git -C "$bad_repo" config user.email guard@afc.test
  git -C "$bad_repo" config user.name  "AFC guard self-test"
  cp "$cli_script" "$bad_repo/scripts/dirty-path-guard.sh"
  printf '# fixture\n' > "$bad_repo/docs-notes.md"
  git -C "$bad_repo" add docs-notes.md
  git -C "$bad_repo" commit -q -m "chore: non-compliance fixture commit"
  printf 'SELECT 1;\n' > "$bad_repo/tests/db/60_cli_wiring.sql"
  cat > "$bad_repo/$CLAIMS_DIR/AFC-998.json" <<'JSON'
{ "issue": "AFC-998", "authorAgentId": "agent-elsewhere",
  "claimedAt": "2026-10-06T03:00:00Z", "paths": ["tests/db/**"] }
JSON
  # Claimed and named, but NO Reviewed-by: trailer. R1 passes on purpose, so a
  # failure here can only be R2 -- the rule the reversed wiring hid.
  git -C "$bad_repo" add -A
  git -C "$bad_repo" commit -q -m "feat(retention): planted compliance-path commit, no reviewer

Issue: AFC-998
"
  local bad_rev good_rev cli_out cli_rc
  bad_rev=$(git -C "$bad_repo" rev-parse HEAD)

  # 11a. The documented form on a commit with no reviewer MUST exit non-zero.
  cli_out=$(bash "$bad_repo/scripts/dirty-path-guard.sh" --check-commit "$bad_rev" 2>&1)
  cli_rc=$?
  if [ "$cli_rc" -eq 0 ]; then
    echo "SELF-TEST FAIL: --check-commit $bad_rev exited 0 on a commit with no reviewer"
    echo "    the CLI still does not reach check_commit(); this is AFC-212 again"
    printf '%s\n' "$cli_out" | sed 's/^/    /'
    rc=1
  elif [ "$cli_rc" -ne 1 ]; then
    # 2 means the guard could not read git state. That is a different failure
    # and a self-test that accepts it would stop noticing the wiring.
    echo "SELF-TEST FAIL: --check-commit $bad_rev exited $cli_rc, not 1"
    echo "    a non-policy failure is not evidence the R2 check ran"
    printf '%s\n' "$cli_out" | sed 's/^/    /'
    rc=1
  elif ! printf '%s' "$cli_out" | grep -q "R2 VIOLATION"; then
    echo "SELF-TEST FAIL: --check-commit exited $cli_rc without reporting an R2 violation"
    printf '%s\n' "$cli_out" | sed 's/^/    /'
    rc=1
  else
    echo "  self-test ok: documented --check-commit <REV> reached R2 and refused the commit"
  fi

  # 11b. A REV the guard cannot resolve MUST NOT exit 0. This is the exact
  #      false green AFC-212 shipped: an argument in the wrong slot is
  #      indistinguishable from an argument that means nothing. exit 2.
  cli_out=$(bash "$bad_repo/scripts/dirty-path-guard.sh" --check-commit not-a-revision 2>&1)
  cli_rc=$?
  if [ "$cli_rc" -eq 0 ]; then
    echo "SELF-TEST FAIL: --check-commit not-a-revision exited 0"
    echo "    an unresolvable REV must fail closed, never certify"
    printf '%s\n' "$cli_out" | sed 's/^/    /'
    rc=1
  else
    echo "  self-test ok: unresolvable REV fails closed (exit $cli_rc)"
  fi

  # 11c. The negative direction. A claimed, reviewed, clean compliance-path
  #      commit MUST exit 0 through the same CLI. A gate that always refuses is
  #      not a gate, and refusing everything is what a botched argument order
  #      looks like from the other side.
  local good_repo="$tmp/cli-good"
  mkdir -p "$good_repo/scripts" "$good_repo/tests/db" "$good_repo/$CLAIMS_DIR"
  git -C "$good_repo" init -q
  git -C "$good_repo" config user.email guard@afc.test
  git -C "$good_repo" config user.name  "AFC guard self-test"
  cp "$cli_script" "$good_repo/scripts/dirty-path-guard.sh"
  printf '# fixture\n' > "$good_repo/docs-notes.md"
  git -C "$good_repo" add docs-notes.md
  git -C "$good_repo" commit -q -m "chore: non-compliance fixture commit"
  printf 'SELECT 2;\n' > "$good_repo/tests/db/61_cli_clean.sql"
  cat > "$good_repo/$CLAIMS_DIR/AFC-997.json" <<'JSON'
{ "issue": "AFC-997", "authorAgentId": "agent-elsewhere",
  "claimedAt": "2026-10-06T03:00:00Z", "paths": ["tests/db/**"] }
JSON
  git -C "$good_repo" add -A
  git -C "$good_repo" commit -q -m "feat(retention): claimed and reviewed compliance-path commit

Issue: AFC-997
Reviewed-by: Someone
"
  good_rev=$(git -C "$good_repo" rev-parse HEAD)
  cli_out=$(bash "$good_repo/scripts/dirty-path-guard.sh" --check-commit "$good_rev" 2>&1)
  cli_rc=$?
  if [ "$cli_rc" -ne 0 ]; then
    echo "SELF-TEST FAIL: --check-commit $good_rev exited $cli_rc on a claimed, reviewed commit"
    echo "    the CLI must accept a clean commit, or it is not a gate"
    printf '%s\n' "$cli_out" | sed 's/^/    /'
    rc=1
  else
    echo "  self-test ok: documented --check-commit <REV> accepts a clean R2 commit"
  fi

  # 11d. A ROOT COMMIT MUST BE CHECKED LIKE ANY OTHER. `git diff-tree` prints
  #      nothing for a repository's first commit unless it is passed --root, so
  #      without that flag the first commit of any repository is invisible here:
  #      every path it adds reads as "touched nothing", the loop skips it, and
  #      the gate certifies the whole thing. This is the same failure as 11a --
  #      report nothing, exit 0 -- reached through a different door, so it needs
  #      its own assertion. Live on this repository: the root commit 1f43c9e
  #      adds ten R2 paths (four migrations, one rollback, five control-suite
  #      files) and not one of them was ever reported by --check-commit.
  #
  #      So: a repository whose ONLY commit is the one under test, and that
  #      commit adds a compliance-path file with no reviewer. Must exit 1.
  local root_repo="$tmp/cli-root"
  mkdir -p "$root_repo/scripts" "$root_repo/tests/db" "$root_repo/$CLAIMS_DIR"
  git -C "$root_repo" init -q
  git -C "$root_repo" config user.email guard@afc.test
  git -C "$root_repo" config user.name  "AFC guard self-test"
  cp "$cli_script" "$root_repo/scripts/dirty-path-guard.sh"
  printf 'SELECT 3;\n' > "$root_repo/tests/db/62_cli_root.sql"
  cat > "$root_repo/$CLAIMS_DIR/AFC-996.json" <<'JSON'
{ "issue": "AFC-996", "authorAgentId": "agent-elsewhere",
  "claimedAt": "2026-10-06T03:00:00Z", "paths": ["tests/db/**"] }
JSON
  git -C "$root_repo" add -A
  git -C "$root_repo" commit -q -m "feat(retention): repository's first commit, no reviewer

Issue: AFC-996
"
  local root_rev
  root_rev=$(git -C "$root_repo" rev-list --max-parents=0 HEAD)
  if [ "$root_rev" != "$(git -C "$root_repo" rev-parse HEAD)" ]; then
    echo "SELF-TEST FAIL: fixture 11d is not a single-commit repository"
    echo "    the assertion would be checking the wrong commit"
    rc=1
  else
    cli_out=$(bash "$root_repo/scripts/dirty-path-guard.sh" --check-commit "$root_rev" 2>&1)
    cli_rc=$?
    if [ "$cli_rc" -eq 0 ]; then
      echo "SELF-TEST FAIL: --check-commit on a repository's ROOT commit exited 0"
      echo "    git diff-tree needs --root, or the first commit is invisible"
      printf '%s\n' "$cli_out" | sed 's/^/    /'
      rc=1
    elif ! printf '%s' "$cli_out" | grep -q '62_cli_root.sql'; then
      echo "SELF-TEST FAIL: the root commit was refused without naming the path it added"
      printf '%s\n' "$cli_out" | sed 's/^/    /'
      rc=1
    else
      echo "  self-test ok: repository's root commit is checked, not skipped"
    fi
  fi

  return $rc

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

# R2 form 2: does a claim file carry a reviews[] entry that is a COMPLETE review
# record for this commit sha?
#
# Four fields are load-bearing -- sha, review issue, reviewer agent, verdict.
# A claim naming only two of them is not a review record, and treating it as
# one would let the registry certify a commit nobody read, which is the exact
# failure the registry exists to prevent. So a partial entry is a VIOLATION
# (exit 3), not a skip and not a pass.
#
# Prints "issue|reviewer|verdict|claimFile" on success.
#   0  complete review record found
#   1  no reviews[] entry for this sha at all
#   2  an entry exists but names a different sha
#   3  an entry names this sha but is missing a required field
#   4  the registry could not be read
review_record() {
  local root="$1" sha="$2"
  [ -d "$root/$CLAIMS_DIR" ] || return 1
  local f
  for f in "$root/$CLAIMS_DIR"/*.json; do
    [ -e "$f" ] || continue
    node -e '
      const fs = require("fs");
      let d;
      try { d = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
      catch { process.exit(4); }
      const sha = process.argv[2];
      const reviews = Array.isArray(d.reviews) ? d.reviews : [];
      if (reviews.length === 0) process.exit(1);

      // Prefix-match on the sha so a 7-char abbreviation in a hand-written
      // claim is still recognised, but require it to be unambiguous.
      const hits = reviews.filter((r) => r && typeof r.commit === "string" &&
        (r.commit === sha || (r.commit.length >= 7 && sha.startsWith(r.commit))));
      if (hits.length === 0) process.exit(2);

      // Best entry wins, and completeness is judged per entry rather than
      // across them: two half-populated entries do not add up to a review.
      const missing = (r) => {
        const m = [];
        if (typeof r.commit !== "string" || !r.commit) m.push("commit");
        if (typeof r.reviewIssue !== "string" || !r.reviewIssue.trim()) m.push("reviewIssue");
        if (typeof r.reviewerAgentId !== "string" || !r.reviewerAgentId.trim()) m.push("reviewerAgentId");
        if (typeof r.verdict !== "string" || !r.verdict.trim()) m.push("verdict");
        return m;
      };
      let best = null;
      for (const r of hits) {
        if (missing(r).length === 0) { best = r; break; }
        if (best === null) best = r;
      }
      const miss = missing(best);
      if (miss.length > 0) {
        process.stderr.write(`${process.argv[1]}: reviews[] entry for ${best.commit || sha} is missing ${miss.join(", ")}\n`);
        process.exit(3);
      }
      process.stdout.write([best.reviewIssue, best.reviewerAgentId, best.verdict, process.argv[1]].join("|"));
    ' "$f" "$sha"
    local rc=$?
    case "$rc" in
      0) return 0 ;;
      3) return 3 ;;
      4) return 4 ;;
      # 1 and 2 mean "this file has nothing for this commit"; keep scanning.
    esac
  done
  # Distinguish "no entry anywhere" from "entry names a different sha" only when
  # some file actually mentioned reviews at all.
  if grep -qs '"reviews"' "$root/$CLAIMS_DIR"/*.json 2>/dev/null; then return 2; fi
  return 1
}

# Is this commit R2-grandfathered? Prints the reason (and short sha) on success.
# Fail-closed: a missing or unreadable list means NO exemption, so the worst
# case for a broken list is a red gate, never a silent pass.
grandfathered_lookup() {
  local root="$1" sha="$2"
  local f="$root/$GRANDFATHERED_FILE"
  [ -f "$f" ] || return 1
  node -e '
    const fs = require("fs");
    let d;
    try { d = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
    catch { process.exit(2); }
    const sha = process.argv[2];
    const entries = Array.isArray(d.entries) ? d.entries : [];
    const hit = entries.find((e) => e && typeof e.commit === "string" &&
      (e.commit === sha || (e.commit.length >= 7 && sha.startsWith(e.commit))));
    if (!hit) process.exit(1);
    // A grandfather entry with no reason is not an exemption, it is an
    // unexplained hole. Refuse it.
    if (typeof hit.reason !== "string" || !hit.reason.trim()) process.exit(2);
    process.stdout.write([hit.short || hit.commit.slice(0, 7), hit.reason.trim()].join("|"));
  ' "$f" "$sha"
}

# ---------------------------------------------------------------------------
# Commit check. R1 (a registered claim) + R2 (a named reviewer, by trailer or
# by a complete claim-file review record, less declared exemptions).
# ---------------------------------------------------------------------------
check_commit() {
  local root="${1:-$ROOT_DEFAULT}" range="${2:-HEAD}"
  local rc=0
  local rev subject body revlist
  local -a revs

  # -------------------------------------------------------------------------
  # AFC-212 -- THE WIRING WAS STILL REVERSED AFTER b126d7d.
  #
  # check_commit() declares (ROOT, REV). The dispatcher passed ($2, $3) into
  # those two slots. usage: documents ONE argument, `--check-commit [REV]`, so
  # the documented call put the revision where ROOT goes:
  #
  #   bash scripts/dirty-path-guard.sh --check-commit 84e65f7
  #     -> check_commit "84e65f7" "HEAD"
  #
  # git -C "84e65f7" is not a repository. Its stderr was discarded, the rev list
  # came back empty, and the guard printed "no commits in 'HEAD'" and exited 0.
  # b126d7d fixed glob_match() -- the ENGINE -- and recorded that check_commit()
  # had flagged zero paths across all 11 commits. The wiring was a separate
  # defect and it stayed: the documented command certified the whole history
  # while never looking at one commit.
  #
  # MEASURED before this fix, at HEAD 876d1f6:
  #
  #   --check-commit 84e65f7      -> "no commits in 'HEAD'"    exit 0
  #   --check-commit "$PWD" HEAD  -> 13 violations             exit 1
  #
  # The count of violations was never zero. It was never being counted.
  #
  # Three changes, and each one is load-bearing:
  #
  #   1. The dispatcher passes (ROOT, REV) in the order this function declares.
  #      ROOT comes from this script's own location, as ROOT_DEFAULT always
  #      intended; $2 is the REV -- one argument, as usage: documents.
  #   2. A ROOT that is not a repository, and a range git cannot resolve, are
  #      exit 2. The old code could not tell "the range selected nothing" apart
  #      from "I read nothing at all", and answered both with exit 0: the only
  #      state in which the guard had seen nothing was the one state in which
  #      it reported everything was fine.
  #   3. diff-tree gains --root, below. A repository's first commit is
  #      otherwise invisible to this check entirely.
  #
  # And the self-test proves all three through the CLI. Every other assertion
  # in self_test() calls guard()/check_commit() directly, so it cannot see the
  # dispatcher at all; that is how this survived a fix already reported as
  # complete. Assertions 11a-11c run the script as a subprocess from inside a
  # fixture repository, with ONE argument, the way usage: says.
  # -------------------------------------------------------------------------

  # Fail closed on an unreadable ROOT, and on a range git cannot resolve.
  if ! git -C "$root" rev-parse --git-dir >/dev/null 2>&1; then
    echo "DIRTY-GUARD FAIL: '$root' is not inside a git repository."
    echo "  Refusing to certify a tree the guard cannot read."
    return 2
  fi
  if ! revlist=$(git -C "$root" rev-list "$range" 2>/dev/null); then
    echo "DIRTY-GUARD FAIL: cannot resolve revision range '$range' in $root."
    return 2
  fi
  if [ -z "$revlist" ]; then
    # Reachable only from a range that resolved and selected nothing, e.g.
    # HEAD..HEAD. A real "nothing to check", and safe to pass now that the
    # range is known to exist.
    echo "no commits in '$range'"
    return 0
  fi
  mapfile -t revs <<< "$revlist"

  echo "claim check on $(printf '%s ' "${revs[@]}")"
  emit_claims "$root"

  for rev in "${revs[@]}"; do
    subject=$(git -C "$root" log -1 --format=%s "$rev")
    body=$(git -C "$root" log -1 --format=%B "$rev")

    local -a touched=()
    mapfile -t touched < <(git -C "$root" diff-tree --root --no-commit-id --name-only -r "$rev")
    local -a flagged=()
    local p
    for p in ${touched+"${touched[@]}"}; do
      review_required "$p" && flagged+=("$p")
    done
    [ "${#flagged[@]}" -eq 0 ] && continue

    echo "COMMIT ${rev:0:12} $subject"
    echo "  touches the R2 compliance path:"
    for p in "${flagged[@]}"; do echo "    $p"; done

    # R2 -- a named reviewer. Two acceptable forms (AFC-194 section 8.4):
    #   (a) a `Reviewed-by:` trailer on the commit;
    #   (b) a claim-file reviews[] entry naming this sha, a review issue, a
    #       reviewer agent and a verdict.
    # In that order, then the declared grandfather list. (b) exists because a
    # completed review that left no trailer is a real review, and pretending
    # otherwise would make the registry the honest record of nothing.
    local reviewer record rr_rc gf gf_rc
    reviewer=$(printf '%s
' "$body" | sed -n 's/^Reviewed-by:[[:space:]]*//p' | head -1)
    if [ -n "$reviewer" ]; then
      echo "  ok  Reviewed-by: $reviewer (trailer)"
    else
      record=$(review_record "$root" "$rev")
      rr_rc=$?
      case "$rr_rc" in
        0)
          echo "  ok  R2 review record (claim registry, no trailer needed):"
          echo "        review issue: $(cut -d'|' -f1 <<<"$record")"
          echo "        reviewer:     $(cut -d'|' -f2 <<<"$record")"
          echo "        verdict:      $(cut -d'|' -f3 <<<"$record")"
          echo "        recorded in:  $(cut -d'|' -f4 <<<"$record")"
          ;;
        3)
          echo "  R2 VIOLATION: the claim registry carries a reviews[] entry for"
          echo "    this commit, but it is INCOMPLETE."
          echo "    A review record needs all four of: commit sha, reviewIssue,"
          echo "    reviewerAgentId, verdict. Missing any one is not a review -- it"
          echo "    is the shape a registry grows when it starts approving itself."
          echo "    Complete the entry in the file named above, or add a"
          echo "        Reviewed-by: <agent or reviewer>"
          echo "    trailer to the commit."
          rc=1
          ;;
        4)
          echo "  R2 VIOLATION: $CLAIMS_DIR holds a file that is not valid JSON, so"
          echo "    no review record can be read from it. Refusing to certify."
          rc=2
          ;;
        *)
          # No complete record. Try the declared exemptions before failing.
          gf=$(grandfathered_lookup "$root" "$rev")
          gf_rc=$?
          if [ "$gf_rc" -eq 0 ]; then
            local gshort greason
            gshort=$(cut -d'|' -f1 <<<"$gf")
            greason=$(cut -d'|' -f2 <<<"$gf")
            echo "  ok  R2 GRANDFATHERED: $gshort"
            echo "        No reviewer trailer and no review record -- and none will be"
            echo "        fabricated. This commit is exempt by CEO ruling of 2026-10-06"
            echo "        ($GRANDFATHERED_FILE, AFC-194 section 8.2) for this reason:"
            echo "          $greason"
            echo "        Printed on every run on purpose. A silent exemption is"
            echo "        indistinguishable from a clean pass."
          elif [ "$gf_rc" -eq 2 ]; then
            echo "  R2 VIOLATION: $GRANDFATHERED_FILE names this commit but carries"
            echo "    no reason, or is not valid JSON. An unexplained exemption is not"
            echo "    an exemption. Fix the list or add a real review record."
            rc=1
          else
            echo "  R2 VIOLATION: no 'Reviewed-by:' trailer and no complete review"
            echo "    record in $CLAIMS_DIR/*.json for ${rev:0:12}."
            echo "    A compliance-path commit needs a named reviewer. Add EITHER:"
            echo "        Reviewed-by: <agent or reviewer>"
            echo "    as a trailer, OR a reviews[] entry in the claim file naming this"
            echo "    sha with reviewIssue, reviewerAgentId and verdict. Four fields"
            echo "    or it does not count."
            rc=1
          fi
          ;;
      esac
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

  if [ "$rc" -ne 0 ]; then
    cat <<'MSG'

FAIL: a compliance-path commit has no registered claim or no named reviewer.

This is R1 and R2 of the provenance rule, checked mechanically because R4 makes
CI the second reviewer for every control a machine can decide.

  - R1: every change lands on an issue with a named author, or it does not
    land. Register the claim in .provenance/claims/<ISSUE>.json and add an
    `Issue:` trailer.
  - R2: a commit touching the compliance path names its reviewer, EITHER as a
    `Reviewed-by:` trailer, OR as a `reviews[]` entry in a claim file that
    names this sha together with a reviewIssue, a reviewerAgentId and a
    verdict. An entry missing any one of those four is a violation, not a skip.

Commits exempt from R2 are named in scripts/r2-grandfathered.json with their
reason, and print their exemption every time they are seen. There are three,
and nobody reviewed them; that is recorded rather than papered over.

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
  "--check-commit")   check_commit "$ROOT_DEFAULT" "${2:-HEAD}"; exit $? ;;
  "--claims")         emit_claims "${2:-$ROOT_DEFAULT}"; exit 0 ;;
  --self-test)        : ;;
  *) echo "usage: $0 [--self-test|--claims|--check-commit [REV]]" >&2; exit 2 ;;
esac