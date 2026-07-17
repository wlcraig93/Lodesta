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
export STRIPE_WEBHOOK_SECRET="${STRIPE_WEBHOOK_SECRET:-whsec_smoke}"
export LODESTA_ADMIN_TOKEN="${LODESTA_ADMIN_TOKEN:-smoke_admin_token}"
export LODESTA_HASH_SECRET="${LODESTA_HASH_SECRET:-smoke_hash_secret}"

SITE_ID="site_austin_collision_works"
SITE_SLUG="austin-collision-works"
BUSINESS_NAME="Austin Collision Works"
INITIAL_FORM_ID="form_site_austin_collision_works_estimate"
CUSTOM_DOMAIN_HOST="smoke-austin-collision.example"
SERVER_PID=""
SERVER_LOG=""
BODY=""
STATUS=""
HEADERS=""

cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  if [[ -n "$SERVER_LOG" && -f "$SERVER_LOG" ]]; then rm -f "$SERVER_LOG"; fi
}
trap cleanup EXIT

if [[ "$START_SERVER" -eq 1 ]]; then
  SERVER_LOG="$(mktemp)"
  npm run dev:raw -- -p "$PORT" -H 127.0.0.1 >"$SERVER_LOG" 2>&1 &
  SERVER_PID="$!"
fi

wait_for_server() {
  local status
  for _ in $(seq 1 90); do
    if [[ -n "$SERVER_PID" ]] && ! kill -0 "$SERVER_PID" 2>/dev/null; then
      echo "Dev server exited before becoming ready." >&2
      cat "$SERVER_LOG" >&2 || true
      exit 1
    fi
    status="$(curl -sS -o /dev/null -w "%{http_code}" "$BASE_URL/" 2>/dev/null || true)"
    if [[ "$status" =~ ^[234][0-9][0-9]$ ]]; then return; fi
    sleep 0.5
  done
  echo "Timed out waiting for $BASE_URL" >&2
  [[ -n "$SERVER_LOG" ]] && cat "$SERVER_LOG" >&2 || true
  exit 1
}

request() {
  local method="$1"
  local path="$2"
  local payload="${3:-}"
  local response headers_file
  local curl_args=(-sS -w $'\n%{http_code}' -H "x-forwarded-for: 203.0.113.10" -H "x-lodesta-admin-token: ${LODESTA_ADMIN_TOKEN}")
  if [[ "$method" == "POST" ]]; then curl_args+=(-X POST -H "content-type: application/json" -d "$payload"); fi
  headers_file="$(mktemp)"
  response="$(curl -D "$headers_file" "${curl_args[@]}" "${BASE_URL}${path}")"
  HEADERS="$(cat "$headers_file")"
  rm -f "$headers_file"
  STATUS="${response##*$'\n'}"
  BODY="${response%$'\n'*}"
}

request_custom_host() {
  local host="$1" path="$2" response headers_file
  headers_file="$(mktemp)"
  response="$(curl -D "$headers_file" -sS -w $'\n%{http_code}' -H "x-forwarded-for: 203.0.113.10" -H "host: ${host}" "${BASE_URL}${path}")"
  HEADERS="$(cat "$headers_file")"
  rm -f "$headers_file"
  STATUS="${response##*$'\n'}"
  BODY="${response%$'\n'*}"
}

assert_status() {
  local name="$1" expected="$2"
  if [[ "$STATUS" != "$expected" ]]; then
    echo "Smoke check failed: $name returned $STATUS, expected $expected" >&2
    echo "$BODY" >&2
    [[ -n "$SERVER_LOG" && -f "$SERVER_LOG" ]] && tail -n 120 "$SERVER_LOG" >&2 || true
    exit 1
  fi
  echo "ok - $name"
}

assert_success() {
  local name="$1"
  if [[ ! "$STATUS" =~ ^2[0-9][0-9]$ ]]; then
    echo "Smoke check failed: $name returned $STATUS" >&2
    echo "$BODY" >&2
    [[ -n "$SERVER_LOG" && -f "$SERVER_LOG" ]] && tail -n 120 "$SERVER_LOG" >&2 || true
    exit 1
  fi
  echo "ok - $name"
}

assert_json() {
  local name="$1" script="$2"
  BODY="$BODY" node -e "$script" || {
    echo "Smoke check failed: $name returned unexpected JSON" >&2
    echo "$BODY" >&2
    exit 1
  }
}

get_check() { request GET "$2"; assert_success "$1"; }
post_check() { request POST "$2" "$3"; assert_success "$1"; }

complete_claim_checkout() {
  local claim_id="$1" payload signature response
  payload="$(CLAIM_ID="$claim_id" SITE_ID="$SITE_ID" node -e 'process.stdout.write(JSON.stringify({id:"evt_smoke_checkout",type:"checkout.session.completed",data:{object:{id:`cs_smoke_${process.env.CLAIM_ID}`,customer:"cus_smoke",subscription:"sub_smoke",metadata:{claim_id:process.env.CLAIM_ID,site_id:process.env.SITE_ID}}}}))')"
  signature="$(PAYLOAD="$payload" node -e 'const crypto = require("crypto"); const t = Math.floor(Date.now() / 1000); const sig = crypto.createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET).update(`${t}.${process.env.PAYLOAD}`).digest("hex"); process.stdout.write(`t=${t},v1=${sig}`);')"
  response="$(curl -sS -w $'\n%{http_code}' -H "x-forwarded-for: 203.0.113.10" -H "content-type: application/json" -H "stripe-signature: ${signature}" -d "$payload" "${BASE_URL}/api/stripe/webhook")"
  STATUS="${response##*$'\n'}"
  BODY="${response%$'\n'*}"
}

wait_for_server

node --input-type=module -e 'import { parseImportBatchPayload } from "./scripts/lodesta.mjs"; const parsed = parseImportBatchPayload(["[\"https://one.example\",\"ftp://blocked.example\",\"two.example\"]"]); if (parsed.urls.length !== 2 || parsed.urls[1] !== "two.example") process.exit(1);'
echo "ok - CLI import batch payload parser"

get_check "dashboard" "/"
get_check "health" "/api/health"
get_check "deep health" "/api/health?deep=1"
assert_json "deep health" 'const data = JSON.parse(process.env.BODY); if (!["ok","warning"].includes(data.status) || !data.checks?.some((check) => check.id === "repository_readiness") || !data.checks?.some((check) => check.id === "render_browser_readiness")) process.exit(1);'

get_check "canonical control plane" "/api/control-plane/changes?siteId=${SITE_ID}"
assert_json "canonical control plane" 'const data = JSON.parse(process.env.BODY); if (!data.ok || data.controlPlane?.state?.business?.name !== "Austin Collision Works" || data.controlPlane?.latestSnapshot?.formDefinition?.id !== "form_site_austin_collision_works_estimate") process.exit(1);'

get_check "public site" "/sites/${SITE_SLUG}"
if [[ "$BODY" != *"${BUSINESS_NAME}"* || "$BODY" == *'action="/api/forms/submit"'* || "$BODY" != *'data-preview-disabled="lead-form"'* || "$BODY" == *'application/ld+json'* ]]; then
  echo "Smoke check failed: unclaimed public site must be visible but non-collecting and non-indexable" >&2
  exit 1
fi
echo "ok - unclaimed public boundary"

get_check "tokenized preview" "/preview/demo-token"
if [[ "$BODY" == *'action="/api/forms/submit"'* || "$BODY" != *'data-preview-disabled="lead-form"'* ]]; then
  echo "Smoke check failed: tokenized preview form must remain disabled" >&2
  exit 1
fi
echo "ok - preview form disabled"

get_check "owner editor" "/editor/${SITE_SLUG}"
get_check "owner business" "/business/${SITE_SLUG}"
get_check "owner status" "/status/${SITE_SLUG}"
get_check "claim flow" "/claim/${SITE_SLUG}"

post_check "unclaimed analytics inactive gate" "/api/analytics" "{\"siteId\":\"${SITE_ID}\",\"sessionId\":\"preclaim\",\"pageId\":\"home\",\"eventType\":\"pageview\"}"
assert_json "unclaimed analytics inactive gate" 'const data = JSON.parse(process.env.BODY); if (data.accepted !== false || data.status !== "inactive") process.exit(1);'
post_check "unclaimed form inactive gate" "/api/forms/submit" "{\"siteId\":\"${SITE_ID}\",\"formId\":\"${INITIAL_FORM_ID}\",\"pageId\":\"home\",\"payload\":{\"name\":\"Pre Claim\",\"phone\":\"5125550199\",\"details\":\"No storage\"}}"
assert_json "unclaimed form inactive gate" 'const data = JSON.parse(process.env.BODY); if (data.accepted !== false || data.status !== "inactive") process.exit(1);'

request POST "/api/sites/publish" "{\"siteId\":\"${SITE_ID}\",\"confirmed\":true}"
assert_status "unclaimed publish gate" "402"

post_check "claim verification challenge" "/api/claim/verification" "{\"action\":\"start\",\"siteId\":\"${SITE_ID}\",\"channel\":\"phone\"}"
CLAIM_CHALLENGE_ID="$(BODY="$BODY" node -e 'process.stdout.write(JSON.parse(process.env.BODY).challengeId || "")')"
CLAIM_CHALLENGE_CODE="$(BODY="$BODY" node -e 'process.stdout.write(JSON.parse(process.env.BODY).developmentCode || "")')"
[[ -n "$CLAIM_CHALLENGE_ID" && -n "$CLAIM_CHALLENGE_CODE" ]] || { echo "Claim challenge did not return a local code" >&2; exit 1; }

INCOMPLETE_CLAIM_PAYLOAD="$(CLAIM_CHALLENGE_ID="$CLAIM_CHALLENGE_ID" CLAIM_CHALLENGE_CODE="$CLAIM_CHALLENGE_CODE" SITE_ID="$SITE_ID" node -e 'process.stdout.write(JSON.stringify({siteId:process.env.SITE_ID,ownerEmail:"smoke-owner@example.com",verifiedFacts:["name"],verificationChallenge:{challengeId:process.env.CLAIM_CHALLENGE_ID,code:process.env.CLAIM_CHALLENGE_CODE},acceptedTerms:true,acceptedManagement:true}))')"
request POST "/api/claim" "$INCOMPLETE_CLAIM_PAYLOAD"
assert_status "incomplete claim fact gate" "400"
assert_json "incomplete claim fact gate" 'const data = JSON.parse(process.env.BODY); for (const fact of ["phone","email","address","hours","service_areas","services"]) if (!data.missingRequiredFacts?.includes(fact)) process.exit(1);'

CLAIM_PAYLOAD="$(CLAIM_CHALLENGE_ID="$CLAIM_CHALLENGE_ID" CLAIM_CHALLENGE_CODE="$CLAIM_CHALLENGE_CODE" SITE_ID="$SITE_ID" node -e 'process.stdout.write(JSON.stringify({siteId:process.env.SITE_ID,ownerEmail:"smoke-owner@example.com",verifiedFacts:["name","phone","email","address","hours","service_areas","services"],verificationChallenge:{challengeId:process.env.CLAIM_CHALLENGE_ID,code:process.env.CLAIM_CHALLENGE_CODE},acceptedTerms:true,acceptedManagement:true}))')"
post_check "claim API" "/api/claim" "$CLAIM_PAYLOAD"
CLAIM_ID="$(BODY="$BODY" node -e 'const data=JSON.parse(process.env.BODY); if (data.status !== "checkout_required") process.exit(1); process.stdout.write(data.id)')"
complete_claim_checkout "$CLAIM_ID"
assert_success "claim completion webhook"
assert_json "claim completion webhook" 'const data = JSON.parse(process.env.BODY); if (data.claim?.status !== "claimed") process.exit(1);'

get_check "claimed public site" "/sites/${SITE_SLUG}"
if [[ "$BODY" != *'action="/api/forms/submit"'* || "$BODY" != *'application/ld+json'* || "$BODY" != *'name="formId" value="form_site_austin_collision_works_estimate"'* ]]; then
  echo "Smoke check failed: claimed public site must render the exact active form and structured data" >&2
  exit 1
fi
echo "ok - claimed public boundary"

post_check "form honeypot guard" "/api/forms/submit" "{\"siteId\":\"${SITE_ID}\",\"formId\":\"${INITIAL_FORM_ID}\",\"companyWebsite\":\"https://spam.example\",\"payload\":{\"name\":\"Bot\",\"phone\":\"5125550199\",\"details\":\"Spam\"}}"
assert_json "form honeypot guard" 'const data = JSON.parse(process.env.BODY); if (data.status !== "ignored") process.exit(1);'

request POST "/api/forms/submit" "{\"siteId\":\"${SITE_ID}\",\"formId\":\"${INITIAL_FORM_ID}\",\"payload\":{\"name\":\"Missing fields\"}}"
assert_status "form required-field validation" "400"
assert_json "form required-field validation" 'const data = JSON.parse(process.env.BODY); if (!data.missingFields?.includes("phone") || !data.missingFields?.includes("details")) process.exit(1);'

post_check "versioned form submission" "/api/forms/submit" "{\"siteId\":\"${SITE_ID}\",\"formId\":\"${INITIAL_FORM_ID}\",\"pageId\":\"home\",\"sessionId\":\"smoke_session\",\"payload\":{\"name\":\"Smoke Test\",\"phone\":\"5125550199\",\"details\":\"Front bumper estimate\"}}"
assert_json "versioned form submission" 'const data = JSON.parse(process.env.BODY); if (data.accepted !== true || data.status !== "received") process.exit(1);'
get_check "inquiry API" "/api/inquiries?siteId=${SITE_ID}"
assert_json "inquiry API" 'const data = JSON.parse(process.env.BODY); if (!data.inquiries?.some((item) => item.contactName === "Smoke Test" && item.contactPhone)) process.exit(1);'

FORM_CHANGE_PAYLOAD="$(SITE_ID="$SITE_ID" node -e 'process.stdout.write(JSON.stringify({siteId:process.env.SITE_ID,payload:{kind:"set_form_definition",name:"Repair consultation",fields:[{id:"name",label:"Name",type:"text",required:true},{id:"email",label:"Email",type:"email",required:true},{id:"message",label:"What do you need repaired?",type:"textarea",required:true}],submitLabel:"Send consultation request"}}))')"
post_check "control-plane form change" "/api/control-plane/changes" "$FORM_CHANGE_PAYLOAD"
assert_json "control-plane form change" 'const data = JSON.parse(process.env.BODY); if (!data.ok || !data.applied || data.publish !== "published") process.exit(1);'

get_check "control plane after form change" "/api/control-plane/changes?siteId=${SITE_ID}"
CURRENT_FORM_ID="$(BODY="$BODY" node -e 'const data=JSON.parse(process.env.BODY); const form=data.controlPlane?.latestSnapshot?.formDefinition; if (form?.submitLabel !== "Send consultation request") process.exit(1); process.stdout.write(form.id)')"
get_check "public site after form change" "/sites/${SITE_SLUG}"
if [[ "$BODY" != *"Send consultation request"* || "$BODY" != *"name=\"formId\" value=\"${CURRENT_FORM_ID}\""* ]]; then
  echo "Smoke check failed: public renderer did not switch to the immutable replacement form" >&2
  exit 1
fi
echo "ok - immutable replacement form rendered"

request POST "/api/forms/submit" "{\"siteId\":\"${SITE_ID}\",\"formId\":\"candidate_only_unknown\",\"payload\":{\"name\":\"No\",\"email\":\"no@example.com\",\"message\":\"No\"}}"
assert_status "unreferenced form rejection" "404"

request POST "/api/control-plane/changes" "{\"siteId\":\"${SITE_ID}\",\"payload\":{\"kind\":\"set_form_definition\",\"name\":\"Unsafe\",\"fields\":[{\"id\":\"card\",\"label\":\"Credit card number\",\"type\":\"text\",\"required\":true},{\"id\":\"email\",\"label\":\"Email\",\"type\":\"email\",\"required\":true}],\"submitLabel\":\"Submit\"}}"
assert_status "unsafe form rejection" "409"

post_check "analytics ingest" "/api/analytics" "{\"siteId\":\"${SITE_ID}\",\"sessionId\":\"smoke_session\",\"pageId\":\"home\",\"eventType\":\"pageview\",\"metadata\":{\"path\":\"/sites/${SITE_SLUG}\"}}"
assert_json "analytics ingest" 'const data = JSON.parse(process.env.BODY); if (data.accepted !== true) process.exit(1);'

post_check "custom domain registration" "/api/domains" "{\"siteId\":\"${SITE_ID}\",\"hostname\":\"${CUSTOM_DOMAIN_HOST}\",\"provider\":\"railway\"}"
assert_json "custom domain registration" 'const data = JSON.parse(process.env.BODY); if (data.status !== "active") process.exit(1);'
request_custom_host "$CUSTOM_DOMAIN_HOST" "/"
assert_success "custom domain rendering"
if [[ "$BODY" != *"${BUSINESS_NAME}"* || "$BODY" == *"/sites/${SITE_SLUG}"* ]]; then
  echo "Smoke check failed: custom domain must render without platform navigation URLs" >&2
  exit 1
fi

request_custom_host "$CUSTOM_DOMAIN_HOST" "/robots.txt"
assert_success "custom domain robots"
[[ "$BODY" == *"Allow: /"* && "$BODY" == *"${CUSTOM_DOMAIN_HOST}/sitemap.xml"* ]] || { echo "Custom-domain robots output is invalid" >&2; exit 1; }

echo "Smoke checks passed for $BASE_URL"
