import { chromium } from "playwright";
import { appOriginEnvName } from "./app-origin";
import { hasConfiguredHashSecret, usesDevelopmentHashSecret } from "./hash-secret";
import { sitePlatformRepository } from "@/packages/platform-data";

export type HealthState = "ok" | "warning" | "error";
export type HealthCheck = { id: string; label: string; state: HealthState; detail: string };
export type HealthReport = { status: HealthState; timestamp: string; checks: HealthCheck[] };

export async function getHealthReport(options: { deep?: boolean } = {}): Promise<HealthReport> {
  const checks = [
    checkUrl(), checkRepository(), checkAuth(), checkAdmin(), checkSandbox(),
    checkArtifactBroker(), checkOpenAi(), checkHashSecret(), checkEmail(), checkPlaces()
  ];
  if (options.deep) checks.push(await checkRepositoryReadiness(), await checkSandboxReadiness(), await checkBrowserReadiness());
  return { status: worst(checks.map((item) => item.state)), timestamp: new Date().toISOString(), checks };
}

function checkUrl() {
  const value = process.env[appOriginEnvName];
  if (!value) return deployed() ? error("app_url", "Application URL", `${appOriginEnvName} is required.`) : warning("app_url", "Application URL", `${appOriginEnvName} is not set.`);
  try { new URL(value); return ok("app_url", "Application URL", `${appOriginEnvName} is configured.`); }
  catch { return error("app_url", "Application URL", `${appOriginEnvName} must be an absolute URL.`); }
}

function checkRepository() {
  const missing = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter((name) => !process.env[name]);
  return missing.length ? error("repository", "Repository", `Missing ${missing.join(", ")}.`) : ok("repository", "Repository", "Supabase repository is configured.");
}

function checkAuth() {
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL) && Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY);
  return configured ? ok("auth", "Owner authentication", "Supabase Auth is configured.") : (deployed() ? error : warning)("auth", "Owner authentication", "Supabase public URL and anonymous key are missing.");
}

function checkAdmin() {
  return process.env.LODESTA_ADMIN_TOKEN ? ok("admin", "Admin authorization", "Admin token is configured.") : (deployed() ? error : warning)("admin", "Admin authorization", "LODESTA_ADMIN_TOKEN is not configured.");
}

function checkSandbox() {
  return process.env.LODESTA_SANDBOX_URL && process.env.LODESTA_SANDBOX_TOKEN
    ? ok("sandbox", "Cloudflare Sandbox", "Sandbox bridge and authentication are configured.")
    : error("sandbox", "Cloudflare Sandbox", "LODESTA_SANDBOX_URL and LODESTA_SANDBOX_TOKEN are required.");
}

function checkArtifactBroker() {
  if (process.env.LODESTA_ARTIFACT_STORAGE !== "r2") {
    return ok("artifacts", "Immutable artifact storage", "Local immutable artifact storage is configured.");
  }
  return process.env.LODESTA_ARTIFACT_BROKER_URL && process.env.LODESTA_ARTIFACT_BROKER_TOKEN
    ? ok("artifacts", "Immutable artifact storage", "Exact-object artifact broker is configured.")
    : error("artifacts", "Immutable artifact storage", "LODESTA_ARTIFACT_BROKER_URL and LODESTA_ARTIFACT_BROKER_TOKEN are required.");
}

function checkOpenAi() { return process.env.OPENAI_API_KEY ? ok("openai", "Website manager model", "OpenAI is configured.") : error("openai", "Website manager model", "OPENAI_API_KEY is required for site construction and edits."); }
function checkHashSecret() { if (hasConfiguredHashSecret()) return ok("hash_secret", "Privacy hash secret", "Stable visitor hashing uses a deployment secret."); return (deployed() ? error : warning)("hash_secret", "Privacy hash secret", usesDevelopmentHashSecret() ? "Using the development hash secret." : "LODESTA_HASH_SECRET is missing."); }
function checkEmail() { return process.env.RESEND_API_KEY ? ok("email", "Operational email", "Resend is configured.") : warning("email", "Operational email", "Email notifications are disabled."); }
function checkPlaces() { return process.env.GOOGLE_PLACES_API_KEY ? ok("places", "Google Places", "Places enrichment is configured.") : warning("places", "Google Places", "Places enrichment is disabled."); }

async function checkRepositoryReadiness() {
  try { const sites = await sitePlatformRepository.listSites(); return ok("repository_readiness", "Repository readiness", `Repository responded with ${sites.length} site(s).`); }
  catch (caught) { return error("repository_readiness", "Repository readiness", message(caught)); }
}

async function checkSandboxReadiness() {
  if (!process.env.LODESTA_SANDBOX_URL || !process.env.LODESTA_SANDBOX_TOKEN) return error("sandbox_readiness", "Sandbox readiness", "Sandbox configuration is missing.");
  try {
    const response = await fetch(`${process.env.LODESTA_SANDBOX_URL.replace(/\/$/, "")}/health`, { headers: { authorization: `Bearer ${process.env.LODESTA_SANDBOX_TOKEN}` }, signal: AbortSignal.timeout(8_000) });
    return response.ok ? ok("sandbox_readiness", "Sandbox readiness", "Cloudflare Sandbox responded.") : error("sandbox_readiness", "Sandbox readiness", `Sandbox returned ${response.status}.`);
  } catch (caught) { return error("sandbox_readiness", "Sandbox readiness", message(caught)); }
}

async function checkBrowserReadiness() {
  try { const browser = await chromium.launch({ headless: true }); await browser.close(); return ok("browser", "Browser verification", "Playwright Chromium launched."); }
  catch (caught) { return (deployed() ? error : warning)("browser", "Browser verification", `${message(caught)} Run npm run install:browsers.`); }
}

function deployed() { return process.env.NODE_ENV === "production"; }
function message(value: unknown) { return value instanceof Error ? value.message : String(value); }
function worst(states: HealthState[]): HealthState { return states.includes("error") ? "error" : states.includes("warning") ? "warning" : "ok"; }
function ok(id: string, label: string, detail: string): HealthCheck { return { id, label, state: "ok", detail }; }
function warning(id: string, label: string, detail: string): HealthCheck { return { id, label, state: "warning", detail }; }
function error(id: string, label: string, detail: string): HealthCheck { return { id, label, state: "error", detail }; }
