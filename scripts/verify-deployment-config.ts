import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
const env = readFileSync(".env.example", "utf8");
const web = readFileSync("railway.toml", "utf8");
const watchdog = readFileSync("workers/recovery-watchdog/wrangler.jsonc", "utf8");
const watchdogSource = readFileSync("workers/recovery-watchdog/src/index.ts", "utf8");
const workerSource = readFileSync("workers/runner.ts", "utf8");
const sandboxWorkerSource = readFileSync("workers/site-sandbox/src/index.ts", "utf8");
const sandboxClientSource = readFileSync("packages/site-sandbox/client.ts", "utf8");
const instrumentation = readFileSync("instrumentation.ts", "utf8");
const maintenanceRoute = readFileSync("app/api/site-agent/maintenance/route.ts", "utf8");
const prospectRoute = readFileSync("app/api/prospect-reports/route.ts", "utf8");
const publicRoute = readFileSync("app/sites/[slug]/[[...path]]/route.ts", "utf8");
const publicSite = readFileSync("packages/site-platform/public-site.ts", "utf8");
const architecture = readFileSync("scripts/verify-site-authoring-architecture.ts", "utf8");
const marketingHome = readFileSync("app/(marketing)/page.tsx", "utf8");
const marketingShell = readFileSync("components/MarketingShell.tsx", "utf8");
const privacyPage = readFileSync("app/(marketing)/privacy/page.tsx", "utf8");
const termsPage = readFileSync("app/(marketing)/terms/page.tsx", "utf8");
const sitemap = readFileSync("app/sitemap.ts", "utf8");

for (const name of ["typecheck", "smoke:dev", "verify:render-browser", "verify:architecture", "verify:database", "verify:authoring", "verify:runtime", "verify:account-setup-domain", "verify:acquisition"]) {
  assert(packageJson.scripts[name], `Missing npm script ${name}.`);
}
for (const name of ["LODESTA_SANDBOX_URL=", "LODESTA_SANDBOX_TOKEN=", "LODESTA_ARTIFACT_BROKER_URL=", "LODESTA_ARTIFACT_BROKER_TOKEN=", "LODESTA_RECOVERY_WATCHDOG_URL=", "LODESTA_RECOVERY_WATCHDOG_TOKEN=", "LODESTA_R2_AUDIT_ACCESS_KEY_ID=", "LODESTA_R2_MAINTENANCE_ACCESS_KEY_ID=", "OPENAI_API_KEY=", "OPENROUTER_API_KEY=", "LODESTA_SITE_AGENT_PROVIDER="]) {
  assert(env.includes(name), `.env.example must document ${name}`);
}
assert(web.includes('healthcheckPath = "/api/health"'), "Railway web health check must use /api/health.");
assert(web.includes('startCommand = "PLAYWRIGHT_BROWSERS_PATH=0 npm run start"'), "Railway web service must start Next.js.");
assert(!existsSync("deploy/railway-worker.toml"), "The obsolete production Railway polling worker config must be absent.");
assert(workerSource.includes("localRecoveryStaleAfterMs") && workerSource.includes("processNextWebsiteAssessmentJob"), "The local-only worker must preserve fast development recovery and canonical assessment processing.");
assert(
  sandboxWorkerSource.includes("[a-z0-9_-]{1,80}")
    && sandboxClientSource.includes("[a-z0-9_-]{1,80}"),
  "Sandbox transport must accept canonical underscore-prefixed session IDs on both sides."
);
assert(watchdog.includes('"crons": ["*/15 * * * *"]'), "Recovery watchdog must run every fifteen minutes.");
assert(!/r2_buckets|durable_objects|containers|queues/.test(watchdog), "Recovery watchdog must not bind stateful Cloudflare resources.");
assert(watchdogSource.includes("scheduled(") && watchdogSource.includes("LODESTA_RECOVERY_WATCHDOG_TOKEN"), "Recovery watchdog scheduled handler is incomplete.");
assert(instrumentation.includes('NEXT_PHASE !== "phase-production-build"') && instrumentation.includes('NEXT_RUNTIME === "nodejs"'), "Startup recovery must be Node-only and skip production builds.");
assert(maintenanceRoute.includes("hasValidRecoveryWatchdogToken") && maintenanceRoute.includes("processAutomaticRecovery"), "Maintenance route is missing machine recovery scheduling.");
assert(prospectRoute.includes("after(async") && prospectRoute.includes("processNextWebsiteAssessmentJob"), "Prospect reports must schedule immediate canonical assessment processing.");
assert(publicRoute.includes("readVerifiedArtifactFile"), "Public serving must verify immutable artifact bytes.");
assert(publicRoute.includes("loadPublishedSiteContext") && publicSite.includes('artifact.qa.hardGate !== "passed"'), "Public serving must reject unverified artifacts.");
assert(
  architecture.includes("platformSiteSchema")
    && architecture.includes("publicBuildInputSchema")
    && architecture.includes("canonicalMigration"),
  "Architecture ratchet must enforce canonical local contracts and the baseline."
);
assert(marketingHome.includes("Lodesta runs your website. You run your business."), "OAuth homepage must name Lodesta in its primary heading.");
assert(
  marketingHome.includes("Lodesta is an AI-powered website and local-presence platform for U.S. small businesses.")
    && marketingHome.includes("Sign in to create, customize, publish, and manage your website"),
  "OAuth homepage must clearly explain Lodesta's purpose and authenticated capabilities."
);
for (const value of ['applicationName: "Lodesta"', 'canonical: homepageUrl', 'siteName: "Lodesta"']) {
  assert(marketingHome.includes(value), `OAuth homepage metadata must include ${value}.`);
}
for (const value of ['href="/privacy/"', 'href="/terms/"', 'href="mailto:willie@lodesta.com"']) {
  assert(marketingShell.includes(value), `Marketing footer must include ${value}.`);
}
assert(!/placeholder/i.test(`${privacyPage}\n${termsPage}`), "Public legal pages must not contain placeholder language.");
assert(!/\bGroq\b/.test(privacyPage), "Privacy policy must not retain the obsolete Groq disclosure.");
for (const value of ["Google sign-in", "Supabase", "Railway", "Cloudflare", "OpenAI", "OpenRouter", "Resend", "willie@lodesta.com"]) {
  assert(privacyPage.includes(value), `Privacy policy must disclose ${value}.`);
}
for (const [name, page] of [["Privacy", privacyPage], ["Terms", termsPage]] as const) {
  assert(page.includes("index: true") && page.includes("follow: true"), `${name} page must be indexable and crawlable.`);
  assert(page.includes("willie@lodesta.com"), `${name} page must include the monitored support address.`);
}
assert(termsPage.includes("does not offer a paid plan"), "Terms must disclose the current pre-launch commercial status.");
assert(termsPage.includes("must be reviewed by qualified legal counsel"), "Terms must require counsel review before a paid launch.");
assert(sitemap.includes('`${baseUrl}/privacy/`') && sitemap.includes('`${baseUrl}/terms/`'), "Sitemap must include the canonical public legal pages.");

process.stdout.write(`${JSON.stringify({ ok: true, web: "railway.toml", watchdog: "workers/recovery-watchdog/wrangler.jsonc", localWorker: "workers/runner.ts", generation: "site-authoring" }, null, 2)}\n`);
