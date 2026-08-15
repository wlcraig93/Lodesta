#!/usr/bin/env bash
set -euo pipefail

START_SERVER=0
PORT_EXPLICIT=0
if [[ -n "${PORT+x}" ]]; then
  PORT_EXPLICIT=1
fi
PORT="${PORT:-4330}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --start-server) START_SERVER=1; shift ;;
    --port) PORT="$2"; PORT_EXPLICIT=1; shift 2 ;;
    *) echo "Unknown smoke option: $1" >&2; exit 1 ;;
  esac
done

if [[ "$START_SERVER" -eq 1 && "$PORT_EXPLICIT" -eq 0 && -z "${LODESTA_SMOKE_BASE_URL:-}" ]]; then
  PORT="$(node -e 'const server=require("node:net").createServer(); server.listen(0,"127.0.0.1",()=>{const address=server.address(); if (!address || typeof address==="string") process.exit(1); process.stdout.write(String(address.port)); server.close();});')"
fi

BASE_URL="${LODESTA_SMOKE_BASE_URL:-http://127.0.0.1:${PORT}}"
BASE_URL="${BASE_URL%/}"
export LODESTA_APP_ORIGIN="${LODESTA_SMOKE_APP_ORIGIN:-$BASE_URL}"
export LODESTA_REPOSITORY="${LODESTA_REPOSITORY:-local}"
export LODESTA_ASSET_STORAGE="${LODESTA_ASSET_STORAGE:-local}"
if [[ -z "${LODESTA_ADMIN_TOKEN:-}" && -f ".env.local" ]]; then
  LODESTA_ADMIN_TOKEN="$(node --env-file=.env.local -e 'process.stdout.write(process.env.LODESTA_ADMIN_TOKEN ?? "")')"
fi
export LODESTA_ADMIN_TOKEN="${LODESTA_ADMIN_TOKEN:-smoke_admin_token}"
export LODESTA_HASH_SECRET="${LODESTA_HASH_SECRET:-smoke_hash_secret}"

SERVER_PID=""
SERVER_LOG=""
ADMIN_HEADER_FILE=""
SMOKE_DATA_DIR=""
STATUS=""
BODY=""

cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  if [[ -n "$SERVER_LOG" && -f "$SERVER_LOG" ]]; then
    rm -f "$SERVER_LOG"
  fi
  if [[ -n "$ADMIN_HEADER_FILE" && -f "$ADMIN_HEADER_FILE" ]]; then
    rm -f "$ADMIN_HEADER_FILE"
  fi
  if [[ -n "$SMOKE_DATA_DIR" && -d "$SMOKE_DATA_DIR" ]]; then
    rm -f "$SMOKE_DATA_DIR/operations.json"
    rmdir "$SMOKE_DATA_DIR" 2>/dev/null || true
  fi
}
trap cleanup EXIT

ADMIN_HEADER_FILE="$(mktemp)"
chmod 600 "$ADMIN_HEADER_FILE"
printf 'x-lodesta-admin-token: %s\n' "$LODESTA_ADMIN_TOKEN" >"$ADMIN_HEADER_FILE"

if [[ "$START_SERVER" -eq 1 ]]; then
  if [[ -z "${LODESTA_PLATFORM_OPERATIONS_LOCAL_PATH:-}" ]]; then
    SMOKE_DATA_DIR="$(mktemp -d)"
    export LODESTA_PLATFORM_OPERATIONS_LOCAL_PATH="$SMOKE_DATA_DIR/operations.json"
  fi
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
  STATUS="$(curl -sS --connect-timeout 2 --max-time 5 -o /dev/null -w "%{http_code}" "$BASE_URL/api/health" 2>/dev/null || true)"
  [[ "$STATUS" =~ ^[234][0-9][0-9]$ ]] && break
  sleep 0.5
done
[[ "$STATUS" =~ ^[234][0-9][0-9]$ ]] || { echo "Timed out waiting for $BASE_URL" >&2; exit 1; }

request() {
  local method="$1" path="$2" payload="${3:-}"
  local args=(-sS --connect-timeout 5 --max-time 60 -L -w $'\n%{http_code}' -H "x-forwarded-for: 203.0.113.10" -H "@${ADMIN_HEADER_FILE}")
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

expect_empty_route_404() {
  local name="$1" path="$2" body_file result status content_type
  body_file="$(mktemp)"
  result="$(curl -sS --connect-timeout 5 --max-time 60 -L -o "$body_file" -w "%{http_code}|%{content_type}" -H "x-forwarded-for: 203.0.113.10" -H "@${ADMIN_HEADER_FILE}" "${BASE_URL}${path}")"
  status="${result%%|*}"
  content_type="${result#*|}"
  if [[ "$status" != "404" || -s "$body_file" || "$content_type" == text/html* ]]; then
    echo "Smoke check failed: $name did not reach the registered route handler (status=$status, content-type=${content_type:-none})" >&2
    [[ -s "$body_file" ]] && head -c 500 "$body_file" >&2
    rm -f "$body_file"
    exit 1
  fi
  rm -f "$body_file"
  echo "ok - $name"
}

request GET "/"
expect_status "marketing shell" "200"

request GET "/api/health"
expect_status "health" "200"
expect_json "health" 'const x=JSON.parse(process.env.BODY); if (x.status!=="ok") process.exit(1)'

request GET "/api/health?deep=1"
if [[ "$STATUS" == "200" ]]; then
  expect_json "deep health" 'const x=JSON.parse(process.env.BODY); if (!["ok","warning"].includes(x.status)||!x.checks?.some(c=>c.id==="repository_readiness")) process.exit(1)'
elif [[ "$STATUS" == "503" ]]; then
  expect_json "sandbox-disabled deep health" 'const x=JSON.parse(process.env.BODY); const errors=x.checks?.filter(c=>c.state==="error")??[]; if (x.status!=="error"||!x.checks?.some(c=>c.id==="repository_readiness")||!errors.length||errors.some(c=>!["sandbox","sandbox_readiness"].includes(c.id))) process.exit(1)'
else
  echo "Smoke check failed: deep health returned $STATUS, expected 200 or sandbox-only 503" >&2
  echo "$BODY" >&2
  exit 1
fi
echo "ok - deep health"

request GET "/account"
expect_status "account entry" "200"
request GET "/account/onboarding"
expect_status "account onboarding" "200"
request POST "/api/site-agent/sites" '{}'
if [[ "$STATUS" != "400" && "$STATUS" != "401" && "$STATUS" != "503" ]]; then
  echo "Smoke check failed: site bootstrap returned $STATUS, expected validation, authentication, or local-open refusal" >&2
  echo "$BODY" >&2
  exit 1
fi
echo "ok - site bootstrap authentication boundary"

for path in \
  "/admin/sites" \
  "/admin/sites/new" \
  "/admin/site-queue" \
  "/admin/runs" \
  "/prospects" \
  "/outbound" \
  "/settings"; do
  request GET "$path"
  [[ "$STATUS" =~ ^(200|307)$ ]] || { echo "Smoke check failed: operator surface $path returned $STATUS" >&2; exit 1; }
done
echo "ok - operator surfaces"

request GET "/api/admin/source-snapshots/source_missing/replay"
expect_status "unknown source replay fails closed" "404"
expect_json "unknown source replay fails closed" 'const x=JSON.parse(process.env.BODY); if (x.error!=="Source replay page not found") process.exit(1)'
request GET "/api/admin/source-snapshots/source_missing/resources/resource_missing"
expect_status "unknown source replay resource fails closed" "404"
expect_json "unknown source replay resource fails closed" 'const x=JSON.parse(process.env.BODY); if (x.error!=="Source replay resource not found") process.exit(1)'

request GET "/sites/smoke-missing"
expect_status "unknown public site fails closed" "404"
request GET "/preview/smoke-missing"
expect_status "unknown preview fails closed" "404"

expect_empty_route_404 "missing canonical asset reaches encoded route" "/_lodesta/assets/asset_revision_smoke_missing"
expect_empty_route_404 "missing runtime series reaches encoded route" "/_lodesta/runtime/smoke-missing.js"
expect_empty_route_404 "missing runtime patch reaches encoded route" "/_lodesta/runtime/patches/0000000000000000000000000000000000000000000000000000000000000000.js"

request POST "/api/forms/submit" '{"siteId":"site_missing","formId":"form_missing","payload":{"name":"Smoke"}}'
expect_status "unreferenced form rejected" "404"
request POST "/api/analytics" '{"siteId":"site_missing","eventId":"event_smoke_missing","visitorId":"visitor_smoke_missing","visitId":"visit_smoke_missing","eventType":"page_view","pagePath":"/","deviceCategory":"desktop"}'
expect_status "unknown analytics site rejected" "404"

request GET "/api/site-agent/runs/run_missing"
expect_status "unknown agent run rejected" "404"
request POST "/api/site-agent/runs" '{"sessionId":"session_missing","instruction":"Change the heading"}'
expect_status "unknown agent session rejected" "404"

for path in "/api/intake" "/api/preview-tokens"; do
  request GET "$path"
  expect_status "removed route $path" "404"
done
for path in "/api/sites/regenerate" "/api/sites/versions"; do
  request GET "$path"
  expect_status "removed route $path is not callable through the canonical site resource" "405"
done

echo "Smoke checks passed for $BASE_URL"
