import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
const env = readFileSync(".env.example", "utf8");
const web = readFileSync("railway.toml", "utf8");
const watchdog = readFileSync("workers/recovery-watchdog/wrangler.jsonc", "utf8");
const watchdogSource = readFileSync("workers/recovery-watchdog/src/index.ts", "utf8");
const workerSource = readFileSync("workers/runner.ts", "utf8");
const instrumentation = readFileSync("instrumentation.ts", "utf8");
const maintenanceRoute = readFileSync("app/api/site-agent/maintenance/route.ts", "utf8");
const prospectRoute = readFileSync("app/api/prospect-reports/route.ts", "utf8");
const publicRoute = readFileSync("app/sites/[slug]/[[...path]]/route.ts", "utf8");
const publicSite = readFileSync("packages/site-platform/public-site.ts", "utf8");
const architecture = readFileSync("scripts/verify-site-authoring-architecture.ts", "utf8");

for (const name of ["typecheck", "smoke:dev", "experiment:site", "verify:render-browser", "verify:site-authoring-platform", "verify:site-authoring-walking-skeleton", "verify:site-walking-skeleton", "verify:agent-ready-sites", "verify:r2-lifecycle", "verify:site-authoring-architecture"]) {
  assert(packageJson.scripts[name], `Missing npm script ${name}.`);
}
for (const name of ["LODESTA_SANDBOX_URL=", "LODESTA_SANDBOX_TOKEN=", "LODESTA_ARTIFACT_BROKER_URL=", "LODESTA_ARTIFACT_BROKER_TOKEN=", "LODESTA_RECOVERY_WATCHDOG_URL=", "LODESTA_RECOVERY_WATCHDOG_TOKEN=", "LODESTA_R2_AUDIT_ACCESS_KEY_ID=", "LODESTA_R2_MAINTENANCE_ACCESS_KEY_ID=", "OPENAI_API_KEY="]) {
  assert(env.includes(name), `.env.example must document ${name}`);
}
assert(web.includes('healthcheckPath = "/api/health"'), "Railway web health check must use /api/health.");
assert(web.includes('startCommand = "PLAYWRIGHT_BROWSERS_PATH=0 npm run start"'), "Railway web service must start Next.js.");
assert(!existsSync("deploy/railway-worker.toml"), "The obsolete production Railway polling worker config must be absent.");
assert(workerSource.includes("localRecoveryStaleAfterMs") && workerSource.includes("processNextProspectReportJob"), "The local-only worker must preserve fast development recovery and prospect processing.");
assert(watchdog.includes('"crons": ["*/15 * * * *"]'), "Recovery watchdog must run every fifteen minutes.");
assert(!/r2_buckets|durable_objects|containers|queues/.test(watchdog), "Recovery watchdog must not bind stateful Cloudflare resources.");
assert(watchdogSource.includes("scheduled(") && watchdogSource.includes("LODESTA_RECOVERY_WATCHDOG_TOKEN"), "Recovery watchdog scheduled handler is incomplete.");
assert(instrumentation.includes('NEXT_PHASE !== "phase-production-build"') && instrumentation.includes('NEXT_RUNTIME === "nodejs"'), "Startup recovery must be Node-only and skip production builds.");
assert(maintenanceRoute.includes("hasValidRecoveryWatchdogToken") && maintenanceRoute.includes("processAutomaticRecovery"), "Maintenance route is missing machine recovery scheduling.");
assert(prospectRoute.includes("after(async") && prospectRoute.includes("processNextProspectReportJob"), "Prospect reports must schedule immediate processing.");
assert(publicRoute.includes("readVerifiedArtifactFile"), "Public serving must verify immutable artifact bytes.");
assert(publicRoute.includes("loadPublishedSiteContext") && publicSite.includes('artifact.qa.hardGate !== "passed"'), "Public serving must reject unverified artifacts.");
assert(architecture.includes("forbiddenFiles") && architecture.includes("forbiddenArchitecture"), "Architecture ratchet must reject retired contracts.");
assert(architecture.includes("site-build-artifact-v1"), "Architecture ratchet must enforce V4 artifact finalization.");

process.stdout.write(`${JSON.stringify({ ok: true, web: "railway.toml", watchdog: "workers/recovery-watchdog/wrangler.jsonc", localWorker: "workers/runner.ts", generation: "site-authoring" }, null, 2)}\n`);
