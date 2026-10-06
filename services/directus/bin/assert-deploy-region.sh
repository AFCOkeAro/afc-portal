#!/bin/sh
# ---------------------------------------------------------------------------
# DEPLOY_REGION boot assertion. AFC-211.
#
# WHY THIS EXISTS
#   ADR "Pin the production hosting region" (AFC-171) made DEPLOY_REGION the
#   single source of truth for where this deployment runs, and declared it
#   required with no default. That closed the prose leak: no document names a
#   region any more. It did not close the enforcement leak, because nothing
#   read the variable. A declared-but-unread required parameter is a comment.
#
#   This is the reader. It runs as the first thing the production stack does on
#   `docker compose up`, before any other service is allowed to start, and it
#   refuses to let the stack proceed without a well-formed value.
#
# WHERE IT LIVES, AND WHY NOT SOMEWHERE ELSE
#   The assertion is deliberately NOT in apps/web. Two reasons, and the second
#   is the one that matters:
#     1. nuxt.config.ts is another agent's in-flight change, and a boot check
#        in a file someone else is editing is a merge conflict waiting for a
#        region argument.
#     2. DEPLOY_REGION is legitimately unset in dev and in CI. A check in the
#        app's boot path would fail every developer's machine and every CI run
#        for the absence of a production-only fact. "Unset" here means "no
#        production deployment is configured", which is not an error. It is an
#        error in exactly one place: the place that IS a production
#        deployment.
#
#   So the check lives in the provisioning layer, in the one place a value can
#   be required without lying about the others.
#
# FAIL-CLOSED
#   Any outcome other than "present and well-formed" exits non-zero. There is
#   no warn mode, no bypass flag, no DEPLOY_REGION_SKIP. A guard with an
#   escape hatch is a guard that will be escaped.
#
# WHAT "WELL-FORMED" MEANS, PRECISELY
#   <ISO-3166-1 alpha-2 country code> ":" <provider location code>
#
#   country : exactly two ASCII letters, either case. The comparison is
#             case-insensitive because ISO 3166-1 publishes upper case and
#             operators will type lower case; the value is compared, never
#             rewritten.
#   colon   : exactly one, required, not optional and not repeatable.
#   location: at least one character, alphanumeric to start, then letters,
#             digits, hyphen or underscore. This admits the shapes real
#             providers actually use -- fsn1, nbg1, ash, eu-central-1,
#             eu_west_1 -- without needing to know any particular provider's
#             catalogue.
#
#   THE PLACEHOLDER IS REJECTED. "XX:yyyy" is the shape documented in
#   .env.example and it does NOT pass. Those are not codes; they are a picture
#   of the shape, and .env.example says so in as many words. A validator that
#   accepted the example would let the example become the value by copy-paste,
#   which is the exact failure mode this issue exists to prevent.
#
#   WHAT THIS DOES NOT DO, DELIBERATELY: it does not carry a list of assigned
#   ISO 3166-1 codes. That list is a country registry masquerading as a region
#   check. It would be a maintenance liability, it would need updating on every
#   IANA revision, and it would let someone read a country inventory off a
#   control that is supposed to be enforcing one operator's decision. The check
#   is syntactic: the shape is right, and a human with authority to spend chose
#   the contents. AFC-171 §6 step 3 owns that choice; this file refuses to
#   guess at it.
#
# WHAT IT PRINTS
#   The variable name, the reason, and where to set it. A failure a human
#   cannot act on without reading the source is a failure that gets worked
#   around.
# ---------------------------------------------------------------------------

# REJECTED_PLACEHOLDER_COUNTRY / _LOCATION are the tokens .env.example uses to
# draw the shape. Lower-cased for comparison; the value itself is never
# rewritten. Kept as named variables rather than inline in the case statement
# so that the two places that must agree -- the check and the message -- read
# from one definition.
REJECTED_PLACEHOLDER_COUNTRY="xx"
REJECTED_PLACEHOLDER_LOCATION="yyyy"

fail_absent() {
  cat >&2 <<'EOF'
FATAL: DEPLOY_REGION is not set.

This stack is starting as a production deployment and it must state where it
runs before any service starts. There is no default to inherit and there is no
fallback: an unset region is exactly the gap this assertion closes.

  Set DEPLOY_REGION in services/directus/.env on the host, mode 600.
  services/directus/.env.example documents the format:

    <ISO-3166-1 alpha-2 country code>:<provider location code>

  For example the shape is "XX:yyyy". Those are not real codes -- that example
  is rejected too.

The value is chosen once, by a human with authority to spend, at the moment the
server is bought. It is not committed to this repository. ADR "Pin the
production hosting region" (AFC-171) §6 step 3.

Dev and CI are unaffected: this runs only from the production Compose stack.
EOF
  exit 78 # EX_CONFIG
}

fail_malformed() {
  _got="$1"
  _why="$2"
  cat >&2 <<EOF
FATAL: DEPLOY_REGION is malformed -- $_why

  got:      "$_got"
  expected: <ISO-3166-1 alpha-2 country code>:<provider location code>

  Set DEPLOY_REGION in services/directus/.env on the host, mode 600.
  services/directus/.env.example documents the format.

Two ASCII letters, a colon, then the provider's location code -- for example
fsn1, nbg1, ash or eu-central-1. The country half is compared case-insensitively.

The placeholder shape "XX:yyyy" from .env.example is rejected on purpose: it is
a picture of the format, not a decision about where the data lives.

The value is chosen by a human at the point the server is bought. ADR "Pin the
production hosting region" (AFC-171) §6 step 3.
EOF
  exit 78 # EX_CONFIG
}

assert_deploy_region() {
  # Unset and empty are the same failure. An operator who writes
  # DEPLOY_REGION= with nothing after it has not set it, and treating that as a
  # distinct case would mean someone eventually gets to handle it.
  if [ -z "${DEPLOY_REGION:-}" ]; then
    fail_absent
  fi

  # Exactly one colon. Two colons is not a location code with a colon in it.
  _colons=$(printf '%s' "$DEPLOY_REGION" | tr -cd ':' | wc -c | tr -d ' ')
  if [ "$_colons" != "1" ]; then
    fail_malformed "$DEPLOY_REGION" "expected exactly one ':' separator, found $_colons"
  fi

  _country=$(printf '%s' "$DEPLOY_REGION" | cut -d: -f1)
  _location=$(printf '%s' "$DEPLOY_REGION" | cut -d: -f2)

  # Two ASCII letters. LC_ALL=C so that [a-z] cannot match a byte that is not
  # an ASCII letter -- a Turkish dotless i in a locale would otherwise widen
  # the character class this check exists to hold narrow.
  _country_lc=$(printf '%s' "$_country" | tr 'A-Z' 'a-z')
  case "$_country_lc" in
    [a-z][a-z]) ;;
    *) fail_malformed "$DEPLOY_REGION" "the country half must be exactly two ASCII letters" ;;
  esac

  if [ "$_country_lc" = "$REJECTED_PLACEHOLDER_COUNTRY" ]; then
    fail_malformed "$DEPLOY_REGION" "'XX' is the placeholder from .env.example, not a country code"
  fi

  case "$_location" in
    "" | [!A-Za-z0-9]* | *[!A-Za-z0-9_-]*)
      fail_malformed "$DEPLOY_REGION" "the location half must be non-empty and use only letters, digits, '-' or '_'"
      ;;
  esac

  case "$_location" in
    "$REJECTED_PLACEHOLDER_LOCATION" | [Yy][Ee][Aa][Rr])
      fail_malformed "$DEPLOY_REGION" "'yyyy' is the placeholder from .env.example, not a provider location code"
      ;;
  esac
}

# ---------------------------------------------------------------------------
# --self-test
#
# The house pattern: a guard nobody has watched fail is untested, not enforced
# (scripts/dirty-path-guard.sh, scripts/retention-literal-gate.sh). Every
# branch below asserts an exact exit code AND that the message names
# DEPLOY_REGION, because a guard that exits 1 for the wrong reason -- a syntax
# error in the gate itself -- passes a test that only checks "non-zero".
#
# The accept-branch fixtures deliberately use "QQ", which is not an assigned
# ISO 3166-1 alpha-2 code, so this file can prove it accepts a well-formed
# value without naming a region anywhere. Nothing here is a deployment.
# ---------------------------------------------------------------------------
run_self_test() {
  _pass=0
  _fail=0
  # Resolve the gate from $0 rather than from a sibling with a hard-coded name.
  # Copying this file to /tmp/broken.sh to watch the self-test go red is the
  # only way to know the self-test can fail, and a self-test that only works
  # at its own path cannot be run that way.
  _self=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/$(basename -- "$0")

  check_rejects() {
    # check_rejects <label> <value|"@unset">
    _label="$1"
    _value="$2"
    if [ "$_value" = "@unset" ]; then
      _out=$(env -u DEPLOY_REGION sh "$_self" 2>&1)
    else
      _out=$(DEPLOY_REGION="$_value" sh "$_self" 2>&1)
    fi
    _rc=$?
    if [ "$_rc" -ne 78 ]; then
      printf 'SELF-TEST FAIL: %s -- expected exit 78, got %s\n' "$_label" "$_rc" >&2
      _fail=$((_fail + 1))
      return
    fi
    case "$_out" in
      *DEPLOY_REGION*) ;;
      *)
        printf 'SELF-TEST FAIL: %s -- message does not name DEPLOY_REGION\n' "$_label" >&2
        _fail=$((_fail + 1))
        return
        ;;
    esac
    _pass=$((_pass + 1))
    printf '  ok   rejects %s\n' "$_label"
  }

  check_accepts() {
    _label="$1"
    _value="$2"
    _out=$(DEPLOY_REGION="$_value" sh "$_self" 2>&1)
    _rc=$?
    if [ "$_rc" -ne 0 ]; then
      printf 'SELF-TEST FAIL: %s -- expected exit 0, got %s\n%s\n' "$_label" "$_rc" "$_out" >&2
      _fail=$((_fail + 1))
      return
    fi
    _pass=$((_pass + 1))
    printf '  ok   accepts %s\n' "$_label"
  }

  printf 'DEPLOY_REGION assertion self-test\n'

  # --- reject branch -------------------------------------------------------
  check_rejects "unset (the AC2 case)" "@unset"
  check_rejects "empty string" ""
  check_rejects "the .env.example placeholder XX:yyyy (AC3)" "XX:yyyy"
  check_rejects "placeholder, lower case" "xx:yyyy"
  check_rejects "placeholder, mixed case" "Xx:YyYy"
  check_rejects "placeholder country alone" "XX:fsn1"
  check_rejects "placeholder location alone" "QQ:yyyy"
  check_rejects "no separator" "QQfsn1"
  check_rejects "two separators" "QQ:fsn1:extra"
  check_rejects "one-letter country" "Q:fsn1"
  check_rejects "three-letter country" "QQQ:fsn1"
  check_rejects "numeric country" "12:fsn1"
  check_rejects "empty location" "QQ:"
  check_rejects "location starting with a hyphen" "QQ:-fsn1"
  check_rejects "location with a space" "QQ:fsn 1"
  check_rejects "location with a slash" "QQ:fsn/1"
  check_rejects "location with a dollar sign" 'QQ:$HOME'

  # --- accept branch -------------------------------------------------------
  check_accepts "upper-case country" "QQ:abcd"
  check_accepts "lower-case country (case-insensitive per spec)" "qq:abcd"
  check_accepts "mixed-case country" "Qq:abcd"
  check_accepts "digits in location" "QQ:fsn1"
  check_accepts "hyphen in location" "QQ:eu-central-1"
  check_accepts "underscore in location" "QQ:eu_west_1"

  printf '%s self-test: %s passed, %s failed\n' \
    "$(basename -- "$0")" "$_pass" "$_fail"
  [ "$_fail" -eq 0 ]
}

case "${1:-}" in
  --self-test)
    run_self_test
    ;;
  "" | -h | --help)
    assert_deploy_region
    ;;
  *)
    printf 'usage: %s [--self-test]\n\nAsserts DEPLOY_REGION is present and well-formed.\nExits 78 with a message naming the variable if it is not.\n' \
      "$(basename -- "$0")" >&2
    exit 64 # EX_USAGE
    ;;
esac
