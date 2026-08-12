#!/bin/bash
# Runs every end-to-end suite against fresh scratch databases.
# Each suite needs its own server config, so they run one at a time.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND="$ROOT/backend"
SECRET="test_secret_local_e2e_only"
FAILED=0

start_api () {  # $1=db  $2=port  $3=extra env
  ( cd "$BACKEND" && env DATABASE_URL="postgresql://localhost/$1" JWT_SECRET="$SECRET" \
      PORT="$2" NODE_ENV=development GUEST_IP_TOKEN_CAP=0 $3 \
      npm run dev > "/tmp/e2e_$1.log" 2>&1 & )
  for _ in $(seq 1 30); do
    curl -s "http://localhost:$2/health" >/dev/null 2>&1 && return 0
    sleep 1
  done
  echo "SERVER FAILED TO START ($1)"; tail -5 "/tmp/e2e_$1.log"; return 1
}

run_suite () { # $1=db  $2=port  $3=script  $4=extra env
  pkill -f "src/index.ts" 2>/dev/null; sleep 2
  dropdb --if-exists "$1" 2>/dev/null
  createdb "$1"
  ( cd "$BACKEND" && DATABASE_URL="postgresql://localhost/$1" npm run migrate >/dev/null 2>&1 )
  start_api "$1" "$2" "$4" || { FAILED=1; return; }
  echo ""
  echo "############ $3 ############"
  ( cd "$ROOT/tests" && python3 "$3" ) || FAILED=1
  # grep -c always prints a count and exits 1 when the count is zero, so no
  # `|| echo 0` fallback — that appended a second zero and made every clean run
  # look like a failure.
  local errs
  errs=$(grep -cE "syntax error|^error:" "/tmp/e2e_$1.log" 2>/dev/null)
  errs=${errs:-0}
  echo "server SQL/unhandled errors: $errs"
  if [ "$errs" -ne 0 ]; then FAILED=1; fi
}

run_suite aa_e2e  3099 e2e-verify.py   ""
run_suite aa_smoke 3096 e2e-smoke.py   ""
run_suite aa_e2e2 3099 e2e-security.py ""
run_suite aa_e2e3 3098 e2e-scale.py    "LIVE_FEED_MAX_PARTICIPANTS=2"

pkill -f "src/index.ts" 2>/dev/null; sleep 2
dropdb --if-exists aa_e2e 2>/dev/null
dropdb --if-exists aa_e2e2 2>/dev/null
dropdb --if-exists aa_e2e3 2>/dev/null

echo ""
if [ "$FAILED" = "0" ]; then echo "OVERALL: ALL SUITES PASSED"; else echo "OVERALL: FAILURES PRESENT"; fi
exit "$FAILED"
