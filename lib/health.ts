import { repository } from "./repository";
import { hasConfiguredHashSecret, usesDevelopmentHashSecret } from "./hash-secret";
import { getRenderInspectionRuntimeStatus } from "./render-inspection";
import { ASSET_BUCKET_NAME } from "./asset-storage";
import { getSupabaseAdminClient } from "./supabase/client";
import { getOpenAiRuntimeSettings } from "./operator-settings";

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
  const assetStorageCheck = options.deep ? await checkAssetStorageReadiness() : checkAssetStorageConfig();
  const openAiCheck = await checkOpenAiConfig({ deep: Boolean(options.deep) });
  const checks = [
    checkAppUrl(),
    checkRepositoryConfig(),
    checkAdminToken(),
    checkSupabaseAuthConfig(),
    checkStripeConfig(),
    checkCloudflareConfig(),
    checkWorkflowEmailConfig(),
    checkHashSecretConfig(),
    checkGooglePlacesConfig(),
    assetStorageCheck,
    openAiCheck
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
    if (requiresDeploymentConfig()) {
      return error("app_url", "Application URL", "NEXT_PUBLIC_APP_URL is required for deployed environments.");
    }
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
  const missing = missingEnv(["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);
  if (missing.length) {
    return error("repository", "Repository", `Supabase repository is missing ${missing.join(", ")}.`);
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

  if (requiresDeploymentConfig()) {
    return error(
      "supabase_auth",
      "Supabase Auth",
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required for deployed owner login."
    );
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

function checkHashSecretConfig(): HealthCheck {
  if (hasConfiguredHashSecret()) {
    return ok("hash_secret", "Hash secret", "Stable visitor hashing and rate-limit fingerprints use a deployment secret.");
  }
  if (process.env.NODE_ENV === "production") {
    return error("hash_secret", "Hash secret", "Set LODESTA_HASH_SECRET in production before recording visitor attribution hashes.");
  }
  if (usesDevelopmentHashSecret()) {
    return warning("hash_secret", "Hash secret", "Using the development hash secret; set LODESTA_HASH_SECRET for deployed environments.");
  }
  return warning("hash_secret", "Hash secret", "Hash secret is not configured.");
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
  return ok(
    "asset_storage",
    "Asset storage",
    `Generated asset bytes will upload to Supabase Storage bucket ${ASSET_BUCKET_NAME}.`
  );
}

async function checkAssetStorageReadiness(): Promise<HealthCheck> {
  try {
    const { data, error: bucketError } = await getSupabaseAdminClient().storage.getBucket(ASSET_BUCKET_NAME);
    if (bucketError || !data) {
      return error(
        "asset_storage",
        "Asset storage",
        `Supabase Storage bucket ${ASSET_BUCKET_NAME} is missing or inaccessible: ${bucketError?.message ?? "bucket not found"}.`
      );
    }
    return ok("asset_storage", "Asset storage", `Supabase Storage bucket ${ASSET_BUCKET_NAME} is accessible.`);
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : String(caught);
    return error("asset_storage", "Asset storage", `Supabase Storage bucket ${ASSET_BUCKET_NAME} check failed: ${message}`);
  }
}

async function checkOpenAiConfig({ deep }: { deep: boolean }): Promise<HealthCheck> {
  if (process.env.OPENAI_API_KEY) {
    if (!deep) return ok("openai", "OpenAI", "OPENAI_API_KEY is configured; operator settings control model choices.");

    const runtimeSettings = await getOpenAiRuntimeSettings();
    const state = runtimeSettings.warning ? warning : ok;
    return state(
      "openai",
      "OpenAI",
      [
        `OPENAI_API_KEY is configured with settings_source=${runtimeSettings.source}.`,
        `Generation ${runtimeSettings.settings.generationModel}; visual QA ${runtimeSettings.settings.visualQaModel}; mockups ${runtimeSettings.settings.imageModel}.`,
        runtimeSettings.warning
      ]
        .filter(Boolean)
        .join(" ")
    );
  }
  return warning(
    "openai",
    "OpenAI",
    "OPENAI_API_KEY is not set; deterministic generation and prompt-only mockup artifacts still work, but hosted AI calls are unavailable."
  );
}

function requiresDeploymentConfig() {
  return process.env.NODE_ENV === "production";
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

  const state = process.env.NODE_ENV === "production" ? error : warning;
  return state(
    "render_browser_readiness",
    "Render browser readiness",
    `${status.message} Run npm run install:browsers.`
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
