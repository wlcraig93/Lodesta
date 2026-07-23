import "./load-env.mjs";
import { fileURLToPath } from "node:url";

const baseUrl = (process.env.LODESTA_API_URL ?? process.env.LODESTA_APP_ORIGIN ?? "http://127.0.0.1:4330").replace(/\/$/, "");
const adminToken = process.env.LODESTA_ADMIN_TOKEN;

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "help" || command === "--help") return help();
  switch (command) {
    case "create-site-from-url":
      requireArgs(command, args, 1);
      return print(post("/api/site-agent/sites", { url: args[0], slug: args[1] }));
    case "site-workspace":
      requireArgs(command, args, 1);
      return print(get(`/api/site-agent/sessions?siteId=${encodeURIComponent(args[0])}`));
    case "apply-edit":
      requireArgs(command, args, 2);
      return print(post("/api/site-agent/runs", { sessionId: args[0], instruction: args.slice(1).join(" ") }));
    case "run-status":
      requireArgs(command, args, 1);
      return print(get(`/api/site-agent/runs/${encodeURIComponent(args[0])}`));
    case "publish-version":
      requireArgs(command, args, 1);
      return print(post(`/api/site-versions/${encodeURIComponent(args[0])}/publish`, {}));
    case "restore-version":
      requireArgs(command, args, 1);
      return print(post(`/api/site-versions/${encodeURIComponent(args[0])}/restore`, {}));
    case "connect-domain":
      requireArgs(command, args, 2);
      return print(post("/api/domains", { siteId: args[0], hostname: args[1] }));
    case "refresh-domain":
      requireArgs(command, args, 1);
      return print(post("/api/domains/refresh", { domainId: args[0] }));
    case "request-change":
      requireArgs(command, args, 2);
      return print(post("/api/control-plane/changes", { siteId: args[0], payload: JSON.parse(args.slice(1).join(" ")) }));
    case "inspect-inquiries":
      return print(get(`/api/inquiries${args[0] ? `?siteId=${encodeURIComponent(args[0])}` : ""}`));
    case "process-runs":
      return print(post("/api/site-agent/maintenance", { limit: args[0] ? Number(args[0]) : undefined }));
    case "create-outbound-campaign":
      requireArgs(command, args, 1);
      return print(post("/api/outbound/campaigns", { name: args.join(" "), status: "running", channel: "direct_mail" }));
    case "outbound-summary":
      return print(get(`/api/outbound/summary${args[0] ? `?campaignId=${encodeURIComponent(args[0])}` : ""}`));
    case "health":
      return print(get(`/api/health${args[0] === "deep" ? "?deep=1" : ""}`));
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

async function get(path) { return parse(await fetch(`${baseUrl}${path}`, { headers: headers() })); }
async function post(path, body) { return parse(await fetch(`${baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers() }, body: JSON.stringify(body) })); }
function headers() { return adminToken ? { authorization: `Bearer ${adminToken}` } : {}; }
async function parse(response) { const text = await response.text(); const value = text ? JSON.parse(text) : null; if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(value)}`); return value; }
async function print(value) { process.stdout.write(`${JSON.stringify(await value, null, 2)}\n`); }
function requireArgs(command, args, count) { if (args.length < count) throw new Error(`${command} requires at least ${count} argument(s).`); }
function help() { process.stdout.write(`Lodesta admin CLI\n\ncreate-site-from-url <url> [slug]\nsite-workspace <siteId>\napply-edit <sessionId> <instruction>\nrun-status <runId>\npublish-version <versionId>\nrestore-version <versionId>\nconnect-domain <siteId> <hostname>\nrefresh-domain <domainId>\nrequest-change <siteId> <json>\ninspect-inquiries [siteId]\nprocess-runs [limit]\ncreate-outbound-campaign <name>\noutbound-summary [campaignId]\nhealth [deep]\n`); }

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exit(1); });
