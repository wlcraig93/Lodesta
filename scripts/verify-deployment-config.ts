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
const jobsRoute = readFileSync("app/api/jobs/route.ts", "utf8");
const scheduleRoute = readFileSync("app/api/jobs/schedule/route.ts", "utf8");
const stripeWebhookRoute = readFileSync("app/api/stripe/webhook/route.ts", "utf8");
const jobsSource = readFileSync("lib/jobs.ts", "utf8");
const jobSchedulerSource = readFileSync("lib/job-scheduler.ts", "utf8");
const modelsSource = readFileSync("lib/models.ts", "utf8");
const repositorySource = readFileSync("lib/repository.ts", "utf8");
const supabaseRepositorySource = readFileSync("lib/supabase/repository.ts", "utf8");
const imageGenerationSource = readFileSync("lib/image-generation.ts", "utf8");
const supabaseVerifierSource = readFileSync("scripts/verify-supabase.ts", "utf8");
const cliSource = readFileSync("scripts/lodesta.mjs", "utf8");
const devCrawlVerifierSource = readFileSync("scripts/verify-dev-crawl.mjs", "utf8");

assert(packageJson.dependencies?.playwright, "playwright must be a runtime dependency for deployed render inspection.");
assert(packageJson.scripts?.["install:browsers"], "package.json must expose npm run install:browsers.");
assert(packageJson.scripts?.["verify:render-browser"], "package.json must expose npm run verify:render-browser.");
assert(packageJson.scripts?.["verify:dev-crawl"], "package.json must expose npm run verify:dev-crawl.");
assert(packageJson.scripts?.["seed:openai-settings"], "package.json must expose npm run seed:openai-settings.");
assertIncludes(envExample, "LODESTA_WORKFLOW_TIMEOUT_MS=5000", ".env.example must document the workflow delivery timeout.");
assertIncludes(envExample, "LODESTA_CRAWL_FIXTURE_TOKEN=", ".env.example must document the protected crawl fixture token.");
assertIncludes(envExample, "LODESTA_HASH_SECRET=", ".env.example must document the canonical hash secret.");
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
assertIncludes(schemaSql, "create index agent_runs_target_idx on agent_runs(target_type, target_id);", "Agent telemetry target lookup must be indexed.");
assertIncludes(schemaSql, "alter table agent_runs enable row level security;", "Agent run telemetry must have RLS enabled.");
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
