import { repository } from "./repository";
import { hasConfiguredIpHashSalt } from "./privacy";
import { getRenderInspectionRuntimeStatus } from "./render-inspection";

export type HealthState = "ok" | "warning" | "error";

export type HealthCheck = {
  id: string;
  label: string;
  state: HealthState;
  detail: string;
};

export type HealthReport = {
  status: HealthState;
  timestamp: string;
  checks: HealthCheck[];
};

export async function getHealthReport(options: { deep?: boolean } = {}): Promise<HealthReport> {
  const checks = [
    checkAppUrl(),
    checkRepositoryConfig(),
    checkAdminToken(),
    checkSupabaseAuthConfig(),
    checkStripeConfig(),
    checkCloudflareConfig(),
    checkWorkflowEmailConfig(),
    checkIpHashConfig(),
    checkAnalyticsRetentionConfig(),
    checkRateLimitConfig(),
    checkCrawlUrlSafetyConfig(),
    checkRenderBrowserConfig(),
    checkGooglePlacesConfig(),
    checkAssetStorageConfig(),
    checkOpenAiConfig()
  ];

  if (options.deep) {
    checks.push(await checkRepositoryReadiness(), await checkRenderBrowserReadiness());
  }

  return {
    status: worstState(checks.map((check) => check.state)),
    timestamp: new Date().toISOString(),
    checks
  };
}

function checkAppUrl(): HealthCheck {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    return warning("app_url", "Application URL", "NEXT_PUBLIC_APP_URL is not set; generated links will fall back to the request origin.");
  }

  try {
    new URL(appUrl);
    return ok("app_url", "Application URL", "NEXT_PUBLIC_APP_URL is configured.");
  } catch {
    return error("app_url", "Application URL", "NEXT_PUBLIC_APP_URL must be a valid absolute URL.");
  }
}

function checkRepositoryConfig(): HealthCheck {
  const backend = process.env.LODESTA_REPOSITORY ?? "local";
  if (backend === "local") {
    return warning("repository", "Repository", "Using the in-memory local repository; use LODESTA_REPOSITORY=supabase for deployed persistence.");
  }

  if (backend !== "supabase") {
    return error("repository", "Repository", `Unsupported LODESTA_REPOSITORY value: ${backend}.`);
  }

  const missing = missingEnv(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
  if (missing.length) {
    return error("repository", "Repository", `Supabase repository is selected but missing ${missing.join(", ")}.`);
  }

  return ok("repository", "Repository", "Supabase repository environment is configured.");
}

function checkAdminToken(): HealthCheck {
  if (process.env.LODESTA_ADMIN_TOKEN) {
    return ok("admin_token", "Admin token", "Admin token is configured.");
  }

  if (process.env.NODE_ENV === "production" || process.env.LODESTA_REQUIRE_AUTH === "true") {
    return error("admin_token", "Admin token", "LODESTA_ADMIN_TOKEN is required when production auth enforcement is active.");
  }

  return warning("admin_token", "Admin token", "Admin APIs are open because LODESTA_ADMIN_TOKEN is not set.");
}

function checkSupabaseAuthConfig(): HealthCheck {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (url && anonKey) {
    return ok("supabase_auth", "Supabase Auth", "Public Supabase Auth environment is configured.");
  }

  return warning(
    "supabase_auth",
    "Supabase Auth",
    "Owner magic-link login is disabled until NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set."
  );
}

function checkStripeConfig(): HealthCheck {
  const hasSecret = Boolean(process.env.STRIPE_SECRET_KEY);
  const hasPrice = Boolean(process.env.STRIPE_PRICE_ID);
  const hasWebhook = Boolean(process.env.STRIPE_WEBHOOK_SECRET);
  if (hasSecret && hasPrice && hasWebhook) return ok("stripe", "Stripe", "Stripe checkout and webhook completion are configured.");
  if (hasSecret && hasPrice && !hasWebhook) {
    return error("stripe", "Stripe", "Stripe checkout is configured but STRIPE_WEBHOOK_SECRET is missing, so paid claims will not auto-complete.");
  }
  if (!hasSecret && !hasPrice) return warning("stripe", "Stripe", "Stripe checkout is not configured; claims will return local fallback checkout.");
  return error("stripe", "Stripe", "Stripe is partially configured; set both STRIPE_SECRET_KEY and STRIPE_PRICE_ID.");
}

function checkCloudflareConfig(): HealthCheck {
  const hasToken = Boolean(process.env.CLOUDFLARE_API_TOKEN);
  const hasZone = Boolean(process.env.CLOUDFLARE_ZONE_ID);
  if (hasToken && hasZone) return ok("cloudflare", "Cloudflare for SaaS", "Cloudflare custom-hostname environment is configured.");
  if (!hasToken && !hasZone) {
    return warning(
      "cloudflare",
      "Cloudflare for SaaS",
      "Cloudflare for SaaS is not configured; custom domains will return fallback CNAME instructions."
    );
  }
  return error("cloudflare", "Cloudflare for SaaS", "Cloudflare is partially configured; set both CLOUDFLARE_API_TOKEN and CLOUDFLARE_ZONE_ID.");
}

function checkWorkflowEmailConfig(): HealthCheck {
  if (process.env.RESEND_API_KEY) return ok("workflow_email", "Workflow email", "Resend workflow email is configured.");
  return warning("workflow_email", "Workflow email", "RESEND_API_KEY is not set; email workflow deliveries are logged but not sent.");
}

function checkIpHashConfig(): HealthCheck {
  if (hasConfiguredIpHashSalt()) return ok("ip_hash_salt", "IP hash salt", "Privacy-preserving lead IP hashing has a deployment salt.");
  if (process.env.NODE_ENV === "production") {
    return error("ip_hash_salt", "IP hash salt", "Set LODESTA_IP_HASH_SALT in production before recording lead IP hashes.");
  }
  return warning("ip_hash_salt", "IP hash salt", "Using the development IP hash salt; set LODESTA_IP_HASH_SALT for deployed environments.");
}

function checkAnalyticsRetentionConfig(): HealthCheck {
  const configured = Number(process.env.LODESTA_ANALYTICS_RETENTION_DAYS ?? 395);
  if (!Number.isFinite(configured)) {
    return error("analytics_retention", "Analytics retention", "LODESTA_ANALYTICS_RETENTION_DAYS must be a number of days.");
  }
  if (configured < 30 || configured > 3650) {
    return error("analytics_retention", "Analytics retention", "Set LODESTA_ANALYTICS_RETENTION_DAYS between 30 and 3650 days.");
  }
  return ok(
    "analytics_retention",
    "Analytics retention",
    `Raw analytics retention is configured for ${Math.trunc(configured)} day(s).`
  );
}

function checkRateLimitConfig(): HealthCheck {
  if (process.env.LODESTA_RATE_LIMIT_SALT || process.env.LODESTA_IP_HASH_SALT) {
    return ok("rate_limit", "Rate limiting", "Public write endpoint rate limits use a deployment salt.");
  }
  if (process.env.NODE_ENV === "production") {
    return error("rate_limit", "Rate limiting", "Set LODESTA_RATE_LIMIT_SALT or LODESTA_IP_HASH_SALT in production.");
  }
  return warning("rate_limit", "Rate limiting", "Using the development rate-limit salt; set LODESTA_RATE_LIMIT_SALT for deployed environments.");
}

function checkCrawlUrlSafetyConfig(): HealthCheck {
  if (process.env.LODESTA_ALLOW_PRIVATE_CRAWL_URLS === "true") {
    const state = process.env.NODE_ENV === "production" ? error : warning;
    return state(
      "crawl_url_safety",
      "Crawl URL safety",
      "Private/internal crawl URLs are explicitly allowed; keep this disabled outside controlled local testing."
    );
  }
  return ok("crawl_url_safety", "Crawl URL safety", "Crawler and render jobs block private/internal target URLs.");
}

function checkRenderBrowserConfig(): HealthCheck {
  if (process.env.LODESTA_RENDER_BROWSER_REQUIRED === "true") {
    return ok(
      "render_browser_config",
      "Render browser config",
      "Render browser execution is required; deep health verifies Chromium launch."
    );
  }
  return warning(
    "render_browser_config",
    "Render browser config",
    "Render inspection falls back to HTML fetch when Chromium is unavailable; run npm run verify:render-browser before launch."
  );
}

function checkGooglePlacesConfig(): HealthCheck {
  if (process.env.GOOGLE_PLACES_API_KEY) {
    return ok("google_places", "Google Places", "Google Places Text Search enrichment is configured for permitted public presence signals.");
  }
  return warning(
    "google_places",
    "Google Places",
    "GOOGLE_PLACES_API_KEY is not set; presence enrichment will use website-derived public links and schema facts only."
  );
}

function checkAssetStorageConfig(): HealthCheck {
  if (process.env.LODESTA_REPOSITORY === "supabase" && process.env.LODESTA_ASSET_BUCKET) {
    return ok("asset_storage", "Asset storage", "Generated asset bytes will upload to the configured Supabase Storage bucket.");
  }
  if (process.env.LODESTA_REPOSITORY === "supabase") {
    return warning(
      "asset_storage",
      "Asset storage",
      "LODESTA_ASSET_BUCKET is not set; generated asset bytes will fall back to local .data storage."
    );
  }
  return warning("asset_storage", "Asset storage", "Using local .data asset storage for generated planning assets.");
}

function checkOpenAiConfig(): HealthCheck {
  if (process.env.OPENAI_API_KEY) {
    return ok(
      "openai",
      "OpenAI",
      `OPENAI_API_KEY is configured for generation planning with ${process.env.OPENAI_GENERATION_MODEL ?? "gpt-5.5"}, visual QA with ${process.env.OPENAI_VISUAL_QA_MODEL ?? process.env.OPENAI_GENERATION_MODEL ?? "gpt-5.5"}, and mockup planning with ${process.env.OPENAI_IMAGE_MODEL ?? "gpt-image-2"}.`
    );
  }
  return warning(
    "openai",
    "OpenAI",
    "OPENAI_API_KEY is not set; deterministic generation and prompt-only mockup artifacts still work, but hosted AI calls are unavailable."
  );
}

async function checkRepositoryReadiness(): Promise<HealthCheck> {
  try {
    const [sites, jobs] = await Promise.all([repository.listSiteBundles(), repository.listJobs("queued")]);
    return ok("repository_readiness", "Repository readiness", `Repository responded with ${sites.length} site(s) and ${jobs.length} queued job(s).`);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    return error("repository_readiness", "Repository readiness", `Repository check failed: ${message}`);
  }
}

async function checkRenderBrowserReadiness(): Promise<HealthCheck> {
  const status = await getRenderInspectionRuntimeStatus({ launch: true });
  if (status.browserLaunchable) {
    return ok("render_browser_readiness", "Render browser readiness", status.message);
  }

  const state = process.env.NODE_ENV === "production" || process.env.LODESTA_RENDER_BROWSER_REQUIRED === "true" ? error : warning;
  return state(
    "render_browser_readiness",
    "Render browser readiness",
    `${status.message} Run npm run install:browsers, or set LODESTA_BROWSER_EXECUTABLE_PATH.`
  );
}

function missingEnv(names: string[]) {
  return names.filter((name) => !process.env[name]);
}

function worstState(states: HealthState[]): HealthState {
  if (states.includes("error")) return "error";
  if (states.includes("warning")) return "warning";
  return "ok";
}

function ok(id: string, label: string, detail: string): HealthCheck {
  return { id, label, state: "ok", detail };
}

function warning(id: string, label: string, detail: string): HealthCheck {
  return { id, label, state: "warning", detail };
}

function error(id: string, label: string, detail: string): HealthCheck {
  return { id, label, state: "error", detail };
}
