import "./load-env";

import { getSupabaseAdminClient } from "../lib/supabase/client";
import { supabaseRepository } from "../lib/supabase/repository";

type CheckResult = {
  name: string;
  ok: true;
  detail: string;
};

const args = new Set(process.argv.slice(2));
const keep = args.has("--keep");
const liveIntegrations = args.has("--live-integrations");
const runId = `${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 17)}${crypto.randomUUID().slice(0, 8)}`;
const prompt = [
  `Build a website for Lodesta Verify ${runId}.`,
  "A home services company based in Austin.",
  "services: HVAC repair, emergency plumbing, electrical safety inspections.",
  "phone: +1 555 010 1200.",
  `email: verify-${runId}@example.com.`
].join(" ");

if (!liveIntegrations) {
  process.env.STRIPE_SECRET_KEY = "";
  process.env.STRIPE_PRICE_ID = "";
  process.env.CLOUDFLARE_API_TOKEN = "";
  process.env.CLOUDFLARE_ZONE_ID = "";
}

const checks: CheckResult[] = [];
let createdSiteId: string | undefined;
let createdJobId: string | undefined;

async function main() {
  requireEnv("SUPABASE_URL");
  requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const supabase = getSupabaseAdminClient();
  await requireSupabase(supabase.from("sites").select("id", { count: "exact", head: true }), "Connect to Supabase");
  checks.push({ name: "connect", ok: true, detail: "Supabase service-role client can query the schema." });

  const bundle = await supabaseRepository.createAndStoreSite({ prompt });
  createdSiteId = bundle.businessProfile.siteId;
  assert(bundle.siteModel.versions.length > 0, "Generated site has no versions.");
  checks.push({
    name: "create_site",
    ok: true,
    detail: `Created ${bundle.businessProfile.name} (${bundle.businessProfile.siteId}) with slug ${bundle.siteModel.slug}.`
  });

  const loaded = await supabaseRepository.getSiteBundle(createdSiteId);
  assert(loaded?.businessProfile.siteId === createdSiteId, "Persisted site could not be loaded by id.");
  assert(loaded.extensionModel.forms.length > 0, "Persisted site is missing forms.");
  checks.push({ name: "load_site", ok: true, detail: `Loaded persisted site with ${loaded.siteModel.versions[0]?.pages.length ?? 0} page(s).` });

  const bySlug = await supabaseRepository.getSiteBundleBySlug(bundle.siteModel.slug);
  assert(bySlug?.businessProfile.siteId === createdSiteId, "Persisted site could not be loaded by slug.");
  checks.push({ name: "load_by_slug", ok: true, detail: "Loaded persisted site by slug." });

  const preview = await supabaseRepository.createPreviewToken({
    siteId: createdSiteId,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60).toISOString()
  });
  assert(preview?.token, "Preview token was not created.");
  const resolvedPreview = await supabaseRepository.resolvePreviewToken(preview.token);
  assert(resolvedPreview?.bundle.businessProfile.siteId === createdSiteId, "Preview token did not resolve to the created site.");
  checks.push({ name: "preview_token", ok: true, detail: `Created and resolved ${preview.token}.` });

  const findings = await supabaseRepository.runAndStoreAudit(createdSiteId);
  assert(Array.isArray(findings), "Audit did not return findings.");
  checks.push({ name: "audit", ok: true, detail: `Stored ${findings.length} finding(s).` });

  await supabaseRepository.recordAnalyticsEvent({
    siteId: createdSiteId,
    sessionId: `verify_${runId}`,
    pageId: "page_home",
    eventType: "pageview",
    timestamp: new Date().toISOString(),
    metadata: { smoke: true, runId }
  });
  await supabaseRepository.recordAnalyticsEvent({
    siteId: createdSiteId,
    sessionId: `verify_${runId}`,
    pageId: "page_home",
    eventType: "tel_click",
    timestamp: new Date().toISOString(),
    metadata: { role: "tel", runId }
  });
  const analytics = await supabaseRepository.analyticsSummary(createdSiteId);
  assert(analytics.sessions >= 1, "Analytics summary did not include the recorded session.");
  checks.push({ name: "analytics", ok: true, detail: `Analytics summary has ${analytics.sessions} session(s).` });

  const forms = await supabaseRepository.getForms(createdSiteId);
  const form = forms[0];
  assert(form, "Created site has no form to submit.");
  const lead = await supabaseRepository.recordFormSubmission({
    siteId: createdSiteId,
    formId: form.id,
    pageId: "page_home",
    payload: {
      name: "Supabase Verify",
      email: "verify@example.com",
      message: "Testing Supabase persistence."
    },
    metadata: {
      sessionId: `verify_${runId}`,
      landingPath: `/${bundle.siteModel.slug}`
    },
    sourceUrl: `https://example.test/${bundle.siteModel.slug}`,
    userAgent: "lodesta-supabase-verifier"
  });
  const leads = await supabaseRepository.listFormSubmissions(createdSiteId);
  assert(leads.some((candidate) => candidate.id === lead.id), "Lead submission was not persisted.");
  checks.push({ name: "lead", ok: true, detail: `Recorded lead ${lead.id}.` });

  const assignment = await supabaseRepository.assignExperiment({
    siteId: createdSiteId,
    sessionId: `verify_${runId}`
  });
  assert(assignment.assigned, "Experiment assignment failed.");
  checks.push({ name: "experiment", ok: true, detail: `Assigned experiment ${assignment.experimentId}.` });

  const claim = await supabaseRepository.createClaim({
    siteId: createdSiteId,
    ownerEmail: `owner-${runId}@example.com`,
    verifiedFacts: ["name", "phone", "services"],
    acceptedTerms: true,
    acceptedManagement: true
  });
  assert(claim?.ownerEmail === `owner-${runId}@example.com`, "Claim was not persisted with the expected owner email.");
  checks.push({ name: "claim", ok: true, detail: `Created claim ${claim.id}; checkout configured=${claim.checkout.configured}.` });

  const domain = await supabaseRepository.registerDomain({
    siteId: createdSiteId,
    hostname: `verify-${runId}.example.com`,
    provider: "cloudflare_for_saas"
  });
  assert(domain?.hostname === `verify-${runId}.example.com`, "Domain registration did not persist.");
  checks.push({ name: "domain", ok: true, detail: `Registered fallback domain ${domain.hostname}.` });

  const job = await supabaseRepository.enqueueJob("monthly_action_list", { siteId: createdSiteId });
  createdJobId = job.id;
  const processed = await supabaseRepository.processNextJob();
  assert(processed?.id === job.id && processed.status === "completed", "Queued job did not complete.");
  checks.push({ name: "job", ok: true, detail: `Processed monthly action-list job ${job.id}.` });

  if (!keep) {
    await cleanup(supabase);
    checks.push({ name: "cleanup", ok: true, detail: "Deleted verification site and job rows." });
  }

  process.stdout.write(`${JSON.stringify({ ok: true, runId, kept: keep, checks }, null, 2)}\n`);
}

async function cleanup(supabase: ReturnType<typeof getSupabaseAdminClient>) {
  if (createdSiteId) {
    await requireSupabase(supabase.from("sites").delete().eq("id", createdSiteId), "Cleanup site");
  }
  if (createdJobId) {
    await requireSupabase(supabase.from("jobs").delete().eq("id", createdJobId), "Cleanup job");
  }
}

function requireEnv(name: string) {
  if (!process.env[name]) {
    throw new Error(`${name} is required. Run this after creating the Supabase project and applying supabase/schema.sql.`);
  }
}

async function requireSupabase<T>(query: PromiseLike<{ data: T; error: { message: string } | null }>, label: string) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

main().catch(async (error) => {
  try {
    if (!keep) await cleanup(getSupabaseAdminClient());
  } catch {
    // Keep the original failure visible.
  }
  process.stderr.write(`Supabase verification failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
