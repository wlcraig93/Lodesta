import "./load-env.mjs";
import { fileURLToPath } from "node:url";

const baseUrl = (process.env.LODESTA_API_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:4330").replace(
  /\/$/,
  ""
);
const adminToken = process.env.LODESTA_ADMIN_TOKEN;

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help") {
    printHelp();
    return;
  }

  switch (command) {
    case "create-site-from-url":
      requireArgs(command, args, 1);
      await printJson(post("/api/intake", { url: args[0], prompt: args.slice(1).join(" ") || undefined }));
      return;
    case "generate-draft":
      requireArgs(command, args, 1);
      await printJson(post("/api/intake", { prompt: args.join(" ") }));
      return;
    case "run-presence":
      requireArgs(command, args, 1);
      await printJson(post("/api/presence/assess", { url: args[0] }));
      return;
    case "run-audit":
      requireArgs(command, args, 1);
      await printJson(post("/api/audits/run", { siteId: args[0] }));
      return;
    case "run-qa":
      requireArgs(command, args, 1);
      await printJson(post("/api/qa/run", { siteId: args[0], versionStatus: args[1] === "draft" ? "draft" : "published" }));
      return;
    case "publish":
      requireArgs(command, args, 1);
      await printJson(post("/api/sites/publish", { siteId: args[0], confirmed: true }));
      return;
    case "restore-version":
      requireArgs(command, args, 2);
      await printJson(post("/api/sites/versions", { siteId: args[0], versionId: args[1], action: "restore_draft" }));
      return;
    case "apply-safe-findings":
      requireArgs(command, args, 1);
      await printJson(post("/api/action-list/apply-all", { siteId: args[0], mode: args[1] === "qa" ? "qa" : "draft" }));
      return;
    case "dismiss-finding":
      requireArgs(command, args, 2);
      await printJson(post("/api/action-list/dismiss", { siteId: args[0], findingId: args[1] }));
      return;
    case "create-preview":
      requireArgs(command, args, 1);
      await printJson(post("/api/preview-tokens", { siteId: args[0] }));
      return;
    case "connect-domain":
      requireArgs(command, args, 2);
      await printJson(post("/api/domains", { siteId: args[0], hostname: args[1], provider: "cloudflare_for_saas" }));
      return;
    case "refresh-domain":
      requireArgs(command, args, 1);
      await printJson(post("/api/domains/refresh", { domainId: args[0] }));
      return;
    case "update-business":
      requireArgs(command, args, 2);
      await printJson(post("/api/business-profile", { siteId: args[0], ...JSON.parse(args.slice(1).join(" ")) }));
      return;
    case "inspect-leads":
      await printJson(get(`/api/leads${args[0] ? `?siteId=${encodeURIComponent(args[0])}` : ""}`));
      return;
    case "update-experiment":
      requireArgs(command, args, 3);
      await printJson(post("/api/experiments/update", { siteId: args[0], experimentId: args[1], status: args[2] }));
      return;
    case "adopt-experiment-learning":
      requireArgs(command, args, 2);
      await printJson(post("/api/experiments/learn", { siteId: args[0], experimentId: args[1] }));
      return;
    case "enqueue-job":
      requireArgs(command, args, 1);
      await printJson(post("/api/jobs", { kind: args[0], payload: parsePayload(args.slice(1)) }));
      return;
    case "import-batch": {
      requireArgs(command, args, 1);
      const payload = parseImportBatchPayload(args);
      const job = await post("/api/jobs", { kind: "import_batch", payload });
      const processed = await post("/api/jobs/process", { limit: 1 });
      await printJson(Promise.resolve({ job, processed }));
      return;
    }
    case "monthly-action-list": {
      requireArgs(command, args, 1);
      const job = await post("/api/jobs", { kind: "monthly_action_list", payload: { siteId: args[0] } });
      const processed = await post("/api/jobs/process", { limit: 1 });
      await printJson(Promise.resolve({ job, processed }));
      return;
    }
    case "create-outbound-campaign":
      requireArgs(command, args, 1);
      await printJson(post("/api/outbound/campaigns", { name: args.join(" "), status: "running", channel: "direct_mail" }));
      return;
    case "add-outbound-prospect":
      requireArgs(command, args, 2);
      await printJson(post("/api/outbound/prospects", { campaignId: args[0], ...JSON.parse(args.slice(1).join(" ")) }));
      return;
    case "record-outbound-event":
      requireArgs(command, args, 2);
      await printJson(post("/api/outbound/events", { campaignId: args[0], ...JSON.parse(args.slice(1).join(" ")) }));
      return;
    case "outbound-summary":
      await printJson(get(`/api/outbound/summary${args[0] ? `?campaignId=${encodeURIComponent(args[0])}` : ""}`));
      return;
    case "outbound-manifest": {
      const csv = args.includes("csv");
      const campaignId = args.find((arg) => arg !== "csv");
      const query = new URLSearchParams();
      if (campaignId) query.set("campaignId", campaignId);
      if (csv) query.set("format", "csv");
      const path = `/api/outbound/export${query.size ? `?${query.toString()}` : ""}`;
      if (csv) process.stdout.write(await getText(path));
      else await printJson(get(path));
      return;
    }
    case "schedule-maintenance":
      await printJson(post("/api/jobs/schedule", parseScheduleArgs(args)));
      return;
    case "process-jobs":
      await printJson(post("/api/jobs/process", { limit: args[0] ? Number(args[0]) : undefined }));
      return;
    case "list-sites":
      await printJson(get("/api/sites"));
      return;
    case "health":
      await printJson(get(`/api/health${args[0] === "deep" || args[0] === "ready" ? "?deep=1" : ""}`));
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

async function get(path) {
  const response = await fetch(`${baseUrl}${path}`, { headers: authHeaders() });
  return parseResponse(response);
}

async function getText(path) {
  const response = await fetch(`${baseUrl}${path}`, { headers: authHeaders() });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text}`);
  }
  return text;
}

async function post(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body)
  });
  return parseResponse(response);
}

function authHeaders() {
  return adminToken ? { Authorization: `Bearer ${adminToken}` } : {};
}

async function parseResponse(response) {
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${JSON.stringify(json)}`);
  }
  return json;
}

function parsePayload(args) {
  if (args.length === 0) return {};
  const raw = args.join(" ");
  if (raw.trim().startsWith("{")) return JSON.parse(raw);
  const payload = {};
  for (const arg of args) {
    const [key, ...valueParts] = arg.split("=");
    if (!key || valueParts.length === 0) continue;
    payload[key] = valueParts.join("=");
  }
  return payload;
}

export function parseImportBatchPayload(args) {
  const raw = args.join(" ").trim();
  if (args.length === 1 && /^[{[]/.test(raw)) {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return { urls: parsed.filter(isHttpUrl) };
    if (parsed && typeof parsed === "object") return parsed;
    throw new Error("import-batch JSON must be an object payload or an array of URLs.");
  }
  if (args.length === 1 && /[\n,]/.test(raw)) return { text: raw };
  return { urls: args.filter(isHttpUrl) };
}

function isHttpUrl(value) {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

function parseScheduleArgs(args) {
  const payload = {};
  const task = args.find((arg) => ["monthly_action_lists", "launch_maintenance"].includes(arg));
  if (task) payload.task = task;
  const siteIds = args.filter(
    (arg) => !["monthly_action_lists", "launch_maintenance"].includes(arg)
  );
  if (siteIds.length) payload.siteIds = siteIds;
  return payload;
}

async function printJson(promise) {
  const result = await promise;
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function requireArgs(command, args, count) {
  if (args.length < count) {
    throw new Error(`${command} requires at least ${count} argument${count === 1 ? "" : "s"}.`);
  }
}

function printHelp() {
  process.stdout.write(`Lodesta admin CLI

Base URL: ${baseUrl}

Commands:
  create-site-from-url <url> [prompt]       Import a URL and generate a structured site
  generate-draft <prompt>                  Generate a site from a prompt
  run-presence <url>                       Crawl and score an existing URL
  run-audit <siteId>                       Run the optimization audit
  run-qa <siteId> [published|draft]         Run QA checks
  publish <siteId>                         Confirm and publish the current QA-passing draft
  restore-version <siteId> <versionId>      Restore a historical version into a QA-checkable draft
  apply-safe-findings <siteId> [qa]         Apply auto-fix/one-click findings and optionally run QA
  dismiss-finding <siteId> <findingId>      Dismiss an action-list finding after review
  create-preview <siteId>                  Create a tokenized noindex preview URL
  connect-domain <siteId> <hostname>        Register a custom hostname and print verification
  refresh-domain <domainId>                 Refresh custom-domain provider status
  update-business <siteId> <json>           Update owner-truth business facts
  inspect-leads [siteId]                   List captured leads
  update-experiment <siteId> <expId> <status> Start, pause, conclude, or rollback an experiment
  adopt-experiment-learning <siteId> <expId> Adopt a detected experiment winner into generation defaults
  enqueue-job <kind> [key=value|json]       Queue a worker job
  import-batch <url...|json>                Import URLs, generate sites, and create previews
  monthly-action-list <siteId>              Queue and process a site action-list job
  create-outbound-campaign <name>           Create a running direct-mail test campaign
  add-outbound-prospect <campaignId> <json> Add or update an outbound prospect
  record-outbound-event <campaignId> <json> Record outbound test event
  outbound-summary [campaignId]             Summarize outbound wedge metrics
  outbound-manifest [campaignId] [csv]      Export outbound mailer/prospect manifest
  schedule-maintenance [task] [siteId]      Queue cron maintenance jobs without processing them
  process-jobs [limit]                     Process queued jobs
  list-sites                               List generated sites
  health [deep]                            Check app liveness or admin readiness

Set LODESTA_API_URL to target a non-local deployment.
`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
