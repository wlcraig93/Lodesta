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
const sandboxManifestGenerator = readFileSync("scripts/site-sandbox-manifest.ts", "utf8");
const continuousIntegration = readFileSync(".github/workflows/continuous-integration.yml", "utf8");
const productionRelease = readFileSync(".github/workflows/production-release.yml", "utf8");
const productionRollback = readFileSync(".github/workflows/production-rollback.yml", "utf8");
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
const devSupervisor = readFileSync("scripts/dev.mjs", "utf8");
const developmentSandboxPreflight = readFileSync("scripts/ensure-site-sandbox-dev.ts", "utf8");
const devWeb = readFileSync("scripts/dev-web.mjs", "utf8");
const devInspection = readFileSync("scripts/dev-inspect.mjs", "utf8");
const localStart = readFileSync("scripts/start-local.mjs", "utf8");
const sandboxRuntime = readFileSync("packages/site-sandbox/runtime-config.ts", "utf8");
const developmentSandbox = readFileSync("workers/site-sandbox/wrangler.dev.jsonc", "utf8");
const maintenanceFence = readFileSync("supabase/migrations/202607230019_site_authoring_maintenance_claim_fence.sql", "utf8");

for (const name of ["typecheck", "smoke:dev", "canary:owner-journey", "verify:owner-journey-canary", "verify:postcss-security", "verify:static", "verify:browser", "verify:sandbox", "verify:preflight", "verify:render-browser", "verify:architecture", "verify:database", "verify:database-live", "verify:authoring", "verify:runtime", "verify:account-setup-domain", "verify:acquisition", "verify:health", "verify:release-evidence", "verify:development-sandbox", "verify:site-sandbox-local", "verify:site-sandbox-manifest"]) {
  assert(packageJson.scripts[name], `Missing npm script ${name}.`);
}
for (const command of ["verify:postcss-security", "typecheck", "build", "verify:architecture", "verify:database", "verify:authoring", "verify:account-setup-domain", "verify:acquisition", "verify:external-authoring", "verify:recovery-watchdog", "verify:health", "verify:deployment-config", "verify:release-evidence", "verify:site-agent-manager", "verify:site-agent-workspace", "verify:model-bakeoff", "verify:product-ui", "verify:owner-journey-canary"]) {
  assert(packageJson.scripts["verify:static"].includes(`npm run ${command}`), `verify:static must compose ${command}.`);
}
assert(packageJson.scripts["verify:browser"].includes("npm run verify:generation-ingestion")
  && packageJson.scripts["verify:browser"].includes("npm run verify:render-browser")
  && packageJson.scripts["verify:browser"].includes("npm run verify:trusted-runtime"), "verify:browser must compose rendering and trusted-runtime coverage.");
for (const command of ["verify:site-sandbox-manifest", "verify:development-sandbox", "verify:site-sandbox-local"]) {
  assert(packageJson.scripts["verify:sandbox"].includes(`npm run ${command}`), `verify:sandbox must compose ${command}.`);
}
for (const command of ["verify:static", "verify:browser", "verify:sandbox"]) {
  assert(packageJson.scripts["verify:preflight"].includes(`npm run ${command}`), `verify:preflight must compose ${command}.`);
}
assert(packageJson.scripts["dev:web"].includes("dev-web.mjs") && packageJson.scripts["dev:raw"].includes("--turbopack"), "Package development entrypoints must use guarded launchers and Turbopack.");
assert(devSupervisor.includes('"--turbopack"') && devWeb.includes('"--turbopack"') && devInspection.includes('"--turbopack"'), "Development entrypoints must use Turbopack.");
assert(packageJson.scripts.start.includes("start-local.mjs")
  && packageJson.scripts["start:production"] === "next start"
  && localStart.includes('LODESTA_RELEASE_GIT_SHA: ""')
  && localStart.includes('LODESTA_SANDBOX_URL: ""'), "Local next start must disable production recovery and sandbox access.");
assert(!existsSync("scripts/dev-supervisor.mjs")
  && !devSupervisor.includes("startWorker")
  && !devSupervisor.includes("workers/runner.ts"), "Default development must not supervise the shared polling worker.");
assert(!existsSync("packages/site-platform/index.ts"), "The broad site-platform barrel must remain removed.");
for (const name of ["CLOUDFLARE_ACCOUNT_ID=", "LODESTA_SANDBOX_URL=", "LODESTA_SANDBOX_TOKEN=", "LODESTA_SANDBOX_IMAGE_DIGEST=", "LODESTA_DEV_SANDBOX_TOKEN=", "LODESTA_RELEASE_GIT_SHA=", "LODESTA_ARTIFACT_BROKER_URL=", "LODESTA_ARTIFACT_BROKER_TOKEN=", "LODESTA_RECOVERY_WATCHDOG_URL=", "LODESTA_RECOVERY_WATCHDOG_TOKEN=", "LODESTA_R2_AUDIT_ACCESS_KEY_ID=", "LODESTA_R2_MAINTENANCE_ACCESS_KEY_ID=", "OPENAI_API_KEY=", "OPENROUTER_API_KEY=", "LODESTA_SITE_AGENT_PROVIDER=", "LODESTA_OWNER_CANARY_CONFIRMED_NONPRODUCTION=", "LODESTA_OWNER_CANARY_ORIGIN=", "LODESTA_OWNER_CANARY_SOURCE_URL=", "LODESTA_OWNER_CANARY_EMAIL="]) {
  assert(env.includes(name), `.env.example must document ${name}`);
}
assert(packageJson.scripts["deploy:site-sandbox"].includes("--strict") && packageJson.scripts["deploy:site-sandbox"].includes("--containers-rollout=immediate"), "Sandbox deployments must use strict mode and immediate container rollout.");
assert(packageJson.scripts["deploy:site-sandbox:dev"].includes("deploy-site-sandbox-dev.ts"), "Development sandbox must have one canonical deploy-and-canary command.");
assert(packageJson.scripts["ensure:site-sandbox:dev"].includes("ensure-site-sandbox-dev.ts")
  && devSupervisor.includes("ensure-site-sandbox-dev.ts")
  && developmentSandboxPreflight.includes('new URL("/health"')
  && developmentSandboxPreflight.includes("deploy-site-sandbox-dev.ts"),
  "Default development must verify the live development sandbox and refresh it only when missing or stale.");
assert(developmentSandbox.includes('"name": "lodesta-site-sandbox-v1-dev"')
  && developmentSandbox.includes('"workers_dev": true')
  && developmentSandbox.includes('"bucket_name": "lodesta-workspace-backups-v1"'), "Development sandbox must be isolated while sharing the pre-launch workspace bucket.");
assert(sandboxRuntime.includes("developmentSandboxReceiptPath")
  && sandboxRuntime.includes("developmentSandboxTokenPath")
  && sandboxRuntime.includes("computeSiteToolchainIdentity")
  && sandboxRuntime.includes("Development and production sandbox"), "Development sandbox runtime must validate its receipt and fail closed without production fallback.");
assert(sandboxWorkerSource.includes("sandboxManifest") && sandboxWorkerSource.includes('pathname === "/health"'), "Sandbox health must expose the compatibility manifest.");
for (const excluded of ["node_modules", "dist", "component-manifest.ts", "lodesta-manifest.json"]) {
  assert(sandboxManifestGenerator.includes(excluded), `Sandbox manifest generator must exclude ${excluded}.`);
}
for (const included of [".dockerignore", "wrangler.jsonc", "listWorkerInputs"]) {
  assert(sandboxManifestGenerator.includes(included), `Sandbox manifest generator must fingerprint ${included}.`);
}
assert(!existsSync(".github/workflows/generation-architecture.yml"), "The stale generation architecture workflow must remain removed.");
for (const check of ["npm run verify:static", "npm run verify:sandbox"]) {
  assert(continuousIntegration.includes(check), `Continuous integration must run ${check}.`);
  assert(productionRelease.includes(check), `Production release preflight must run ${check}.`);
}
assert(continuousIntegration.includes("npm run verify:browser")
  && continuousIntegration.includes("verify-static:")
  && continuousIntegration.includes("verify-browser:")
  && continuousIntegration.includes("verify-sandbox:")
  && continuousIntegration.includes("dependency-audit:")
  && continuousIntegration.includes("continue-on-error: true")
  && continuousIntegration.includes("actions/upload-artifact@v4"), "Continuous integration must parallelize named stages and retain non-blocking dependency audits.");
assert(continuousIntegration.includes("sandbox-container:")
  && continuousIntegration.includes("docker/setup-buildx-action@v3")
  && continuousIntegration.includes("--dry-run")
  && continuousIntegration.indexOf("sandbox-container:") > continuousIntegration.indexOf("verify-static:"),
  "The real Wrangler/container build must remain a separate CI job from fast host verification.");
assert(productionRelease.includes("environment: production")
  && productionRelease.includes('workflows: ["Continuous integration"]')
  && productionRelease.includes("github.event.workflow_run.conclusion == 'success'")
  && productionRelease.includes("github.event.workflow_run.head_sha")
  && productionRelease.includes("group: production-release")
  && productionRelease.includes("cancel-in-progress: false")
  && productionRelease.includes("railway up --ci")
  && productionRelease.includes("deploy_needed")
  && productionRelease.includes("cloudflare-reused")
  && productionRelease.includes("npm run deploy:site-sandbox")
  && productionRelease.includes("npm run verify:site-sandbox-deployed")
  && productionRelease.includes("current-sandbox-health")
  && productionRelease.includes('previous_manifest" = "null"')
  && productionRelease.includes("/api/health?deep=1"), "Production release workflow is missing its post-CI trigger, serialization, exact-checkout, or verification contract.");
assert(
  productionRelease.indexOf("Verify deployed sandbox compile canary") < productionRelease.indexOf("railway up --ci"),
  "Railway must not deploy before the live sandbox compile canary passes."
);
assert(productionRelease.includes("timeout-minutes: 180")
  && productionRelease.includes("deploy_needed == 'true'")
  && productionRelease.includes("acquire --minutes=90 --draining")
  && productionRelease.includes("wait-active --timeout-minutes=75"), "Production release must drain only sandbox-identity releases.");
assert(
  productionRelease.includes("railway-failed-before-switch")
    && productionRelease.includes("versions deploy")
    && productionRelease.includes("automatic-rollback-succeeded"),
  "A conclusively pre-switch Railway failure must restore the captured Cloudflare version."
);
assert(productionRollback.includes("environment: production")
  && productionRollback.includes("group: production-release")
  && productionRollback.includes("cloudflare_version")
  && productionRollback.includes("sandbox_image_digest")
  && productionRollback.includes("railway up --ci"), "Production rollback workflow is not explicitly dispatched or exact-targeted.");
assert(web.includes('healthcheckPath = "/api/health"'), "Railway web health check must use /api/health.");
assert(web.includes('startCommand = "PLAYWRIGHT_BROWSERS_PATH=0 npm run start:production"'), "Railway web service must use the production Next.js entrypoint.");
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
assert(instrumentation.includes("LODESTA_RELEASE_GIT_SHA") && instrumentation.includes("isNonLoopbackHttpsOrigin"), "Startup recovery must require immutable deployed provenance.");
assert(maintenanceFence.includes("task = 'site_authoring_maintenance'")
  && !maintenanceFence.includes("workspace-cutover")
  && maintenanceFence.includes("not maintenance_active and e.status = 'needs_input'"), "Maintenance must atomically fence ordinary and external claims while allowing active work to finish.");
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
assert(/<h1>[^<]*Lodesta[^<]*<\/h1>/.test(marketingHome), "OAuth homepage must name Lodesta in its primary heading.");
assert(
  marketingHome.includes("Lodesta checks how easily customers can find, understand, trust, and contact your business.")
    && marketingHome.includes('href="/account/onboarding"'),
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
