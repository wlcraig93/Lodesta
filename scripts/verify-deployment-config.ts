import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
const env = readFileSync(".env.example", "utf8");
const web = readFileSync("railway.toml", "utf8");
const worker = readFileSync("deploy/railway-worker.toml", "utf8");
const workerSource = readFileSync("workers/runner.ts", "utf8");
const publicRoute = readFileSync("app/sites/[slug]/[[...path]]/route.ts", "utf8");
const architecture = readFileSync("scripts/verify-agentic-architecture.ts", "utf8");

for (const name of ["typecheck", "smoke:dev", "verify:render-browser", "verify:agentic-site-platform-v1", "verify:agentic-site-walking-skeleton", "verify:agentic-architecture"]) {
  assert(packageJson.scripts[name], `Missing npm script ${name}.`);
}
for (const name of ["LODESTA_SANDBOX_URL=", "LODESTA_SANDBOX_TOKEN=", "LODESTA_R2_BRIDGE_URL=", "LODESTA_R2_BRIDGE_TOKEN=", "OPENAI_API_KEY="]) {
  assert(env.includes(name), `.env.example must document ${name}`);
}
assert(web.includes('healthcheckPath = "/api/health"'), "Railway web health check must use /api/health.");
assert(web.includes('startCommand = "PLAYWRIGHT_BROWSERS_PATH=0 npm run start"'), "Railway web service must start Next.js.");
assert(worker.includes('startCommand = "PLAYWRIGHT_BROWSERS_PATH=0 npm run worker -- work"'), "Railway worker must run the V4 worker loop.");
assert(workerSource.includes("processRecoverableRuns"), "Worker must process durable site-agent runs.");
assert(workerSource.includes("claimNextProspectReportJob"), "Worker must preserve the independent presence-report queue.");
assert(publicRoute.includes("readVerifiedArtifactFile"), "Public serving must verify immutable artifact bytes.");
assert(publicRoute.includes("artifact.qa.hardGate !== \"passed\""), "Public serving must reject unverified artifacts.");
assert(architecture.includes("forbiddenFiles") && architecture.includes("forbiddenArchitecture"), "Architecture ratchet must reject retired contracts.");
assert(architecture.includes("site-build-artifact-v1"), "Architecture ratchet must enforce V4 artifact finalization.");

process.stdout.write(`${JSON.stringify({ ok: true, web: "railway.toml", worker: "deploy/railway-worker.toml", generation: "agentic-v4" }, null, 2)}\n`);
