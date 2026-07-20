#!/usr/bin/env bash
set -euo pipefail

START_SERVER=0
PORT="${PORT:-4330}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --start-server) START_SERVER=1; shift ;;
    --port) PORT="$2"; shift 2 ;;
    *) echo "Unknown smoke option: $1" >&2; exit 1 ;;
  esac
done

BASE_URL="${LODESTA_SMOKE_BASE_URL:-http://127.0.0.1:${PORT}}"
BASE_URL="${BASE_URL%/}"
export LODESTA_APP_ORIGIN="${LODESTA_SMOKE_APP_ORIGIN:-$BASE_URL}"
export LODESTA_REPOSITORY="${LODESTA_REPOSITORY:-local}"
export LODESTA_ASSET_STORAGE="${LODESTA_ASSET_STORAGE:-local}"
export LODESTA_ADMIN_TOKEN="${LODESTA_ADMIN_TOKEN:-smoke_admin_token}"
export LODESTA_HASH_SECRET="${LODESTA_HASH_SECRET:-smoke_hash_secret}"

SERVER_PID=""
SERVER_LOG=""
STATUS=""
BODY=""

cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  [[ -n "$SERVER_LOG" && -f "$SERVER_LOG" ]] && rm -f "$SERVER_LOG"
}
trap cleanup EXIT

if [[ "$START_SERVER" -eq 1 ]]; then
  SERVER_LOG="$(mktemp)"
  npm run dev:raw -- -p "$PORT" -H 127.0.0.1 >"$SERVER_LOG" 2>&1 &
  SERVER_PID="$!"
fi

for _ in $(seq 1 90); do
  if [[ -n "$SERVER_PID" ]] && ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "Dev server exited before becoming ready." >&2
    cat "$SERVER_LOG" >&2 || true
    exit 1
  fi
  STATUS="$(curl -sS -o /dev/null -w "%{http_code}" "$BASE_URL/api/health" 2>/dev/null || true)"
  [[ "$STATUS" =~ ^[234][0-9][0-9]$ ]] && break
  sleep 0.5
done
[[ "$STATUS" =~ ^[234][0-9][0-9]$ ]] || { echo "Timed out waiting for $BASE_URL" >&2; exit 1; }

request() {
  local method="$1" path="$2" payload="${3:-}"
  local args=(-sS -L -w $'\n%{http_code}' -H "x-forwarded-for: 203.0.113.10" -H "x-lodesta-admin-token: ${LODESTA_ADMIN_TOKEN}")
  [[ "$method" == "POST" ]] && args+=(-X POST -H "content-type: application/json" -d "$payload")
  local response
  response="$(curl "${args[@]}" "${BASE_URL}${path}")"
  STATUS="${response##*$'\n'}"
  BODY="${response%$'\n'*}"
}

expect_status() {
  local name="$1" expected="$2"
  if [[ "$STATUS" != "$expected" ]]; then
    echo "Smoke check failed: $name returned $STATUS, expected $expected" >&2
    echo "$BODY" >&2
    [[ -n "$SERVER_LOG" ]] && tail -n 100 "$SERVER_LOG" >&2 || true
    exit 1
  fi
  echo "ok - $name"
}

expect_json() {
  local name="$1" expression="$2"
  BODY="$BODY" node -e "$expression" || { echo "Smoke check failed: $name returned unexpected JSON" >&2; echo "$BODY" >&2; exit 1; }
}

request GET "/"
expect_status "marketing shell" "200"

request GET "/api/health"
expect_status "health" "200"
expect_json "health" 'const x=JSON.parse(process.env.BODY); if (x.status!=="ok") process.exit(1)'

request GET "/api/health?deep=1"
expect_status "deep health" "200"
expect_json "deep health" 'const x=JSON.parse(process.env.BODY); if (!["ok","warning"].includes(x.status)||!x.checks?.some(c=>c.id==="repository_readiness")) process.exit(1)'

for path in "/admin/sites" "/admin/site-queue" "/admin/runs" "/settings"; do
  request GET "$path"
  [[ "$STATUS" =~ ^(200|307)$ ]] || { echo "Smoke check failed: operator surface $path returned $STATUS" >&2; exit 1; }
done
echo "ok - V4 operator surfaces"

request GET "/sites/smoke-missing"
expect_status "unknown public site fails closed" "404"
request GET "/preview/smoke-missing"
expect_status "unknown preview fails closed" "404"

request POST "/api/forms/submit" '{"siteId":"site_missing","formId":"form_missing","payload":{"name":"Smoke"}}'
expect_status "unreferenced form rejected" "404"
request POST "/api/analytics" '{"siteId":"site_missing","sessionId":"smoke","pageId":"home","eventType":"pageview"}'
expect_status "unknown analytics site rejected" "404"

request GET "/api/site-agent/runs/run_missing"
expect_status "unknown agent run rejected" "404"
request POST "/api/site-agent/runs" '{"sessionId":"session_missing","kind":"focused_edit","instruction":"Change the heading"}'
expect_status "unknown agent session rejected" "404"

for path in "/api/intake" "/api/sites/regenerate" "/api/sites/versions" "/api/preview-tokens"; do
  request GET "$path"
  expect_status "deleted V3 route $path" "404"
done

echo "Smoke checks passed for $BASE_URL"
