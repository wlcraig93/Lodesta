import "./load-env.mjs";

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
      await printJson(post("/api/sites/publish", { siteId: args[0] }));
      return;
    case "apply-safe-findings":
      requireArgs(command, args, 1);
      await printJson(post("/api/action-list/apply-all", { siteId: args[0], mode: args[1] === "publish" ? "publish_after_qa" : "draft" }));
      return;
    case "create-preview":
      requireArgs(command, args, 1);
      await printJson(post("/api/preview-tokens", { siteId: args[0] }));
      return;
    case "connect-domain":
      requireArgs(command, args, 2);
      await printJson(post("/api/domains", { siteId: args[0], hostname: args[1], provider: "cloudflare_for_saas" }));
      return;
    case "update-business":
      requireArgs(command, args, 2);
      await printJson(post("/api/business-profile", { siteId: args[0], ...JSON.parse(args.slice(1).join(" ")) }));
      return;
    case "inspect-leads":
      await printJson(get(`/api/leads${args[0] ? `?siteId=${encodeURIComponent(args[0])}` : ""}`));
      return;
    case "enqueue-job":
      requireArgs(command, args, 1);
      await printJson(post("/api/jobs", { kind: args[0], payload: parsePayload(args.slice(1)) }));
      return;
    case "import-batch": {
      requireArgs(command, args, 1);
      const payload = args.length === 1 && args[0].trim().startsWith("{")
        ? JSON.parse(args[0])
        : { urls: args.filter((arg) => /^https?:\/\//i.test(arg)) };
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
  publish <siteId>                         Publish the current draft
  apply-safe-findings <siteId> [publish]    Apply auto-fix/one-click findings, optionally publish after QA
  create-preview <siteId>                  Create a tokenized noindex preview URL
  connect-domain <siteId> <hostname>        Register a custom hostname and print verification
  update-business <siteId> <json>           Update owner-truth business facts
  inspect-leads [siteId]                   List captured leads
  enqueue-job <kind> [key=value|json]       Queue a worker job
  import-batch <url...|json>                Import URLs, generate sites, and create previews
  monthly-action-list <siteId>              Queue and process a site action-list job
  process-jobs [limit]                     Process queued jobs
  list-sites                               List generated sites
  health [deep]                            Check app liveness or admin readiness

Set LODESTA_API_URL to target a non-local deployment.
`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
