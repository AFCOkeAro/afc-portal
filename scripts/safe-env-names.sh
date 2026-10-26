#!/usr/bin/env bash
# safe-env-names.sh -- names-only environment diagnostics for agent runs.
#
# WHY THIS EXISTS (AFC-810). Agent tool output is captured verbatim into
# Paperclip heartbeat run logs, and the credential-surface scanner reads
# those logs with its exact known-value detector. A bare `env`, `printenv`,
# `export -p`, or `env | grep ...` in a tool call therefore echoes
# provisioned secret-store VALUES into the log corpus -- the Oct 2026 full
# run found 42 such hits (a staging username) across 8 run logs. Names are
# safe to log; values never are. So diagnostics must be names-only.
#
# WHAT IT DOES. Prints sorted exported variable NAMES, one per line. Values
# never enter the pipeline: `compgen -e` asks the shell for names only, so
# there is no `cut`/`sed` redaction step that a value could slip through.
#
# USAGE
#   bash scripts/safe-env-names.sh            # sorted exported names
#   bash scripts/safe-env-names.sh --self-test  # offline checks, no network
#
# RULE. Never run raw `env` / `printenv` / `export -p` / bare `set` in an
# agent tool call. Use this script when you need to know which variables
# exist; read a single value only through the purpose-built path (e.g. the
# scanner's memory-only secret fetch), never by dumping the environment.
set -euo pipefail

if [[ "${1:-}" == "--self-test" ]]; then
  failures=0
  # 1. Output carries no assignment shape: no `=` on any line, so no value
  #    could have ridden along.
  if compgen -e | sort | grep -q '='; then
    echo "FAIL: names output contains '=' (a value leaked into names-only output)"
    failures=$((failures + 1))
  else
    echo "ok: no '=' in names-only output"
  fi
  # 2. Output is sorted (stable, comparable across runs).
  if [[ "$(compgen -e | sort)" == "$(compgen -e | sort | sort)" ]]; then
    echo "ok: output is sorted"
  else
    echo "FAIL: output is not sorted"
    failures=$((failures + 1))
  fi
  # 3. A known-always-exported name is listed (the listing is not empty).
  if compgen -e | grep -qx 'PATH'; then
    echo "ok: PATH listed"
  else
    echo "FAIL: PATH not listed; the name listing looks broken"
    failures=$((failures + 1))
  fi
  if [[ "$failures" -gt 0 ]]; then
    echo "safe-env-names self-test FAILED ($failures failure(s))"
    exit 1
  fi
  echo "safe-env-names self-test OK"
  exit 0
fi

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  sed -n '2,/^# RULE/p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

if [[ $# -gt 0 ]]; then
  echo "safe-env-names.sh: unknown argument: $1 (want --self-test or --help)" >&2
  exit 2
fi

compgen -e | sort
