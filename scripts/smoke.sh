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
export LODESTA_INTERNAL_APP_URL="${LODESTA_INTERNAL_APP_URL:-$BASE_URL}"
export STRIPE_WEBHOOK_SECRET="${STRIPE_WEBHOOK_SECRET:-whsec_smoke}"
export LODESTA_ADMIN_TOKEN="${LODESTA_ADMIN_TOKEN:-smoke_admin_token}"
CUSTOM_DOMAIN_HOST="smoke-joes.example"
SCHEDULE_KEY="smoke-${PORT}-$$"
export SCHEDULE_KEY
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
  local headers_file
  local curl_args=(-sS -w $'\n%{http_code}' -H "x-forwarded-for: 203.0.113.10" -H "x-lodesta-admin-token: ${LODESTA_ADMIN_TOKEN}")

  if [[ "$method" == "POST" ]]; then
    curl_args+=(-X POST -H "content-type: application/json" -d "$payload")
  fi

  headers_file="$(mktemp)"
  response="$(curl -D "$headers_file" "${curl_args[@]}" "${BASE_URL}${path}")"
  HEADERS="$(cat "$headers_file")"
  rm -f "$headers_file"
  STATUS="${response##*$'\n'}"
  BODY="${response%$'\n'*}"
}

request_custom_host() {
  local host="$1"
  local path="$2"
  local response
  local headers_file

  headers_file="$(mktemp)"
  response="$(curl -D "$headers_file" -sS -w $'\n%{http_code}' -H "x-forwarded-for: 203.0.113.10" -H "host: ${host}" "${BASE_URL}${path}")"
  HEADERS="$(cat "$headers_file")"
  rm -f "$headers_file"
  STATUS="${response##*$'\n'}"
  BODY="${response%$'\n'*}"
}

request_forwarded_host() {
  local host="$1"
  local path="$2"
  local response
  local headers_file

  headers_file="$(mktemp)"
  response="$(curl -D "$headers_file" -sS -w $'\n%{http_code}' -H "x-forwarded-for: 203.0.113.10" -H "host: internal.proxy" -H "x-forwarded-host: ${host}, edge.proxy" "${BASE_URL}${path}")"
  HEADERS="$(cat "$headers_file")"
  rm -f "$headers_file"
  STATUS="${response##*$'\n'}"
  BODY="${response%$'\n'*}"
}

assert_success() {
  local name="$1"
  if [[ ! "$STATUS" =~ ^2[0-9][0-9]$ ]]; then
    echo "Smoke check failed: $name returned $STATUS" >&2
    echo "$BODY" >&2
    if [[ -n "$SERVER_LOG" && -f "$SERVER_LOG" ]]; then
      tail -n 120 "$SERVER_LOG" >&2 || true
    fi
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

complete_claim_checkout() {
  local claim_id="$1"
  local payload
  local signature
  local response

  payload="$(CLAIM_ID="$claim_id" node -e 'process.stdout.write(JSON.stringify({id:"evt_smoke_checkout",type:"checkout.session.completed",data:{object:{id:`cs_smoke_${process.env.CLAIM_ID}`,customer:"cus_smoke",subscription:"sub_smoke",metadata:{claim_id:process.env.CLAIM_ID,site_id:"site_joes_pizza"}}}}))')"
  signature="$(PAYLOAD="$payload" node -e 'const crypto = require("crypto"); const t = Math.floor(Date.now() / 1000); const sig = crypto.createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET).update(`${t}.${process.env.PAYLOAD}`).digest("hex"); process.stdout.write(`t=${t},v1=${sig}`);')"
  response="$(curl -sS -w $'\n%{http_code}' -H "x-forwarded-for: 203.0.113.10" -H "content-type: application/json" -H "stripe-signature: ${signature}" -d "$payload" "${BASE_URL}/api/stripe/webhook")"
  STATUS="${response##*$'\n'}"
  BODY="${response%$'\n'*}"
}

wait_for_server

node --input-type=module -e 'import { parseImportBatchPayload } from "./scripts/lodesta.mjs"; const objectPayload = parseImportBatchPayload(["{\"urls\":[\"https://one.example\"],\"createPreviews\":false}"]); const arrayPayload = parseImportBatchPayload(["[\"https://one.example\",\"ftp://blocked.example\",\"https://two.example\"]"]); const textPayload = parseImportBatchPayload(["https://one.example, https://two.example\nhttps://three.example"]); const argsPayload = parseImportBatchPayload(["https://one.example","not-a-url","https://two.example"]); if (objectPayload.createPreviews !== false || objectPayload.urls?.[0] !== "https://one.example") process.exit(1); if (arrayPayload.urls.length !== 2 || arrayPayload.urls[1] !== "https://two.example") process.exit(1); if (textPayload.text.split(/[\n,]/).length !== 3) process.exit(1); if (argsPayload.urls.length !== 2 || argsPayload.urls[0] !== "https://one.example") process.exit(1);'
echo "ok - CLI import batch payload parser"

get_check "dashboard" "/"
get_check "public site" "/sites/joes-pizza"
if [[ "$BODY" == *'action="/api/forms/submit"'* || "$BODY" != *'data-preview-disabled="lead-form"'* ]]; then
  echo "Smoke check failed: unclaimed public site should render inert lead capture" >&2
  exit 1
fi
if [[ "$BODY" == *'application/ld+json'* ]]; then
  echo "Smoke check failed: unclaimed public site should not emit verified LocalBusiness JSON-LD" >&2
  exit 1
fi
echo "ok - unclaimed public lead capture disabled"
get_check "tokenized preview" "/preview/demo-token"
if [[ "$BODY" == *'action="/api/forms/submit"'* || "$BODY" != *'data-preview-disabled="lead-form"'* ]]; then
  echo "Smoke check failed: tokenized preview should render inert lead capture" >&2
  exit 1
fi
if [[ "$BODY" == *'application/ld+json'* ]]; then
  echo "Smoke check failed: tokenized preview should not emit verified LocalBusiness JSON-LD" >&2
  exit 1
fi
echo "ok - tokenized preview lead capture disabled"
get_check "editor" "/editor/joes-pizza"
get_check "analytics dashboard" "/analytics/joes-pizza"
get_check "optimization dashboard" "/optimization/joes-pizza"
get_check "experiments dashboard" "/experiments/joes-pizza"
get_check "business profile" "/business/joes-pizza"
get_check "leads dashboard" "/leads/joes-pizza"
get_check "outbound dashboard" "/outbound"
get_check "claim flow" "/claim/joes-pizza"
get_check "domain flow" "/domains/joes-pizza"
get_check "health" "/api/health"
get_check "deep health" "/api/health?deep=1"
assert_json "deep health" 'const data = JSON.parse(process.env.BODY); if (!["ok","warning"].includes(data.status) || !Array.isArray(data.checks) || !data.checks.some((check) => check.id === "repository_readiness") || !data.checks.some((check) => check.id === "render_browser_readiness")) process.exit(1);'

request POST "/api/intake" '{"prompt":"Build a site for a plumber in Toronto, Canada."}'
if [[ "$STATUS" != "400" ]]; then
  echo "Smoke check failed: non-US intake market gate returned $STATUS" >&2
  echo "$BODY" >&2
  exit 1
fi
assert_json "non-US intake market gate" 'const data = JSON.parse(process.env.BODY); if (data.code !== "unsupported_launch_market") process.exit(1);'
echo "ok - non-US intake market gate"

request POST "/api/presence/assess" '{"url":"https://example.ca","render":false,"screenshots":false}'
if [[ "$STATUS" != "400" ]]; then
  echo "Smoke check failed: non-US presence market gate returned $STATUS" >&2
  echo "$BODY" >&2
  exit 1
fi
assert_json "non-US presence market gate" 'const data = JSON.parse(process.env.BODY); if (data.code !== "unsupported_launch_market") process.exit(1);'
echo "ok - non-US presence market gate"

post_check "maintenance scheduler API" "/api/jobs/schedule" "{\"task\":\"launch_maintenance\",\"siteIds\":[\"site_joes_pizza\"],\"retentionDays\":395,\"scheduleKey\":\"${SCHEDULE_KEY}\"}"
assert_json "maintenance scheduler API" 'const data = JSON.parse(process.env.BODY); if (!data.ok || data.scheduleKey !== process.env.SCHEDULE_KEY || !Array.isArray(data.queued) || !data.queued.some((job) => job.kind === "monthly_action_list") || !data.queued.some((job) => job.kind === "analytics_retention")) process.exit(1);'

post_check "worker process jobs API" "/api/jobs/process" '{"limit":200}'
assert_json "worker process jobs API" 'const data = JSON.parse(process.env.BODY); if (!Array.isArray(data.jobs) || !data.jobs.some((job) => job.status === "completed" && job.payload?.scheduleKey === process.env.SCHEDULE_KEY)) process.exit(1);'

request POST "/api/sites/publish" '{"siteId":"site_joes_pizza","confirmed":true}'
if [[ "$STATUS" != "402" ]]; then
  echo "Smoke check failed: unclaimed publish payment gate returned $STATUS" >&2
  echo "$BODY" >&2
  exit 1
fi
assert_json "unclaimed publish payment gate" 'const data = JSON.parse(process.env.BODY); if (data.paymentRequired !== true || !["claim_required","payment_required"].includes(data.claimGate)) process.exit(1);'
echo "ok - unclaimed publish payment gate"

request POST "/api/domains" "{\"siteId\":\"site_joes_pizza\",\"hostname\":\"${CUSTOM_DOMAIN_HOST}\",\"provider\":\"railway\"}"
if [[ "$STATUS" != "402" ]]; then
  echo "Smoke check failed: unclaimed domain payment gate returned $STATUS" >&2
  echo "$BODY" >&2
  exit 1
fi
assert_json "unclaimed domain payment gate" 'const data = JSON.parse(process.env.BODY); if (data.paymentRequired !== true || !["claim_required","payment_required"].includes(data.claimGate)) process.exit(1);'
echo "ok - unclaimed domain payment gate"

post_check "unclaimed analytics inactive gate" "/api/analytics" '{"siteId":"site_joes_pizza","sessionId":"preclaim_session","pageId":"home","eventType":"pageview","metadata":{"path":"/sites/joes-pizza"}}'
assert_json "unclaimed analytics inactive gate" 'const data = JSON.parse(process.env.BODY); if (data.accepted !== false || data.status !== "inactive" || !["claim_required","payment_required","verification_required"].includes(data.claimGate) || data.event) process.exit(1);'

post_check "unclaimed form inactive gate" "/api/forms/submit" '{"siteId":"site_joes_pizza","formId":"form_contact","pageId":"home","sessionId":"preclaim_session","payload":{"name":"Pre Claim","email":"preclaim@example.com","message":"Should not be stored."}}'
assert_json "unclaimed form inactive gate" 'const data = JSON.parse(process.env.BODY); if (data.accepted !== false || data.status !== "inactive" || !["claim_required","payment_required","verification_required"].includes(data.claimGate) || data.id) process.exit(1);'

post_check "unclaimed experiment inactive gate" "/api/experiments/assign" '{"siteId":"site_joes_pizza","sessionId":"preclaim_session"}'
assert_json "unclaimed experiment inactive gate" 'const data = JSON.parse(process.env.BODY); if (data.assigned !== false || !["claim_required","payment_required","verification_required"].includes(data.claimGate) || !String(data.reason || "").includes("claim")) process.exit(1);'

request POST "/api/claim" '{"siteId":"site_joes_pizza","ownerEmail":"smoke-owner@example.com","verifiedFacts":["name"],"acceptedTerms":true,"acceptedManagement":true}'
if [[ "$STATUS" != "400" ]]; then
  echo "Smoke check failed: incomplete claim fact verification returned $STATUS" >&2
  echo "$BODY" >&2
  exit 1
fi
assert_json "incomplete claim fact verification" 'const data = JSON.parse(process.env.BODY); if (!Array.isArray(data.missingRequiredFacts) || !data.missingRequiredFacts.includes("phone") || !data.missingRequiredFacts.includes("address") || !data.missingRequiredFacts.includes("services")) process.exit(1);'
echo "ok - incomplete claim fact verification"

post_check "claim flow API" "/api/claim" '{"siteId":"site_joes_pizza","ownerEmail":"smoke-owner@example.com","verifiedFacts":["name","phone","address","services"],"acceptedTerms":true,"acceptedManagement":true}'
assert_json "claim flow API" 'const data = JSON.parse(process.env.BODY); if (data.siteId !== "site_joes_pizza" || data.ownerEmail !== "smoke-owner@example.com" || data.status !== "checkout_required" || !Array.isArray(data.verifiedFacts) || !data.checkout) process.exit(1);'
CLAIM_ID="$(BODY="$BODY" node -e 'process.stdout.write(JSON.parse(process.env.BODY).id)')"
export CLAIM_ID

complete_claim_checkout "$CLAIM_ID"
assert_success "stripe claim completion webhook"
assert_json "stripe claim completion webhook" 'const data = JSON.parse(process.env.BODY); if (!data.received || data.claim?.status !== "claimed" || data.claim?.id !== process.env.CLAIM_ID) process.exit(1);'

post_check "custom domain registration API" "/api/domains" "{\"siteId\":\"site_joes_pizza\",\"hostname\":\"${CUSTOM_DOMAIN_HOST}\",\"provider\":\"railway\"}"
assert_json "custom domain registration API" "const data = JSON.parse(process.env.BODY); if (data.siteId !== 'site_joes_pizza' || data.hostname !== '${CUSTOM_DOMAIN_HOST}' || data.kind !== 'custom' || data.status !== 'active') process.exit(1);"
CUSTOM_DOMAIN_ID="$(BODY="$BODY" node -e 'process.stdout.write(JSON.parse(process.env.BODY).id)')"

post_check "custom domain idempotent registration API" "/api/domains" "{\"siteId\":\"site_joes_pizza\",\"hostname\":\"${CUSTOM_DOMAIN_HOST}\",\"provider\":\"railway\"}"
CUSTOM_DOMAIN_ID="$CUSTOM_DOMAIN_ID" assert_json "custom domain idempotent registration API" "const data = JSON.parse(process.env.BODY); if (data.id !== process.env.CUSTOM_DOMAIN_ID || data.siteId !== 'site_joes_pizza' || data.hostname !== '${CUSTOM_DOMAIN_HOST}') process.exit(1);"

post_check "custom domain refresh API" "/api/domains/refresh" "{\"domainId\":\"${CUSTOM_DOMAIN_ID}\"}"
assert_json "custom domain refresh API" "const data = JSON.parse(process.env.BODY); if (!data.ok || data.domain?.id !== '${CUSTOM_DOMAIN_ID}' || data.domain?.status !== 'active') process.exit(1);"

request_custom_host "$CUSTOM_DOMAIN_HOST" "/"
assert_success "custom domain public routing"
if [[ "$BODY" != *"Joe's Pizza"* || "$BODY" != *"Pizza night should be easy."* ]]; then
  echo "Smoke check failed: custom domain public routing did not render the published site" >&2
  exit 1
fi
if [[ "$BODY" != *'action="/api/forms/submit"'* ]]; then
  echo "Smoke check failed: claimed public site should render active lead capture" >&2
  exit 1
fi
if [[ "$BODY" != *'application/ld+json'* || "$BODY" != *'"telephone":"+15551234567"'* || "$BODY" == *'"openingHours"'* ]]; then
  echo "Smoke check failed: claimed public site should emit only verified LocalBusiness JSON-LD fields" >&2
  exit 1
fi
if ! BODY="$BODY" CUSTOM_DOMAIN_HOST="$CUSTOM_DOMAIN_HOST" node -e 'const body = process.env.BODY || ""; const tag = body.match(/<link\b(?=[^>]*rel="canonical")[^>]*>/)?.[0] || ""; const href = tag.match(/href="([^"]+)"/)?.[1]; const host = process.env.CUSTOM_DOMAIN_HOST; if (![ `http://${host}`, `http://${host}/`, `https://${host}`, `https://${host}/` ].includes(href)) process.exit(1);'; then
  echo "Smoke check failed: custom domain public routing should emit a customer-host canonical URL" >&2
  BODY="$BODY" node -e 'const body = process.env.BODY || ""; console.error(body.match(/<link\b[^>]*>/g)?.filter((tag) => tag.includes("canonical")).join("\n") || "no canonical link found");' >&2
  exit 1
fi
echo "ok - custom domain rendered published site"

request_forwarded_host "$CUSTOM_DOMAIN_HOST" "/"
assert_success "custom domain forwarded-host routing"
if [[ "$BODY" != *"Joe's Pizza"* || "$BODY" != *"Pizza night should be easy."* ]]; then
  echo "Smoke check failed: forwarded-host custom domain routing did not render the customer-host site" >&2
  exit 1
fi
HEADERS="$HEADERS" node -e 'const headers = process.env.HEADERS || ""; const cf = headers.split(/\r?\n/).find((line) => /^cloudflare-cdn-cache-control:/i.test(line)) || ""; const forwarded = headers.split(/\r?\n/).find((line) => /^x-lodesta-forwarded-host-cache:/i.test(line)) || ""; if (!/no-store/i.test(cf) || !/no-store/i.test(forwarded)) process.exit(1);' || {
  echo "Smoke check failed: forwarded-host custom domain routing did not disable Cloudflare CDN caching" >&2
  echo "$HEADERS" >&2
  exit 1
}

request_custom_host "$CUSTOM_DOMAIN_HOST" "/robots.txt"
assert_success "custom domain robots"
if [[ "$BODY" != *"Allow: /"* ]] || [[ "$BODY" != *"Sitemap: http://${CUSTOM_DOMAIN_HOST}/sitemap.xml"* && "$BODY" != *"Sitemap: https://${CUSTOM_DOMAIN_HOST}/sitemap.xml"* ]]; then
  echo "Smoke check failed: custom domain robots.txt did not expose the customer-host sitemap" >&2
  echo "$BODY" >&2
  exit 1
fi

request_custom_host "$CUSTOM_DOMAIN_HOST" "/sitemap.xml"
assert_success "custom domain sitemap"
if [[ "$BODY" != *"<loc>http://${CUSTOM_DOMAIN_HOST}/</loc>"* && "$BODY" != *"<loc>https://${CUSTOM_DOMAIN_HOST}/</loc>"* ]] || [[ "$BODY" == *"/sites/joes-pizza"* ]]; then
  echo "Smoke check failed: custom domain sitemap did not use customer-host URLs" >&2
  echo "$BODY" >&2
  exit 1
fi

request_custom_host "$CUSTOM_DOMAIN_HOST" "/llms.txt"
assert_success "custom domain llms.txt"
if [[ "$BODY" != *"# Joe's Pizza"* || "$BODY" != *"## Core Pages"* || "$BODY" != *"/md"* || "$BODY" == *"/sites/joes-pizza"* ]]; then
  echo "Smoke check failed: custom domain llms.txt did not expose customer-host Markdown alternates" >&2
  echo "$BODY" >&2
  exit 1
fi

request_custom_host "$CUSTOM_DOMAIN_HOST" "/md"
assert_success "custom domain Markdown alternate"
if [[ "$BODY" != *"# Home"* || "$BODY" != *"Canonical:"* || "$BODY" != *"## Business"* ]]; then
  echo "Smoke check failed: custom domain Markdown alternate did not render public page content" >&2
  echo "$BODY" >&2
  exit 1
fi

post_check "owner assets API" "/api/assets/owner" '{"siteId":"site_joes_pizza","rightsAccepted":true,"logo":{"url":"https://assets.example/joes-logo.png","alt":"Joe'\''s Pizza logo"},"photos":[{"url":"https://assets.example/pizza-oven.jpg","alt":"Pizza oven"},{"url":"https://assets.example/catering-table.webp","alt":"Catering table"}]}'
assert_json "owner assets API" 'const data = JSON.parse(process.env.BODY); if (!data.ok || data.logo?.rightsStatus !== "customer_granted" || data.photos?.length !== 2 || !data.assets?.every((asset) => asset.ownerApproved === true && asset.usageScope === "published_site")) process.exit(1);'

post_check "owner asset upload API" "/api/assets/owner" '{"siteId":"site_joes_pizza","rightsAccepted":true,"logoUpload":{"base64":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=","mimeType":"image/png","alt":"Uploaded Joe'\''s Pizza logo"},"photoUploads":[{"base64":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=","mimeType":"image/png","alt":"Uploaded pizza oven"}]}'
assert_json "owner asset upload API" 'const data = JSON.parse(process.env.BODY); if (!data.ok || !data.logo?.url?.startsWith("/api/assets/") || data.logo?.rightsStatus !== "customer_granted" || data.photos?.length !== 1 || !data.photos[0]?.url?.startsWith("/api/assets/") || !data.assets?.every((asset) => asset.ownerApproved === true && asset.rightsStatus === "customer_granted")) process.exit(1);'
UPLOADED_LOGO_URL="$(BODY="$BODY" node -e 'const data = JSON.parse(process.env.BODY); process.stdout.write(data.logo.url);')"
UPLOADED_LOGO_STATUS="$(curl -sS -o /dev/null -w "%{http_code}" -H "x-forwarded-for: 203.0.113.10" "${BASE_URL}${UPLOADED_LOGO_URL}")"
if [[ "$UPLOADED_LOGO_STATUS" != "200" ]]; then
  echo "Smoke check failed: owner-approved local asset should be publicly served, got $UPLOADED_LOGO_STATUS" >&2
  exit 1
fi
echo "ok - owner-approved local asset serving"
PLATFORM_ASSET_PAYLOAD="$(UPLOADED_LOGO_URL="$UPLOADED_LOGO_URL" node -e 'process.stdout.write(JSON.stringify({siteId:"site_joes_pizza",rightsAccepted:true,logo:{url:process.env.UPLOADED_LOGO_URL,alt:"Uploaded Joe'\''s Pizza logo"}}));')"
post_check "owner platform asset URL API" "/api/assets/owner" "$PLATFORM_ASSET_PAYLOAD"
assert_json "owner platform asset URL API" 'const data = JSON.parse(process.env.BODY); if (!data.ok || !data.logo?.url?.startsWith("/api/assets/") || data.logo?.rightsStatus !== "customer_granted") process.exit(1);'

post_check "form settings API" "/api/forms/settings" '{"siteId":"site_joes_pizza","formId":"form_contact","name":"Catering and event requests","submitLabel":"Send catering request","notificationEmail":"leads@joespizza.example","webhookUrl":"","fields":[{"id":"name","label":"Name","type":"text","required":true},{"id":"email","label":"Email","type":"email","required":true},{"id":"phone","label":"Phone","type":"phone","required":false},{"id":"event_date","label":"Event date","type":"text","required":false},{"id":"message","label":"How can we help?","type":"textarea","required":true}]}'
assert_json "form settings API" 'const data = JSON.parse(process.env.BODY); if (!data.ok || data.form.submitLabel !== "Send catering request" || data.form.fields.length !== 5 || !data.workflows.some((workflow) => workflow.destination === "email" && workflow.config?.to === "leads@joespizza.example")) process.exit(1);'

post_check "form honeypot spam guard" "/api/forms/submit" '{"siteId":"site_joes_pizza","formId":"form_contact","pageId":"home","sessionId":"honeypot_form","companyWebsite":"https://spam.example","payload":{"name":"Spam Bot","email":"spam@example.com","message":"Should be ignored."}}'
assert_json "form honeypot spam guard" 'const data = JSON.parse(process.env.BODY); if (data.accepted !== true || data.status !== "ignored") process.exit(1);'

FAST_RENDERED_AT="$(node -e 'process.stdout.write(String(Date.now()))')"
post_check "form submit timing spam guard" "/api/forms/submit" "{\"siteId\":\"site_joes_pizza\",\"formId\":\"form_contact\",\"pageId\":\"home\",\"sessionId\":\"fast_form\",\"formRenderedAt\":${FAST_RENDERED_AT},\"payload\":{\"name\":\"Too Fast\",\"email\":\"fast@example.com\",\"message\":\"Should be ignored.\"}}"
assert_json "form submit timing spam guard" 'const data = JSON.parse(process.env.BODY); if (data.accepted !== true || data.status !== "ignored") process.exit(1);'

request POST "/api/forms/submit" '{"siteId":"site_joes_pizza","formId":"form_contact","pageId":"home","sessionId":"missing_required_form","payload":{"name":"Missing Required"}}'
if [[ "$STATUS" != "400" ]]; then
  echo "Smoke check failed: form required field validation returned $STATUS" >&2
  echo "$BODY" >&2
  exit 1
fi
assert_json "form required field validation" 'const data = JSON.parse(process.env.BODY); if (data.error !== "Required form fields are missing." || !Array.isArray(data.missingFields) || !data.missingFields.includes("email") || !data.missingFields.includes("message")) process.exit(1);'
echo "ok - form required field validation"

request POST "/api/forms/submit" '{"siteId":"site_joes_pizza","formId":"form_contact","pageId":"home","sessionId":"invalid_email_form","payload":{"name":"Invalid Email","email":"not-an-email","message":"Testing invalid email."}}'
if [[ "$STATUS" != "400" ]]; then
  echo "Smoke check failed: form invalid email validation returned $STATUS" >&2
  echo "$BODY" >&2
  exit 1
fi
assert_json "form invalid email validation" 'const data = JSON.parse(process.env.BODY); if (data.error !== "Form submission contains invalid fields." || !Array.isArray(data.invalidFields) || !data.invalidFields.some((field) => field.id === "email")) process.exit(1);'
echo "ok - form invalid email validation"

request GET "/api/sites"
assert_success "site API"
assert_json "site API" 'const data = JSON.parse(process.env.BODY); if (!Array.isArray(data.sites) || data.sites.length === 0) process.exit(1);'

post_check "audit API" "/api/audits/run" '{"siteId":"site_joes_pizza"}'
assert_json "audit API" 'const data = JSON.parse(process.env.BODY); if (data.siteId !== "site_joes_pizza" || !Array.isArray(data.findings)) process.exit(1);'

post_check "QA API" "/api/qa/run" '{"siteId":"site_joes_pizza","versionStatus":"published"}'
assert_json "QA API" 'const data = JSON.parse(process.env.BODY); if (data.siteId !== "site_joes_pizza" || typeof data.passed !== "boolean") process.exit(1);'

post_check "section variant update API" "/api/sites/design" '{"siteId":"site_joes_pizza","pageId":"page_home","sectionVariants":{"hero_home":"compact"}}'
assert_json "section variant update API" 'const data = JSON.parse(process.env.BODY); if (!data.ok || data.applied?.sectionVariants?.hero_home !== "compact") process.exit(1);'

post_check "theme and section order API" "/api/sites/design" '{"siteId":"site_joes_pizza","pageId":"page_home","themePreset":"premium","sectionOrder":["hero_home","menu_home","trust_home","gallery_home","contact_home","testimonials_home","cta_home"]}'
assert_json "theme and section order API" 'const data = JSON.parse(process.env.BODY); if (!data.ok || data.applied?.themePreset !== "premium" || data.applied?.sectionOrder?.[1] !== "menu_home") process.exit(1);'

post_check "AI edit dock API" "/api/ai/edit" '{"siteId":"site_joes_pizza","message":"Make the hero more direct, use a call CTA, and run an audit."}'
assert_json "AI edit dock API" 'const data = JSON.parse(process.env.BODY); if (!data.ok || !data.mutated || !data.operations?.some((operation) => operation.type === "rewrite_hero") || !data.operations?.some((operation) => operation.type === "update_cta") || !data.qa || data.published !== false || data.nextAction !== "review_and_confirm_publish") process.exit(1);'

post_check "analytics ingest" "/api/analytics" '{"siteId":"site_joes_pizza","sessionId":"smoke_session","pageId":"home","eventType":"pageview","event":{"path":"/sites/joes-pizza","smoke":true}}'
assert_json "analytics ingest" 'const data = JSON.parse(process.env.BODY); if (data.accepted !== true) process.exit(1);'

post_check "analytics scroll ingest" "/api/analytics" '{"siteId":"site_joes_pizza","sessionId":"smoke_session","pageId":"home","eventType":"scroll_depth","value":75,"metadata":{"path":"/sites/joes-pizza","smoke":true}}'
assert_json "analytics scroll ingest" 'const data = JSON.parse(process.env.BODY); if (data.accepted !== true) process.exit(1);'

post_check "analytics privacy sanitization" "/api/analytics" '{"siteId":"site_joes_pizza","sessionId":"privacy_session","pageId":"home","eventType":"pageview","timestamp":"2026-05-29T12:09:58.000Z","metadata":{"path":"/sites/joes-pizza?utm_source=mailer&email=owner@example.com&token=secret","sourceUrl":"https://example.com/landing?utm_campaign=postcard&phone=5125550101&gclid=abc123","ownerEmail":"owner@example.com","phoneNumber":"512-555-0101","message":"Call me","utmSource":"mailer"}}'
assert_json "analytics privacy sanitization" 'const data = JSON.parse(process.env.BODY); const metadata = data.event?.metadata || {}; if (metadata.path !== "/sites/joes-pizza?utm_source=mailer" || metadata.sourceUrl !== "https://example.com/landing?utm_campaign=postcard" || metadata.ownerEmail || metadata.phoneNumber || metadata.message || metadata.utmSource !== "mailer") process.exit(1);'

post_check "analytics LCP web vital ingest" "/api/analytics" '{"siteId":"site_joes_pizza","sessionId":"privacy_session","pageId":"home","eventType":"web_vital","timestamp":"2026-05-29T12:09:59.000Z","value":4200,"deviceType":"mobile","metadata":{"metric":"LCP"}}'
assert_json "analytics LCP web vital ingest" 'const data = JSON.parse(process.env.BODY); if (data.accepted !== true || data.event?.value !== 4200) process.exit(1);'

post_check "analytics CLS web vital ingest" "/api/analytics" '{"siteId":"site_joes_pizza","sessionId":"privacy_session","pageId":"home","eventType":"web_vital","timestamp":"2026-05-29T12:09:59.500Z","value":0.18,"deviceType":"mobile","metadata":{"metric":"CLS"}}'
assert_json "analytics CLS web vital ingest" 'const data = JSON.parse(process.env.BODY); if (data.accepted !== true || data.event?.value !== 0.18) process.exit(1);'

post_check "audit API with analytics finding" "/api/audits/run" '{"siteId":"site_joes_pizza"}'
assert_json "audit API with analytics finding" 'const data = JSON.parse(process.env.BODY); if (!Array.isArray(data.findings) || !data.findings.some((finding) => finding.id === "analytics_engaged_no_action") || !data.findings.some((finding) => finding.id === "analytics_mobile_performance" && finding.standardCriterionId === "technical.mobile_performance")) process.exit(1);'

post_check "action-list dismiss API" "/api/action-list/dismiss" '{"siteId":"site_joes_pizza","findingId":"analytics_engaged_no_action"}'
assert_json "action-list dismiss API" 'const data = JSON.parse(process.env.BODY); if (!data.ok || data.finding.status !== "dismissed") process.exit(1);'

post_check "audit preserves dismissed finding" "/api/audits/run" '{"siteId":"site_joes_pizza"}'
assert_json "audit preserves dismissed finding" 'const data = JSON.parse(process.env.BODY); const finding = data.findings?.find((item) => item.id === "analytics_engaged_no_action"); if (!finding || finding.status !== "dismissed") process.exit(1);'

post_check "analytics form start ingest" "/api/analytics" '{"siteId":"site_joes_pizza","sessionId":"smoke_session","pageId":"home","sectionId":"contact_home","eventType":"form_start","timestamp":"2026-05-29T12:10:01.000Z","deviceType":"mobile"}'
assert_json "analytics form start ingest" 'const data = JSON.parse(process.env.BODY); if (data.accepted !== true || data.event?.eventType !== "form_start") process.exit(1);'

post_check "analytics section view ingest" "/api/analytics" '{"siteId":"site_joes_pizza","sessionId":"privacy_session","pageId":"home","sectionId":"hero_home","eventType":"section_view","timestamp":"2026-05-29T12:10:00.000Z","metadata":{"elapsedMs":1000},"deviceType":"mobile"}'
assert_json "analytics section view ingest" 'const data = JSON.parse(process.env.BODY); if (data.accepted !== true || data.event?.eventType !== "section_view") process.exit(1);'

post_check "analytics click map ingest" "/api/analytics" '{"siteId":"site_joes_pizza","sessionId":"privacy_session","pageId":"home","sectionId":"hero_home","eventType":"tel_click","timestamp":"2026-05-29T12:10:03.000Z","elementRole":"sticky-tel","elementType":"a","hrefType":"tel","normalizedX":0.84,"normalizedY":0.18,"deviceType":"mobile","metadata":{"elapsedMs":3000}}'
assert_json "analytics click map ingest" 'const data = JSON.parse(process.env.BODY); if (data.accepted !== true || data.event?.normalizedX !== 0.84) process.exit(1);'

post_check "analytics generic click ingest" "/api/analytics" '{"siteId":"site_joes_pizza","sessionId":"privacy_session","pageId":"home","sectionId":"services_home","eventType":"click","elementRole":"div","elementType":"div","hrefType":"internal","normalizedX":0.42,"normalizedY":0.52,"deviceType":"desktop"}'
assert_json "analytics generic click ingest" 'const data = JSON.parse(process.env.BODY); if (data.accepted !== true || data.event?.elementType !== "div" || data.event?.normalizedY !== 0.52) process.exit(1);'

request GET "/api/analytics?siteId=site_joes_pizza"
assert_success "analytics summary API"
assert_json "analytics summary API" 'const data = JSON.parse(process.env.BODY); if (!Array.isArray(data.outcomesBySource) || !data.outcomesBySource.some((row) => row.key === "utm:mailer" && row.primaryActions >= 1) || !Array.isArray(data.clickMap) || !data.clickMap.some((point) => point.sectionId === "hero_home" && point.primaryActions >= 1) || !data.clickMap.some((point) => point.sectionId === "services_home" && point.elementRole === "div" && point.count >= 1) || !Array.isArray(data.sectionConversionPaths) || !data.sectionConversionPaths.some((row) => row.sectionId === "hero_home" && row.primaryActions >= 1 && row.medianTimeToActionMs === 2000) || !Array.isArray(data.funnelDropoffs) || !data.funnelDropoffs.some((row) => row.key === "form_start_to_submit" && row.fromCount >= 1 && row.toCount === 0 && row.dropoffRate === 1) || !Array.isArray(data.standardCorrelations) || !data.standardCorrelations.some((row) => row.criterionId === "conversion.mobile_sticky_action" && row.primaryActions >= 1) || !data.standardCorrelations.some((row) => row.criterionId === "technical.mobile_performance" && row.signal === "weak") || data.agentReadableRequests < 2 || !Array.isArray(data.agentReadableByResource) || !data.agentReadableByResource.some((row) => row.key === "llms_txt" && row.requests >= 1) || !data.agentReadableByResource.some((row) => row.key === "markdown_alternate" && row.requests >= 1)) process.exit(1);'

request GET "/"
assert_success "owner dashboard summary"
if [[ "$BODY" != *"Owner Summary"* || "$BODY" != *"Top Pages"* || "$BODY" != *"Traffic Sources"* || "$BODY" != *"Recent Changes"* || "$BODY" != *"utm:mailer"* ]]; then
  echo "Smoke check failed: owner dashboard did not render traffic, source, recommendations, and changes summaries" >&2
  exit 1
fi

post_check "old analytics ingest" "/api/analytics" '{"siteId":"site_joes_pizza","sessionId":"old_session","pageId":"home","eventType":"pageview","timestamp":"2020-01-01T00:00:00.000Z","metadata":{"path":"/sites/joes-pizza","smoke":true}}'
assert_json "old analytics ingest" 'const data = JSON.parse(process.env.BODY); if (data.accepted !== true || data.event?.timestamp !== "2020-01-01T00:00:00.000Z") process.exit(1);'

post_check "analytics retention API" "/api/analytics/retention" '{"siteId":"site_joes_pizza","before":"2021-01-01T00:00:00.000Z"}'
assert_json "analytics retention API" 'const data = JSON.parse(process.env.BODY); if (!data.ok || data.deleted < 1 || data.before !== "2021-01-01T00:00:00.000Z") process.exit(1);'

post_check "experiment assignment before opt-in" "/api/experiments/assign" '{"siteId":"site_joes_pizza","sessionId":"smoke_session"}'
assert_json "experiment assignment before opt-in" 'const data = JSON.parse(process.env.BODY); if (data.assigned !== false || !String(data.reason || "").includes("running")) process.exit(1);'

post_check "experiment opt-in API" "/api/experiments/update" '{"siteId":"site_joes_pizza","experimentId":"exp_sticky_cta_restaurant","status":"running"}'
assert_json "experiment opt-in API" 'const data = JSON.parse(process.env.BODY); if (!data.ok || data.experiment.status !== "running" || !data.experiment.startedAt) process.exit(1);'

post_check "experiment assignment after opt-in" "/api/experiments/assign" '{"siteId":"site_joes_pizza","sessionId":"smoke_session"}'
assert_json "experiment assignment after opt-in" 'const data = JSON.parse(process.env.BODY); if (data.assigned !== true || data.surface !== "sticky_cta" || !data.experimentId || !data.variant) process.exit(1);'

post_check "CTA experiment opt-in API" "/api/experiments/update" '{"siteId":"site_joes_pizza","experimentId":"exp_cta_placement_restaurant","status":"running"}'
assert_json "CTA experiment opt-in API" 'const data = JSON.parse(process.env.BODY); if (!data.ok || data.experiment.surface !== "cta_placement" || data.experiment.status !== "running") process.exit(1);'

post_check "CTA experiment assignment API" "/api/experiments/assign" '{"siteId":"site_joes_pizza","sessionId":"smoke_session","experimentId":"exp_cta_placement_restaurant"}'
assert_json "CTA experiment assignment API" 'const data = JSON.parse(process.env.BODY); if (data.assigned !== true || data.surface !== "cta_placement" || !data.variant?.id) process.exit(1);'

post_check "form experiment opt-in API" "/api/experiments/update" '{"siteId":"site_joes_pizza","experimentId":"exp_form_length_restaurant","status":"running"}'
assert_json "form experiment opt-in API" 'const data = JSON.parse(process.env.BODY); if (!data.ok || data.experiment.surface !== "form_length" || data.experiment.status !== "running") process.exit(1);'

post_check "hero experiment opt-in API" "/api/experiments/update" '{"siteId":"site_joes_pizza","experimentId":"exp_hero_layout_restaurant","status":"running"}'
assert_json "hero experiment opt-in API" 'const data = JSON.parse(process.env.BODY); if (!data.ok || data.experiment.surface !== "hero_layout" || data.experiment.status !== "running") process.exit(1);'

for i in $(seq 1 20); do
  if [[ "$i" -le 10 ]]; then
    VARIANT_ID="control"
  else
    VARIANT_ID="sticky_order"
  fi
  request POST "/api/analytics" "{\"siteId\":\"site_joes_pizza\",\"sessionId\":\"experiment_session_${i}\",\"pageId\":\"page_home\",\"eventType\":\"experiment_assignment\",\"metadata\":{\"experimentId\":\"exp_sticky_cta_restaurant\",\"variantId\":\"${VARIANT_ID}\"}}"
  assert_success "experiment synthetic assignment ${i}" >/dev/null
done

for i in 11 12 13 14; do
  request POST "/api/analytics" "{\"siteId\":\"site_joes_pizza\",\"sessionId\":\"experiment_session_${i}\",\"pageId\":\"page_home\",\"eventType\":\"outbound_click\",\"hrefType\":\"ordering\",\"metadata\":{\"role\":\"ordering\"}}"
  assert_success "experiment synthetic order action ${i}" >/dev/null
done

post_check "experiment learning API" "/api/experiments/learn" '{"siteId":"site_joes_pizza","experimentId":"exp_sticky_cta_restaurant"}'
assert_json "experiment learning API" 'const data = JSON.parse(process.env.BODY); if (!data.ok || data.experiment.status !== "concluded" || data.learning.status !== "active" || data.learning.winnerVariantId !== "sticky_order") process.exit(1);'

post_check "experiment rollback API" "/api/experiments/update" '{"siteId":"site_joes_pizza","experimentId":"exp_sticky_cta_restaurant","status":"rolled_back"}'
assert_json "experiment rollback API" 'const data = JSON.parse(process.env.BODY); if (!data.ok || data.experiment.status !== "rolled_back" || !data.experiment.rolledBackAt) process.exit(1);'

request GET "/api/experiments/learn?siteId=site_joes_pizza"
assert_success "experiment learning rollback list"
assert_json "experiment learning rollback list" 'const data = JSON.parse(process.env.BODY); const learning = data.learnings?.find((item) => item.experimentId === "exp_sticky_cta_restaurant"); if (!learning || learning.status !== "rolled_back" || !learning.rolledBackAt) process.exit(1);'

post_check "JSON form submission" "/api/forms/submit" '{"siteId":"site_joes_pizza","formId":"form_contact","pageId":"home","sessionId":"smoke_session","sourceUrl":"http://127.0.0.1:4330/sites/joes-pizza?utm_source=mailer&email=smoke@example.com&token=secret","payload":{"name":"Smoke Test","email":"smoke@example.com","message":"Testing the core lead path."},"metadata":{"landingPath":"/sites/joes-pizza","referrerHost":"local-smoke","ownerEmail":"smoke@example.com"}}'
assert_json "JSON form submission" 'const data = JSON.parse(process.env.BODY); if (data.siteId !== "site_joes_pizza" || data.formId !== "form_contact" || !data.id || !String(data.ipHash || "").startsWith("v1:") || String(data.ipHash).includes("203.0.113.10") || data.sourceUrl !== "http://127.0.0.1:4330/sites/joes-pizza?utm_source=mailer" || data.metadata?.ownerEmail) process.exit(1);'
LEAD_ID="$(BODY="$BODY" node -e 'const data = JSON.parse(process.env.BODY); process.stdout.write(data.id);')"

post_check "lead status API" "/api/leads/status" "{\"siteId\":\"site_joes_pizza\",\"submissionId\":\"${LEAD_ID}\",\"status\":\"reviewed\"}"
LEAD_ID="$LEAD_ID" assert_json "lead status API" 'const data = JSON.parse(process.env.BODY); if (!data.ok || data.lead?.status !== "reviewed" || data.lead?.id !== process.env.LEAD_ID) process.exit(1);'

request GET "/api/leads?siteId=site_joes_pizza"
assert_success "leads API"
LEAD_ID="$LEAD_ID" assert_json "leads API" 'const data = JSON.parse(process.env.BODY); if (!Array.isArray(data.leads) || !data.leads.some((lead) => lead.id === process.env.LEAD_ID && lead.status === "reviewed") || !Array.isArray(data.workflowDeliveries)) process.exit(1);'

request GET "/api/leads/export?siteId=site_joes_pizza"
assert_success "leads CSV export"
LEAD_ID="$LEAD_ID" BODY="$BODY" node -e 'const body = process.env.BODY || ""; if (!body.includes("\"id\",\"siteId\",\"formId\"") || !body.includes(process.env.LEAD_ID) || !body.includes("\"reviewed\"")) process.exit(1);' || {
  echo "Smoke check failed: leads CSV export returned unexpected CSV" >&2
  echo "$BODY" >&2
  exit 1
}
echo "ok - leads CSV export content"

request POST "/api/outbound/campaigns" '{"name":"High Volume Direct Mail","status":"running","channel":"direct_mail","metadata":{"plannedRecipients":250}}'
if [[ "$STATUS" != "409" ]]; then
  echo "Smoke check failed: high-volume outbound legal gate returned $STATUS" >&2
  echo "$BODY" >&2
  exit 1
fi
assert_json "high-volume outbound legal gate" 'const data = JSON.parse(process.env.BODY); if (!data.compliance?.highVolume || data.compliance?.reviewed !== false || !String(data.error || "").includes("legal")) process.exit(1);'
echo "ok - high-volume outbound legal gate"

post_check "outbound campaign API" "/api/outbound/campaigns" '{"name":"Smoke Direct Mail","status":"running","channel":"direct_mail"}'
assert_json "outbound campaign API" 'const data = JSON.parse(process.env.BODY); if (!data.id || data.status !== "running") process.exit(1);'
CAMPAIGN_ID="$(BODY="$BODY" node -e 'process.stdout.write(JSON.parse(process.env.BODY).id)')"

post_check "outbound prospect API" "/api/outbound/prospects" "{\"campaignId\":\"${CAMPAIGN_ID}\",\"siteId\":\"site_joes_pizza\",\"businessName\":\"Joe's Pizza\",\"vertical\":\"restaurant\",\"previewToken\":\"demo-token\"}"
assert_json "outbound prospect API" 'const data = JSON.parse(process.env.BODY); if (!data.id || data.businessName !== "Joe'\''s Pizza") process.exit(1);'
PROSPECT_ID="$(BODY="$BODY" node -e 'process.stdout.write(JSON.parse(process.env.BODY).id)')"

post_check "outbound event API" "/api/outbound/events" "{\"campaignId\":\"${CAMPAIGN_ID}\",\"prospectId\":\"${PROSPECT_ID}\",\"type\":\"mailer_sent\"}"
post_check "outbound claim event API" "/api/outbound/events" "{\"campaignId\":\"${CAMPAIGN_ID}\",\"prospectId\":\"${PROSPECT_ID}\",\"type\":\"claim_completed\"}"
post_check "outbound publish event API" "/api/outbound/events" "{\"campaignId\":\"${CAMPAIGN_ID}\",\"prospectId\":\"${PROSPECT_ID}\",\"type\":\"published\"}"
post_check "outbound credibility event API" "/api/outbound/events" "{\"campaignId\":\"${CAMPAIGN_ID}\",\"prospectId\":\"${PROSPECT_ID}\",\"type\":\"credibility_feedback\",\"value\":4}"

request GET "/api/outbound/summary?campaignId=${CAMPAIGN_ID}"
assert_success "outbound summary API"
assert_json "outbound summary API" 'const data = JSON.parse(process.env.BODY); if (data.mailerToClaimRate !== 1 || data.claimToPublishRate !== 1 || data.avgCredibilityScore !== 4) process.exit(1);'

post_check "action-list apply all" "/api/action-list/apply-all" '{"siteId":"site_joes_pizza","mode":"qa"}'
assert_json "action-list apply all" 'const data = JSON.parse(process.env.BODY); if (!Array.isArray(data.results) || !data.qa || data.published !== false || data.nextAction !== "review_and_confirm_publish") process.exit(1);'

request POST "/api/sites/publish" '{"siteId":"site_joes_pizza"}'
if [[ "$STATUS" != "409" ]]; then
  echo "Smoke check failed: publish confirmation guard returned $STATUS" >&2
  echo "$BODY" >&2
  exit 1
fi
echo "ok - publish confirmation guard"

request POST "/api/sites/update-section" '{"siteId":"site_joes_pizza","pageId":"page_home","sectionId":"hero_home","props":{"primaryCta":{"label":"","href":""}}}'
if [[ "$STATUS" != "400" ]]; then
  echo "Smoke check failed: editor CTA guardrail returned $STATUS" >&2
  echo "$BODY" >&2
  exit 1
fi
assert_json "editor CTA guardrail" 'const data = JSON.parse(process.env.BODY); if (!Array.isArray(data.issues) || !data.issues.some((issue) => issue.checkId === "primary_cta_guardrail")) process.exit(1);'
echo "ok - editor CTA guardrail"

request POST "/api/business-profile" '{"siteId":"site_joes_pizza","phone":""}'
if [[ "$STATUS" != "400" ]]; then
  echo "Smoke check failed: business phone guardrail returned $STATUS" >&2
  echo "$BODY" >&2
  exit 1
fi
assert_json "business phone guardrail" 'const data = JSON.parse(process.env.BODY); if (!Array.isArray(data.issues) || !data.issues.some((issue) => issue.checkId === "phone_path")) process.exit(1);'
echo "ok - business phone guardrail"

post_check "business press links update API" "/api/business-profile" '{"siteId":"site_joes_pizza","pressLinks":["https://www.youtube.com/watch?v=owner-approved","https://news.example/profile"]}'
assert_json "business press links update API" 'const data = JSON.parse(process.env.BODY); if (!data.ok || data.businessProfile?.pressLinks?.length !== 2 || data.businessProfile?.provenance?.pressLinks?.source !== "owner" || data.businessProfile?.provenance?.pressLinks?.verified !== true) process.exit(1);'

post_check "curated CTA update API" "/api/sites/update-section" '{"siteId":"site_joes_pizza","pageId":"page_home","sectionId":"hero_home","props":{"primaryCta":{"label":"Call Now","href":"tel:+15551234567","role":"tel"}}}'
assert_json "curated CTA update API" 'const data = JSON.parse(process.env.BODY); if (!data.ok || data.bundle?.siteModel?.versions?.[0]?.pages?.[0]?.sections?.find((section) => section.id === "hero_home")?.props?.primaryCta?.role !== "tel") process.exit(1);'

post_check "structured proof update API" "/api/sites/update-section" '{"siteId":"site_joes_pizza","pageId":"page_home","sectionId":"testimonials_home","props":{"items":[{"quote":"Owner-approved catering proof after claim.","author":"Joe'\''s Pizza customer"},{"quote":"Private events and family dinners are supported.","author":"Owner verified"}]}}'
assert_json "structured proof update API" 'const data = JSON.parse(process.env.BODY); const section = data.bundle?.siteModel?.versions?.[0]?.pages?.[0]?.sections?.find((item) => item.id === "testimonials_home"); if (!data.ok || section?.props?.items?.length !== 2 || section.props.items[0].author !== "Joe'\''s Pizza customer") process.exit(1);'

post_check "draft staging API" "/api/sites/update-section" '{"siteId":"site_joes_pizza","pageId":"page_home","sectionId":"hero_home","props":{"heading":"Pizza night should still be easy."}}'
assert_json "draft staging API" 'const data = JSON.parse(process.env.BODY); if (!data.ok || !data.bundle) process.exit(1);'

post_check "confirmed publish API" "/api/sites/publish" '{"siteId":"site_joes_pizza","confirmed":true}'
assert_json "confirmed publish API" 'const data = JSON.parse(process.env.BODY); if (!data.ok || !data.confirmed || !data.qa?.passed) process.exit(1);'

post_check "version restore draft API" "/api/sites/versions" '{"siteId":"site_joes_pizza","versionId":"version_joes_pizza_published","action":"restore_draft"}'
assert_json "version restore draft API" 'const data = JSON.parse(process.env.BODY); const live = data.bundle?.siteModel?.versions?.find((version) => version.status === "published"); const restored = data.bundle?.siteModel?.versions?.find((version) => version.id === data.draftVersionId); if (!data.ok || !data.draftVersionId || restored?.status !== "draft" || live?.id === data.draftVersionId || !data.qa?.checks?.length) process.exit(1);'

echo "Smoke checks passed for $BASE_URL"
