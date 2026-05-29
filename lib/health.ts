import { repository } from "./repository";

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
    checkOpenAiConfig()
  ];

  if (options.deep) {
    checks.push(await checkRepositoryReadiness());
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

  if (process.env.NODE_ENV === "production") {
    return error("admin_token", "Admin token", "LODESTA_ADMIN_TOKEN is required in production for operator-only APIs.");
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

function checkOpenAiConfig(): HealthCheck {
  if (process.env.OPENAI_API_KEY) return ok("openai", "OpenAI", "OPENAI_API_KEY is configured for future AI generation calls.");
  return warning("openai", "OpenAI", "OPENAI_API_KEY is not set; current deterministic generation still works, but hosted AI calls are unavailable.");
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
