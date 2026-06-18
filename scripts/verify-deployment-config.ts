import { existsSync, readFileSync } from "node:fs";

const packageJson = JSON.parse(readFileSync("package.json", "utf8")) as {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
};
const envExample = readFileSync(".env.example", "utf8");
const webConfig = readFileSync("railway.toml", "utf8");
const workerConfig = readFileSync("deploy/railway-worker.toml", "utf8");
const schemaSql = readFileSync("supabase/schema.sql", "utf8");
const domainsRoute = readFileSync("app/api/domains/route.ts", "utf8");
const domainResolveRoute = readFileSync("app/api/domains/resolve/route.ts", "utf8");
const domainRefreshRoute = readFileSync("app/api/domains/refresh/route.ts", "utf8");
const analyticsRoute = readFileSync("app/api/analytics/route.ts", "utf8");
const intakeRoute = readFileSync("app/api/intake/route.ts", "utf8");
const intakeJobStatusRoute = readFileSync("app/api/intake/jobs/[jobId]/route.ts", "utf8");
const jobsRoute = readFileSync("app/api/jobs/route.ts", "utf8");
const jobsProcessRoute = readFileSync("app/api/jobs/process/route.ts", "utf8");
const scheduleRoute = readFileSync("app/api/jobs/schedule/route.ts", "utf8");
const stripeWebhookRoute = readFileSync("app/api/stripe/webhook/route.ts", "utf8");
const jobsSource = readFileSync("lib/jobs.ts", "utf8");
const jobSchedulerSource = readFileSync("lib/job-scheduler.ts", "utf8");
const modelsSource = readFileSync("lib/models.ts", "utf8");
const repositorySource = readFileSync("lib/repository.ts", "utf8");
const supabaseRepositorySource = readFileSync("lib/supabase/repository.ts", "utf8");
const agentTelemetrySource = readFileSync("lib/agent-telemetry.ts", "utf8");
const siteCandidateServiceSource = readFileSync("lib/site-candidate-service.ts", "utf8");
const imageGenerationSource = readFileSync("lib/image-generation.ts", "utf8");
const assetLibrarySource = readFileSync("lib/asset-library.ts", "utf8");
const assetLibraryCliSource = readFileSync("scripts/asset-library.ts", "utf8");
const assetLibraryPublicRouteSource = readFileSync("app/api/asset-library/public/[assetId]/[variant]/route.ts", "utf8");
const assetLibraryTagsRouteSource = readFileSync("app/api/admin/asset-library/[assetId]/tags/route.ts", "utf8");
const assetLibraryManifest = JSON.parse(readFileSync("asset-library/manifests/tire-auto-v2.json", "utf8")) as {
  prompts?: unknown[];
  name?: string;
};
const assetLibraryAutoServicesWaveManifest = JSON.parse(readFileSync("asset-library/manifests/auto-services-wave-1-v1.json", "utf8")) as {
  prompts?: unknown[];
  name?: string;
};
const assetLibraryAutoServicesEnvironmentManifest = JSON.parse(readFileSync("asset-library/manifests/auto-services-environment-wave-1-v1.json", "utf8")) as {
  prompts?: unknown[];
  name?: string;
  defaultSize?: string;
};
const assetLibraryAutoGlassWaveManifest = JSON.parse(readFileSync("asset-library/manifests/auto-glass-wave-1-v1.json", "utf8")) as {
  prompts?: unknown[];
  name?: string;
};
const assetLibraryAutoBodyWaveManifest = JSON.parse(readFileSync("asset-library/manifests/auto-body-wave-1-v1.json", "utf8")) as {
  prompts?: unknown[];
  name?: string;
};
const supabaseVerifierSource = readFileSync("scripts/verify-supabase.ts", "utf8");
const workerSource = readFileSync("workers/runner.ts", "utf8");
const devSource = readFileSync("scripts/dev.mjs", "utf8");
const cliSource = readFileSync("scripts/lodesta.mjs", "utf8");
const devCrawlVerifierSource = readFileSync("scripts/verify-dev-crawl.mjs", "utf8");

assert(packageJson.dependencies?.playwright, "playwright must be a runtime dependency for deployed render inspection.");
assert(packageJson.scripts?.["install:browsers"], "package.json must expose npm run install:browsers.");
assert(packageJson.scripts?.["verify:render-browser"], "package.json must expose npm run verify:render-browser.");
assert(packageJson.scripts?.["verify:dev-crawl"], "package.json must expose npm run verify:dev-crawl.");
assert(packageJson.scripts?.["verify:worker-runtime"], "package.json must expose npm run verify:worker-runtime.");
assert(packageJson.scripts?.["seed:openai-settings"], "package.json must expose npm run seed:openai-settings.");
assert(packageJson.scripts?.["asset-library"], "package.json must expose npm run asset-library for internal generated image batches.");
assertIncludes(envExample, "LODESTA_WORKFLOW_TIMEOUT_MS=5000", ".env.example must document the workflow delivery timeout.");
assertIncludes(envExample, "LODESTA_CRAWL_FIXTURE_TOKEN=", ".env.example must document the protected crawl fixture token.");
assertIncludes(envExample, "LODESTA_HASH_SECRET=", ".env.example must document the canonical hash secret.");
assertIncludes(envExample, "LODESTA_ASSET_LIBRARY_IMAGE_ESTIMATE_USD=0.08", ".env.example must document the generated asset cost estimate knob.");
assertRemovedEnv(
  envExample,
  [
    "LODESTA_PLATFORM_HOSTS",
    "LODESTA_ANALYTICS_RETENTION_DAYS",
    "LODESTA_ALLOW_PRIVATE_CRAWL_URLS",
    "LODESTA_IP_HASH_SALT",
    "LODESTA_RATE_LIMIT_SALT"
  ],
  ".env.example must not expose removed host-list, analytics-retention, private-crawl, or legacy hash-salt configuration."
);
assertRemovedEnv(
  envExample,
  [
    "LODESTA_BROWSER_EXECUTABLE_PATH",
    "LODESTA_RENDER_BROWSER_ARGS",
    "LODESTA_RENDER_BROWSER_REQUIRED",
    "LODESTA_RENDER_ARTIFACT_ROOT",
    "PLAYWRIGHT_BROWSERS_PATH"
  ],
  ".env.example must not expose render/browser deployment internals."
);

assert(!webConfig.includes("$schema"), "Web Railway config must not include a $schema key; Railway rejects it as invalid TOML.");
assertIncludes(webConfig, 'builder = "RAILPACK"', "Web Railway config must use Railpack.");
assertIncludes(webConfig, "PLAYWRIGHT_BROWSERS_PATH=0 npm run install:browsers && npm run build", "Web build must install Chromium into the image.");
assertIncludes(webConfig, 'startCommand = "PLAYWRIGHT_BROWSERS_PATH=0 npm run start"', "Web service must start Next.js.");
assertIncludes(webConfig, 'healthcheckPath = "/api/health"', "Web service must use the public health endpoint.");
assertIncludes(webConfig, 'restartPolicyType = "ON_FAILURE"', "Web service should restart on failure.");

assert(!workerConfig.includes("$schema"), "Worker Railway config must not include a $schema key; Railway rejects it as invalid TOML.");
assertIncludes(workerConfig, 'builder = "RAILPACK"', "Worker Railway config must use Railpack.");
assertIncludes(workerConfig, "PLAYWRIGHT_BROWSERS_PATH=0 npm run install:browsers && npm run build", "Worker build must install Chromium into the image.");
assertIncludes(workerConfig, 'startCommand = "PLAYWRIGHT_BROWSERS_PATH=0 npm run worker -- work"', "Worker service must run the long-lived worker loop.");
assertIncludes(workerConfig, "healthcheckPath = null", "Worker service should not expose an HTTP healthcheck.");
assertIncludes(workerConfig, 'restartPolicyType = "ALWAYS"', "Worker service should restart continuously.");
assertIncludes(
  devSource,
  '["--import", "tsx", "workers/runner.ts", "work", "750"]',
  "Local dev must pass a faster worker idle interval without changing deployed worker TOML."
);
assertIncludes(devSource, "childExitDecision", "Local dev supervisor must use testable worker restart decisions.");
assertIncludes(workerSource, "resolveWorkerIdleMs", "Worker runner must resolve idle interval through the shared parser.");
assertIncludes(workerSource, "LODESTA_WORKER_IDLE_MS", "Worker runner must support the optional worker idle interval environment variable.");

assertIncludes(schemaSql, "hostname text not null unique", "Supabase domains.hostname must be unique for direct host-header routing.");
assertIncludes(
  schemaSql,
  "site_id text references sites(id) on delete cascade",
  "Supabase analytics events must remain linked to site deletion through cascading site_id foreign keys."
);
assertIncludes(schemaSql, "visitor_id text", "Supabase lead and analytics tables must persist pseudonymous visitor ids.");
assertIncludes(analyticsRoute, "siteId: z.string().min(1)", "Analytics ingest must require siteId for site-scoped retention and cascade semantics.");
assert(
  !existsSync("app/api/analytics/retention/route.ts"),
  "Analytics retention API route must not exist while time-based analytics deletion is not a product surface."
);
for (const [label, source] of [
  ["jobs route", jobsRoute],
  ["schedule route", scheduleRoute],
  ["jobs source", jobsSource],
  ["job scheduler", jobSchedulerSource],
  ["models", modelsSource],
  ["repository", repositorySource],
  ["supabase repository", supabaseRepositorySource],
  ["CLI", cliSource],
  ["Supabase verifier", supabaseVerifierSource]
] as const) {
  assert(
    !source.includes("analytics_retention") &&
      !source.includes("LODESTA_ANALYTICS_RETENTION_DAYS") &&
      !source.includes("pruneAnalyticsEvents") &&
      !source.includes("prune-analytics") &&
      !source.includes("analytics-retention"),
    `${label} must not expose analytics-retention deletion plumbing.`
  );
}
assertIncludes(
  schemaSql,
  "create unique index claims_stripe_checkout_session_idx on claims(stripe_checkout_session_id) where stripe_checkout_session_id is not null;",
  "Supabase claims must enforce unique non-null Stripe checkout session ids."
);
assertIncludes(schemaSql, "create index sites_workspace_idx on sites(workspace_id);", "Supabase sites.workspace_id foreign key must be indexed for workspace cascades.");
assertIncludes(
  schemaSql,
  "create index experiment_learnings_experiment_status_idx on experiment_learnings(experiment_id, status);",
  "Supabase experiment_learnings.experiment_id foreign key must be indexed for rollbacks and cascades."
);
assertIncludes(
  schemaSql,
  "create index outbound_events_site_time_idx on outbound_events(site_id, occurred_at desc);",
  "Supabase outbound_events.site_id foreign key must be indexed for site cleanup and reporting."
);
assertIncludes(schemaSql, "create table operator_settings", "Supabase schema must include operator settings.");
assertIncludes(schemaSql, "create table operator_setting_audits", "Supabase schema must include operator settings audit rows.");
assertIncludes(schemaSql, "create table agent_runs", "Supabase schema must include agent run telemetry.");
assertIncludes(schemaSql, "create table agent_run_spans", "Supabase schema must include agent run spans.");
assertIncludes(schemaSql, "create table agent_model_calls", "Supabase schema must include agent model calls.");
assertIncludes(schemaSql, "lodesta-asset-library", "Supabase schema must seed the private generated asset-library bucket.");
assertIncludes(schemaSql, "public = false", "Generated asset-library storage bucket must remain private.");
assertIncludes(schemaSql, "create table asset_library_batches", "Supabase schema must include asset library batch records.");
assertIncludes(schemaSql, "create table asset_library_assets", "Supabase schema must include reusable asset library records.");
assertIncludes(schemaSql, "create table asset_library_reviews", "Supabase schema must include human review audit records.");
assertIncludes(schemaSql, "alter table asset_library_assets enable row level security;", "Asset library tables must have RLS enabled.");
assert(assetLibraryManifest.name === "tire-auto-v2", "Tire/auto v2 asset manifest must be the canonical generated image manifest.");
assert(assetLibraryManifest.prompts?.length === 100, "Tire/auto v2 asset manifest must contain the planned 100 prompt records.");
assert(assetLibraryAutoServicesWaveManifest.name === "auto-services-wave-1-v1", "Auto services wave 1 asset manifest must exist.");
assert(assetLibraryAutoServicesWaveManifest.prompts?.length === 96, "Auto services wave 1 asset manifest must contain the planned 96 prompt records.");
assert(assetLibraryAutoServicesEnvironmentManifest.name === "auto-services-environment-wave-1-v1", "Auto services environment wave 1 asset manifest must exist.");
assert(assetLibraryAutoServicesEnvironmentManifest.prompts?.length === 24, "Auto services environment wave 1 asset manifest must contain the planned 24 prompt records.");
assert(assetLibraryAutoServicesEnvironmentManifest.defaultSize === "2560x1280", "Auto services environment wave must use the planned 2:1 hero-scale default size.");
assert(assetLibraryAutoGlassWaveManifest.name === "auto-glass-wave-1-v1", "Auto glass wave 1 asset manifest must exist.");
assert(assetLibraryAutoGlassWaveManifest.prompts?.length === 48, "Auto glass wave 1 asset manifest must contain the planned 48 prompt records.");
assert(assetLibraryAutoBodyWaveManifest.name === "auto-body-wave-1-v1", "Auto body wave 1 asset manifest must exist.");
assert(assetLibraryAutoBodyWaveManifest.prompts?.length === 72, "Auto body wave 1 asset manifest must contain the planned 72 prompt records.");
assertIncludes(assetLibraryCliSource, "--confirm-cost", "Asset library generation CLI must require explicit cost confirmation.");
assertIncludes(assetLibraryCliSource, "Generation requires explicit --limit", "Asset library generation CLI must require explicit limits.");
assertIncludes(assetLibraryCliSource, "--offset", "Asset library generation CLI must support offset wave selection.");
assertIncludes(assetLibraryCliSource, "--prompt-ids", "Asset library generation CLI must support explicit prompt-id wave selection.");
assertIncludes(assetLibraryCliSource, "backfill-taxonomy", "Asset library CLI must expose taxonomy backfill for existing approved tire assets.");
assertIncludes(assetLibraryCliSource, "retag-closeup-heroes", "Asset library CLI must expose close-up hero retagging after environment approval.");
assertIncludes(assetLibrarySource, "ASSET_LIBRARY_ACTIVE_MANIFEST_NAMES", "Asset library validation must treat the automotive wave manifests as active generation manifests.");
assertIncludes(assetLibrarySource, "auto-services-environment-wave-1-v1", "Asset library validation must treat the auto services environment manifest as active.");
assertIncludes(assetLibrarySource, "assessAssetLibraryPolicy", "Asset library must default-deny generated assets without explicit safe policy classification.");
assertIncludes(assetLibrarySource, "shop_environment", "Asset library policy must support people-less generated shop environment assets.");
assertIncludes(assetLibrarySource, "sceneFamily", "Asset library prompt metadata must support scene-family dedupe for environment crops.");
assertIncludes(assetLibrarySource, "ASSET_LIBRARY_HERO_DERIVATIVE_MIN_WIDTH", "Asset library derivative generation must enforce a true hero-width floor.");
assertIncludes(assetLibrarySource, "derivedAssetLibraryTaxonomyTags", "Asset library must derive searchable taxonomy mirror tags from prompt metadata.");
assertIncludes(assetLibrarySource, "Asset library policy and derived taxonomy tags can only be changed through review or taxonomy backfill actions", "Asset library tag editing must not bypass policy fail, classification, or generated taxonomy tags.");
assertIncludes(assetLibraryTagsRouteSource, "updateAssetLibraryAssetTags", "Asset library admin tag route must use protected tag updates.");
assertIncludes(assetLibrarySource, "Only approved asset-library assets can receive public derivatives", "Approved derivatives must be gated on human approval.");
assertIncludes(assetLibraryPublicRouteSource, "asset.status !== \"approved\"", "Public asset route must serve only approved asset-library assets.");
assertIncludes(assetLibraryPublicRouteSource, "assessAssetLibraryPolicy(asset).siteSelectable", "Public asset route must reject approved assets that fail generated-image policy.");
assertIncludes(assetLibraryPublicRouteSource, "path.startsWith(\"raw/\")", "Public asset route must reject raw asset-library paths.");
assertIncludes(schemaSql, "create index agent_runs_target_idx on agent_runs(target_type, target_id);", "Agent telemetry target lookup must be indexed.");
assertIncludes(schemaSql, "alter table agent_runs enable row level security;", "Agent run telemetry must have RLS enabled.");
assertIncludes(schemaSql, "create table site_candidates", "Site candidates must be stored separately from managed sites.");
assert(!schemaSql.includes("site_generations"), "Supabase schema must not recreate legacy site_generations storage.");
assert(!schemaSql.includes("generation_artifacts"), "Supabase schema must not recreate legacy generation_artifacts storage.");
assertIncludes(schemaSql, "accepted_site_id text references sites(id) on delete set null", "Site candidates must point to accepted managed sites without owning public site lifecycle.");
assertIncludes(schemaSql, "accepted_version_id text", "Site candidates must record accepted site-version identity when accepted as a version.");
assertIncludes(schemaSql, "alter table site_candidates enable row level security;", "Site candidates must have RLS enabled.");
assertIncludes(schemaSql, "version_id text", "Preview tokens must store the generated site version id.");
assertIncludes(
  siteCandidateServiceSource,
  "startRequiredSiteCandidateTelemetry",
  "Persisted site candidate creation must fail closed when the initial telemetry run cannot be created."
);
assertIncludes(siteCandidateServiceSource, "previewStatus", "Canonical generation must record preview-token outcomes on the run metadata.");
assertIncludes(siteCandidateServiceSource, "createSiteCandidate", "Canonical generation must persist site-candidate candidates instead of managed sites.");
assertIncludes(intakeRoute, "repository.enqueueJob(\"generate_site\"", "Intake API must enqueue generation through the canonical job pipeline.");
assertIncludes(intakeRoute, "/api/intake/jobs/", "Intake API must return a pollable generation job status URL.");
assertIncludes(intakeJobStatusRoute, "intakeJobStatusResponse", "Intake job status API must use the safe status response shape.");
assert(!intakeRoute.includes("startSiteCandidateTelemetry"), "Intake API must not start generation telemetry directly.");
assert(!intakeRoute.includes("repository.createAndStoreSite"), "Intake API must not persist generated sites directly.");
assertIncludes(jobsSource, "context.generateSite", "Generation jobs must route persisted generation through the canonical generation service.");
assertIncludes(jobsSource, "assertPublicFetchUrl(rawUrl)", "Generation jobs must repeat public URL safety validation in the worker.");
assertIncludes(jobsSource, "assertLaunchMarket({ url, prompt })", "Generation jobs must repeat launch-market validation in the worker.");
assert(!jobsSource.includes("startSiteCandidateTelemetry"), "Jobs must not start generation telemetry directly.");
assert(!jobsSource.includes("createAndStoreSite"), "Jobs must not persist generated sites directly.");
assert(!jobsSource.includes("createPreviewToken"), "Jobs must not create generated-site preview tokens directly.");
assertIncludes(
  supabaseRepositorySource,
  "generateSite: supabaseJobGenerateSite",
  "Supabase worker context must receive the canonical generation service through an entrypoint hook."
);
assert(
  !supabaseRepositorySource.includes("../site-candidate-service"),
  "Supabase repository must not import the site-candidate service into admin page graphs."
);
assertIncludes(
  jobsProcessRoute,
  "setSupabaseJobGenerateSite((options) => generateSite({ ...options, repository }))",
  "Job processor route must attach the canonical generation service outside admin page graphs."
);
assertIncludes(
  workerSource,
  "setSupabaseJobGenerateSite((options) => generateSite({ ...options, repository }))",
  "Worker runner must attach the canonical generation service outside admin page graphs."
);
assert(
  !agentTelemetrySource.includes("export async function startSiteCandidateTelemetry"),
  "Best-effort site-candidate telemetry starter must not be exported for product generation paths."
);
assertIncludes(jobSchedulerSource, '"agent_telemetry_cleanup"', "Launch maintenance must queue bounded agent telemetry cleanup.");
assertIncludes(
  schemaSql,
  "Job lock expired after all retry attempts.",
  "Supabase job claim function must fail stale running jobs that have exhausted retry attempts."
);
assertIncludes(
  schemaSql,
  "and attempts >= max_attempts",
  "Supabase job claim function must not leave max-attempt stale running jobs locked forever."
);
assertIncludes(
  imageGenerationSource,
  "publicUrl: false",
  "Generated mockup planning artifacts must not expose public Supabase Storage URLs."
);
assertIncludes(
  supabaseVerifierSource,
  "stale_exhausted_job",
  "Supabase verifier must exercise stale exhausted worker job recovery."
);
assertIncludes(
  supabaseVerifierSource,
  "Stale exhausted running job was not failed",
  "Supabase verifier must assert stale exhausted jobs fail and unlock."
);
assertIncludes(devCrawlVerifierSource, "LODESTA_ADMIN_TOKEN", "Dev crawl verifier must require admin API authorization.");
assertIncludes(devCrawlVerifierSource, "LODESTA_CRAWL_FIXTURE_TOKEN", "Dev crawl verifier must target the protected public fixture by token.");
assertIncludes(devCrawlVerifierSource, "Deployment/network failure", "Dev crawl verifier must distinguish deployment/network failures.");
assertIncludes(
  stripeWebhookRoute,
  "siteId: session.metadata?.site_id",
  "Stripe webhook completion must validate checkout session site metadata."
);
assertIncludes(
  supabaseRepositorySource,
  "input.siteId && existing.site_id !== input.siteId",
  "Supabase claim completion must reject mismatched checkout site metadata."
);
assertIncludes(repositorySource, "getDomainByHostname(hostname: string)", "Repository contract must expose direct domain hostname lookup.");
assertIncludes(repositorySource, "getDomainById(domainId: string)", "Repository contract must expose direct domain id lookup for domain refresh authorization.");
assertIncludes(supabaseRepositorySource, '.from("domains").select("*").eq("hostname"', "Supabase repository must query domains by hostname.");
assertIncludes(supabaseRepositorySource, '.from("domains").select("*").eq("id"', "Supabase repository must query domains by id.");
assertIncludes(domainsRoute, "repository.getDomainByHostname(hostname)", "Domain registration route must check existing hostnames before inserting.");
assertIncludes(domainsRoute, 'status: 409', "Domain registration route must reject hostnames already connected to another site.");
assertIncludes(domainResolveRoute, "repository.getDomainByHostname(hostname)", "Domain resolve route must use indexed hostname lookup.");
assert(
  !domainResolveRoute.includes("repository.listDomains()"),
  "Domain resolve route must not scan every registered domain on each host-header request."
);
assertIncludes(domainRefreshRoute, "repository.getDomainById(parsed.data.domainId)", "Domain refresh route must use direct domain id lookup before authorization.");
assert(
  !domainRefreshRoute.includes("repository.listDomains()"),
  "Domain refresh route must not scan every registered domain before authorization."
);

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      web: "railway.toml",
      worker: "deploy/railway-worker.toml",
      browserInstall: true
    },
    null,
    2
  )}\n`
);

function assertIncludes(value: string, expected: string, message: string) {
  assert(value.includes(expected), message);
}

function assertRemovedEnv(value: string, names: string[], message: string) {
  const present = names.filter((name) => new RegExp(`^${name}=`, "m").test(value));
  assert(present.length === 0, `${message} Found: ${present.join(", ")}.`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
