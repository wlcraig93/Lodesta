import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as { scripts: Record<string, string> };
const env = readFileSync(".env.example", "utf8");
const web = readFileSync("railway.toml", "utf8");
const hostedWorker = readFileSync("railway.worker.toml", "utf8");
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
const outboundProspectReportRoute = readFileSync("app/api/outbound/prospects/[prospectId]/report/route.ts", "utf8");
const presenceAssessmentRoute = readFileSync("app/api/presence/assess/route.ts", "utf8");
const publicRoute = readFileSync("app/sites/[slug]/[[...path]]/route.ts", "utf8");
const publicSite = readFileSync("packages/site-platform/public-site.ts", "utf8");
const architecture = readFileSync("scripts/verify-site-authoring-architecture.ts", "utf8");
const marketingHome = readFileSync("app/(marketing)/page.tsx", "utf8");
const marketingShell = readFileSync("components/MarketingShell.tsx", "utf8");
const privacyPage = readFileSync("app/(marketing)/privacy/page.tsx", "utf8");
const termsPage = readFileSync("app/(marketing)/terms/page.tsx", "utf8");
const sitemap = readFileSync("app/sitemap.ts", "utf8");
const nextConfig = readFileSync("next.config.mjs", "utf8");
const smoke = readFileSync("scripts/smoke.sh", "utf8");
const devSupervisor = readFileSync("scripts/dev.mjs", "utf8");
const developmentSandboxPreflight = readFileSync("scripts/ensure-site-sandbox-dev.ts", "utf8");
const devWeb = readFileSync("scripts/dev-web.mjs", "utf8");
const devInspection = readFileSync("scripts/dev-inspect.mjs", "utf8");
const localStart = readFileSync("scripts/start-local.mjs", "utf8");
const sandboxRuntime = readFileSync("packages/site-sandbox/runtime-config.ts", "utf8");
const developmentSandboxes = ["blue", "green"].map((slot) =>
  readFileSync(`workers/site-sandbox/wrangler.dev.${slot}.jsonc`, "utf8"));
const maintenanceFence = readFileSync("supabase/migrations/202607230019_site_authoring_maintenance_claim_fence.sql", "utf8");

for (const name of ["typecheck", "smoke:dev", "canary:owner-journey", "verify:owner-journey-canary", "verify:site-authoring-canary", "verify:postcss-security", "verify:static", "verify:browser", "verify:sandbox", "verify:preflight", "verify:render-browser", "verify:architecture", "verify:database", "verify:database-live", "verify:authoring", "verify:runtime", "verify:account-setup-domain", "verify:acquisition", "verify:health", "verify:release-evidence", "verify:development-sandbox", "verify:site-sandbox-local", "verify:site-sandbox-manifest", "verify:execution-authority", "operator:site-authoring"]) {
  assert(packageJson.scripts[name], `Missing npm script ${name}.`);
}
for (const command of ["verify:postcss-security", "typecheck", "build", "verify:architecture", "verify:database", "verify:authoring", "verify:account-setup-domain", "verify:acquisition", "verify:site-authoring-canary", "verify:recovery-watchdog", "verify:health", "verify:deployment-config", "verify:execution-authority", "verify:release-evidence", "verify:site-agent-manager", "verify:site-agent-workspace", "verify:product-ui", "verify:owner-journey-canary"]) {
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
for (const packageName of ["postcss", "postcss-value-parser", "typescript"]) {
  assert(nextConfig.includes(`"${packageName}"`), `Next.js must externalize the sandbox compiler dependency ${packageName}.`);
}
for (const route of ["/prospects", "/outbound", "/settings"]) {
  assert(smoke.includes(`"${route}"`), `Smoke coverage must include the operator route ${route}.`);
}
assert(smoke.includes('-H "@${ADMIN_HEADER_FILE}"') && !smoke.includes('"x-lodesta-admin-token: ${LODESTA_ADMIN_TOKEN}"'), "Smoke requests must not expose the admin token in process arguments.");
assert(packageJson.scripts.start.includes("start-local.mjs")
  && packageJson.scripts["start:production"] === "next start"
  && localStart.includes('LODESTA_RELEASE_GIT_SHA: ""')
  && localStart.includes('LODESTA_SANDBOX_BLUE_URL: ""')
  && localStart.includes('LODESTA_SANDBOX_GREEN_URL: ""'), "Local next start must disable production recovery and both production sandbox slots.");
for (const source of [devSupervisor, devWeb, devInspection, localStart, packageJson.scripts["dev:raw"], packageJson.scripts["dev:worker"]]) {
  assert(source.includes("LODESTA_REPOSITORY") && source.includes("local"), "Every supported local entrypoint must force the file repository.");
}
assert(!existsSync("scripts/dev-supervisor.mjs")
  && devSupervisor.includes("workers/runner.ts")
  && devSupervisor.includes("const children = [web, worker]")
  && packageJson.scripts["dev:worker"].includes("workers/runner.ts"),
  "Default development must supervise exactly one web process and one polling worker while retaining an isolated worker command.");
assert(!existsSync("packages/site-platform/index.ts"), "The broad site-platform barrel must remain removed.");
for (const name of ["CLOUDFLARE_ACCOUNT_ID=", "LODESTA_SANDBOX_BLUE_URL=", "LODESTA_SANDBOX_BLUE_TOKEN=", "LODESTA_SANDBOX_GREEN_URL=", "LODESTA_SANDBOX_GREEN_TOKEN=", "LODESTA_DEV_SANDBOX_BLUE_TOKEN=", "LODESTA_DEV_SANDBOX_GREEN_TOKEN=", "LODESTA_RELEASE_GIT_SHA=", "LODESTA_EXECUTION_ROLE=", "LODESTA_REPOSITORY=", "LODESTA_MAINTENANCE_LEASE_OWNER=", "LODESTA_ARTIFACT_BROKER_URL=", "LODESTA_ARTIFACT_BROKER_TOKEN=", "LODESTA_RECOVERY_WATCHDOG_URL=", "LODESTA_RECOVERY_WATCHDOG_TOKEN=", "LODESTA_R2_AUDIT_ACCESS_KEY_ID=", "LODESTA_R2_MAINTENANCE_ACCESS_KEY_ID=", "OPENAI_API_KEY=", "OPENROUTER_API_KEY=", "LODESTA_SITE_AGENT_PROVIDER=", "LODESTA_OWNER_CANARY_CONFIRMED_NONPRODUCTION=", "LODESTA_OWNER_CANARY_ORIGIN=", "LODESTA_OWNER_CANARY_SOURCE_URL=", "LODESTA_OWNER_CANARY_EMAIL="]) {
  assert(env.includes(name), `.env.example must document ${name}`);
}
for (const slot of ["blue", "green"]) {
  const command = packageJson.scripts[`deploy:site-sandbox:${slot}`];
  assert(command?.includes(`wrangler.${slot}.jsonc`) && command.includes("--strict") && command.includes("--containers-rollout=immediate"), `${slot} sandbox deployments must use their dedicated strict immediate-rollout configuration.`);
}
assert(packageJson.scripts["deploy:site-sandbox:dev"].includes("ensure-site-sandbox-dev.ts"), "Development sandbox must have one canonical blue-green deploy-and-promote command.");
assert(packageJson.scripts["ensure:site-sandbox:dev"].includes("ensure-site-sandbox-dev.ts")
  && devSupervisor.includes("ensure-site-sandbox-dev.ts")
  && developmentSandboxPreflight.includes("assertSlotAvailable")
  && developmentSandboxPreflight.includes("saveSandboxDeployment")
  && developmentSandboxPreflight.includes("saveSandboxControl"),
  "Default development must verify, register, and promote the inactive nonproduction sandbox slot.");
assert(developmentSandboxes.every((source, index) => source.includes(`"name": "lodesta-site-sandbox-dev-${index === 0 ? "blue" : "green"}"`)
  && source.includes('"workers_dev": true')
  && source.includes('"bucket_name": "lodesta-workspace-backups-v1"')), "Development blue and green sandboxes must be isolated while sharing the pre-launch workspace bucket.");
assert(sandboxRuntime.includes("developmentSandboxReceiptPath(slot)")
  && sandboxRuntime.includes("developmentSandboxTokenPath(slot)")
  && sandboxRuntime.includes("computeSiteToolchainIdentity")
  && sandboxRuntime.includes("does not match its immutable deployment record"), "Development sandbox runtime must resolve and verify the exact pinned slot deployment.");
assert(sandboxWorkerSource.includes("sandboxManifest") && sandboxWorkerSource.includes('pathname === "/health"'), "Sandbox health must expose the compatibility manifest.");
for (const excluded of ["node_modules", "dist", "component-manifest.ts", "lodesta-manifest.json"]) {
  assert(sandboxManifestGenerator.includes(excluded), `Sandbox manifest generator must exclude ${excluded}.`);
}
for (const included of [".dockerignore", "wrangler.blue.jsonc", "wrangler.green.jsonc", "listWorkerInputs"]) {
  assert(sandboxManifestGenerator.includes(included), `Sandbox manifest generator must fingerprint ${included}.`);
}
assert(!existsSync(".github/workflows/generation-architecture.yml"), "The stale generation architecture workflow must remain removed.");
for (const check of ["npm run verify:static", "npm run verify:sandbox"]) {
  assert(continuousIntegration.includes(check), `Continuous integration must run ${check}.`);
}
assert(productionRelease.includes("npm run verify:preflight"), "Production release must run the composed static, browser, and sandbox preflight.");
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
  && productionRelease.includes("Select an inactive drained slot")
  && productionRelease.includes("assert-slot-available")
  && productionRelease.includes("wrangler.$slot.jsonc")
  && productionRelease.includes("sandbox:deployments -- register")
  && productionRelease.includes("sandbox:deployments -- promote")
  && productionRelease.includes("npm run verify:site-sandbox-deployed")
  && productionRelease.includes("previous_deployment")
  && productionRelease.includes("/api/health/?deep=1"), "Production release workflow is missing its post-CI trigger, serialization, exact-checkout, or verification contract.");
assert(
  productionRelease.indexOf("Deploy, canary, and register the inactive sandbox") < productionRelease.indexOf("Acquire the database maintenance fence and drain")
    && productionRelease.indexOf("Acquire the database maintenance fence and drain") < productionRelease.indexOf("railway up --ci")
    && productionRelease.indexOf("Verify both controller identities") < productionRelease.indexOf("Promote the registered sandbox"),
  "Railway must not deploy before the live sandbox compile canary passes."
);
assert(productionRelease.includes("timeout-minutes: 180")
  && productionRelease.includes("maintenance:site-authoring -- acquire --minutes=90 --draining")
  && productionRelease.includes("maintenance:site-authoring -- wait-active --timeout-minutes=30")
  && productionRelease.includes("authoring_drain_timeout")
  && productionRelease.includes("Restore only the sandbox pointer after post-promotion failure"), "Coordinated releases must use a bounded maintenance drain and retain pointer-only automatic rollback.");
assert(productionRelease.includes("sandbox-canary-attempt-1.error.log")
  && productionRelease.includes("sandbox-canary-attempt-2.error.log")
  && productionRelease.includes("sleep 20"),
  "A new Cloudflare container rollout must preserve its first canary failure and retry the complete canary exactly once after a bounded readiness delay.");
assert(productionRelease.includes("activeDeployments.find")
  && productionRelease.includes("const priorIds = new Set")
  && productionRollback.includes("const priorIds = new Set"), "Release evidence must select a successful current deployment, and deployment polling must ignore stale prior failures.");
assert(
  productionRelease.includes("sandbox:deployments -- rollback")
    && productionRelease.includes("automatic-sandbox-rollback.json")
    && productionRelease.includes("RAILWAY_WEB_SERVICE_ID")
    && productionRelease.includes("RAILWAY_WORKER_SERVICE_ID")
    && !productionRelease.includes("restore both prior Railway"),
  "Post-promotion failure must atomically restore only the previous sandbox pointer."
);
assert(productionRollback.includes("environment: production")
  && productionRollback.includes("group: production-release")
  && productionRollback.includes("sandbox_deployment_id")
  && productionRollback.includes("sandbox:deployments -- rollback")
  && productionRollback.includes("RAILWAY_WEB_SERVICE_ID")
  && productionRollback.includes("RAILWAY_WORKER_SERVICE_ID")
  && productionRollback.includes("maintenance:site-authoring -- renew --minutes=90")
  && productionRollback.includes("maintenance:site-authoring -- acquire --minutes=90 --draining")
  && productionRollback.includes("maintenance:site-authoring -- wait-active --timeout-minutes=30")
  && productionRollback.includes("railway up ../target --path-as-root --ci"), "Production rollback workflow is not lease-coordinated, dual-service, or exact-targeted.");
assert(productionRollback.indexOf("Require both services to report the target SHA") < productionRollback.indexOf("Reactivate the retained sandbox deployment"), "Rollback must verify both controller identities before moving the sandbox pointer.");
assert(!/^\s{6}NODE_ENV:/m.test(productionRelease) && !/^\s{6}NODE_ENV:/m.test(productionRollback), "Release workflows must set NODE_ENV only on authority-bearing steps, never at job level.");
assert(web.includes('healthcheckPath = "/api/health"'), "Railway web health check must use /api/health.");
assert(web.includes('startCommand = "PLAYWRIGHT_BROWSERS_PATH=0 npm run start:production"'), "Railway web service must use the production Next.js entrypoint.");
assert(hostedWorker.includes('startCommand = "PLAYWRIGHT_BROWSERS_PATH=0 npm run worker -- work"'), "Railway worker service must use the canonical runner work loop.");
assert(workerSource.includes("localRecoveryStaleAfterMs") && workerSource.includes("processNextWebsiteAssessmentJob") && workerSource.includes('event: "worker_started"') && workerSource.includes("releaseSha"), "The canonical runner must preserve local recovery commands, assessment processing, and hosted release identity reporting.");
assert(
  sandboxWorkerSource.includes("[a-z0-9_-]{1,80}")
    && sandboxClientSource.includes("[a-z0-9_-]{1,80}"),
  "Sandbox transport must accept canonical underscore-prefixed session IDs on both sides."
);
assert(watchdog.includes('"crons": ["* * * * *"]'), "Recovery watchdog must run every minute so paused sandboxes are destroyed within the five-minute lease plus one poll interval.");
assert(!/r2_buckets|durable_objects|containers|queues/.test(watchdog), "Recovery watchdog must not bind stateful Cloudflare resources.");
assert(watchdogSource.includes("scheduled(") && watchdogSource.includes("LODESTA_RECOVERY_WATCHDOG_TOKEN"), "Recovery watchdog scheduled handler is incomplete.");
assert(instrumentation.includes('NEXT_PHASE !== "phase-production-build"') && instrumentation.includes('NEXT_RUNTIME === "nodejs"'), "Startup recovery must be Node-only and skip production builds.");
assert(instrumentation.includes("hasHostedReleaseIdentity"), "Startup recovery must use the shared immutable hosted-environment predicate.");
assert(maintenanceFence.includes("task = 'site_authoring_maintenance'")
  && !maintenanceFence.includes("workspace-cutover")
  && maintenanceFence.includes("not maintenance_active and e.status = 'needs_input'"), "Maintenance must atomically fence ordinary and external claims while allowing active work to finish.");
assert(maintenanceRoute.includes("hasValidRecoveryWatchdogToken") && maintenanceRoute.includes("processAutomaticRecovery"), "Maintenance route is missing machine recovery scheduling.");
for (const source of [prospectRoute, outboundProspectReportRoute, presenceAssessmentRoute]) {
  assert(!source.includes("processNextWebsiteAssessmentJob") && !source.includes("after(async"), "Web routes must enqueue assessments without consuming the hosted queue.");
}
assert(publicRoute.includes("readVerifiedArtifactFile"), "Public serving must verify immutable artifact bytes.");
assert(publicRoute.includes("loadPublishedSiteContext") && publicSite.includes('artifact.qa.hardGate !== "passed"'), "Public serving must reject unverified artifacts.");
assert(
  architecture.includes("platformSiteSchema")
    && architecture.includes("publicBuildInputSchema")
    && architecture.includes("canonicalMigration"),
  "Architecture ratchet must enforce canonical local contracts and the baseline."
);
const homepageHeadingSource = marketingHome.match(/<h1\b[\s\S]*?<\/h1>/)?.[0] ?? "";
assert(homepageHeadingSource.includes("Lodesta"), "OAuth homepage must name Lodesta in its primary heading.");
assert(
  marketingHome.includes("Lodesta builds, manages, and improves your website so customers can find you, understand what you do")
    && marketingHome.includes("<WebsiteHealthReportForm")
    && marketingShell.includes('"/auth/login"'),
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
