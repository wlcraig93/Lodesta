#!/usr/bin/env bash
set -euo pipefail

START_SERVER=0
PORT="${PORT:-4330}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --start-server)
      START_SERVER=1
      shift
      ;;
    --port)
      PORT="$2"
      shift 2
      ;;
    *)
      echo "Unknown smoke option: $1" >&2
      exit 1
      ;;
  esac
done

BASE_URL="${LODESTA_SMOKE_BASE_URL:-http://127.0.0.1:${PORT}}"
BASE_URL="${BASE_URL%/}"
SERVER_PID=""
SERVER_LOG=""
BODY=""
STATUS=""

cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  if [[ -n "$SERVER_LOG" && -f "$SERVER_LOG" ]]; then
    rm -f "$SERVER_LOG"
  fi
}
trap cleanup EXIT

if [[ "$START_SERVER" -eq 1 ]]; then
  SERVER_LOG="$(mktemp)"
  npm run dev -- -p "$PORT" -H 127.0.0.1 >"$SERVER_LOG" 2>&1 &
  SERVER_PID="$!"
fi

wait_for_server() {
  local status
  for _ in $(seq 1 60); do
    if [[ -n "$SERVER_PID" ]] && ! kill -0 "$SERVER_PID" 2>/dev/null; then
      echo "Dev server exited before becoming ready." >&2
      cat "$SERVER_LOG" >&2 || true
      exit 1
    fi
    status="$(curl -sS -o /dev/null -w "%{http_code}" "$BASE_URL/" 2>/dev/null || true)"
    if [[ "$status" =~ ^[234][0-9][0-9]$ ]]; then
      return
    fi
    sleep 0.5
  done

  echo "Timed out waiting for $BASE_URL" >&2
  if [[ -n "$SERVER_LOG" ]]; then
    cat "$SERVER_LOG" >&2 || true
  fi
  exit 1
}

request() {
  local method="$1"
  local path="$2"
  local payload="${3:-}"
  local response
  local curl_args=(-sS -w $'\n%{http_code}')

  if [[ "$method" == "POST" ]]; then
    curl_args+=(-X POST -H "content-type: application/json" -d "$payload")
  fi

  response="$(curl "${curl_args[@]}" "${BASE_URL}${path}")"
  STATUS="${response##*$'\n'}"
  BODY="${response%$'\n'*}"
}

assert_success() {
  local name="$1"
  if [[ ! "$STATUS" =~ ^2[0-9][0-9]$ ]]; then
    echo "Smoke check failed: $name returned $STATUS" >&2
    echo "$BODY" >&2
    exit 1
  fi
  echo "ok - $name"
}

assert_json() {
  local name="$1"
  local script="$2"
  BODY="$BODY" node -e "$script" || {
    echo "Smoke check failed: $name returned unexpected JSON" >&2
    echo "$BODY" >&2
    exit 1
  }
}

get_check() {
  local name="$1"
  local path="$2"
  request GET "$path"
  assert_success "$name"
}

post_check() {
  local name="$1"
  local path="$2"
  local payload="$3"
  request POST "$path" "$payload"
  assert_success "$name"
}

wait_for_server

get_check "dashboard" "/"
get_check "public site" "/sites/joes-pizza"
get_check "tokenized preview" "/preview/demo-token"
get_check "editor" "/editor/joes-pizza"
get_check "analytics dashboard" "/analytics/joes-pizza"
get_check "optimization dashboard" "/optimization/joes-pizza"
get_check "business profile" "/business/joes-pizza"
get_check "leads dashboard" "/leads/joes-pizza"
get_check "claim flow" "/claim/joes-pizza"
get_check "domain flow" "/domains/joes-pizza"
get_check "health" "/api/health"

request GET "/api/sites"
assert_success "site API"
assert_json "site API" 'const data = JSON.parse(process.env.BODY); if (!Array.isArray(data.sites) || data.sites.length === 0) process.exit(1);'

post_check "audit API" "/api/audits/run" '{"siteId":"site_joes_pizza"}'
assert_json "audit API" 'const data = JSON.parse(process.env.BODY); if (data.siteId !== "site_joes_pizza" || !Array.isArray(data.findings)) process.exit(1);'

post_check "QA API" "/api/qa/run" '{"siteId":"site_joes_pizza","versionStatus":"published"}'
assert_json "QA API" 'const data = JSON.parse(process.env.BODY); if (data.siteId !== "site_joes_pizza" || typeof data.passed !== "boolean") process.exit(1);'

post_check "analytics ingest" "/api/analytics" '{"siteId":"site_joes_pizza","sessionId":"smoke_session","pageId":"home","eventType":"pageview","event":{"path":"/sites/joes-pizza","smoke":true}}'
assert_json "analytics ingest" 'const data = JSON.parse(process.env.BODY); if (data.accepted !== true) process.exit(1);'

post_check "experiment assignment" "/api/experiments/assign" '{"siteId":"site_joes_pizza","sessionId":"smoke_session"}'
assert_json "experiment assignment" 'const data = JSON.parse(process.env.BODY); if (typeof data.assigned !== "boolean") process.exit(1);'

post_check "JSON form submission" "/api/forms/submit" '{"siteId":"site_joes_pizza","formId":"form_contact","pageId":"home","sessionId":"smoke_session","sourceUrl":"http://127.0.0.1:4330/sites/joes-pizza","payload":{"name":"Smoke Test","email":"smoke@example.com","message":"Testing the core lead path."},"metadata":{"landingPath":"/sites/joes-pizza","referrerHost":"local-smoke"}}'
assert_json "JSON form submission" 'const data = JSON.parse(process.env.BODY); if (data.siteId !== "site_joes_pizza" || data.formId !== "form_contact" || !data.id) process.exit(1);'

post_check "claim flow API" "/api/claim" '{"siteId":"site_joes_pizza","ownerEmail":"smoke-owner@example.com","verifiedFacts":["name","phone","address"],"acceptedTerms":true,"acceptedManagement":true}'
assert_json "claim flow API" 'const data = JSON.parse(process.env.BODY); if (data.siteId !== "site_joes_pizza" || data.ownerEmail !== "smoke-owner@example.com" || !Array.isArray(data.verifiedFacts) || !data.checkout) process.exit(1);'

post_check "action-list apply all" "/api/action-list/apply-all" '{"siteId":"site_joes_pizza","mode":"draft"}'
assert_json "action-list apply all" 'const data = JSON.parse(process.env.BODY); if (!Array.isArray(data.results) || !data.qa) process.exit(1);'

echo "Smoke checks passed for $BASE_URL"
