import "./load-env";

import { getSupabaseAdminClient } from "../lib/supabase/client";
import { supabaseRepository } from "../lib/supabase/repository";
import { requiredClaimFactIds } from "../lib/fact-verification";
import { ASSET_BUCKET_NAME, imageMimeTypeMatchesBytes, storeAssetBytes } from "../lib/asset-storage";

type CheckResult = {
  name: string;
  ok: true;
  detail: string;
};

const args = new Set(process.argv.slice(2));
const keep = args.has("--keep");
const liveIntegrations = args.has("--live-integrations");
const storageOnly = args.has("--storage-only");
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
const createdJobIds = new Set<string>();
let createdCampaignId: string | undefined;
let uploadedStoragePath: string | undefined;

async function main() {
  requireEnv("SUPABASE_URL");
  requireEnv("SUPABASE_SERVICE_ROLE_KEY");

  const supabase = getSupabaseAdminClient();
  await requireSupabase(supabase.from("sites").select("id", { count: "exact", head: true }), "Connect to Supabase");
  checks.push({ name: "connect", ok: true, detail: "Supabase service-role client can query the schema." });
  await requireSupabase(supabase.from("operator_settings").select("key", { count: "exact", head: true }), "Query operator settings");
  await requireSupabase(supabase.from("operator_setting_audits").select("id", { count: "exact", head: true }), "Query operator setting audits");
  checks.push({ name: "operator_settings", ok: true, detail: "Operator settings and audit tables are queryable." });
  await verifyAssetStorage(supabase);
  if (storageOnly) {
    process.stdout.write(`${JSON.stringify({ ok: true, runId, kept: keep, checks }, null, 2)}\n`);
    return;
  }

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

  const ownerAssets = await supabaseRepository.updateOwnerAssets({
    siteId: createdSiteId,
    rightsAccepted: true,
    logo: {
      url: `https://assets.example/verify-${runId}-logo.png`,
      alt: "Lodesta verification logo"
    },
    photos: [
      {
        url: `https://assets.example/verify-${runId}-truck.webp`,
        alt: "Lodesta verification service truck"
      }
    ]
  });
  assert(ownerAssets?.ok, "Owner-approved assets were not accepted.");
  const assetReload = await supabaseRepository.getSiteBundle(createdSiteId);
  assert(assetReload?.businessProfile.logo?.rightsStatus === "customer_granted", "Owner logo did not persist.");
  assert(
    assetReload.presenceAssessment.assetInventory?.some(
      (asset) => asset.ownerApproved && asset.usageScope === "published_site" && asset.rightsStatus === "customer_granted"
    ),
    "Owner-approved site assets did not persist to the asset registry."
  );
  checks.push({ name: "owner_assets", ok: true, detail: `Persisted ${ownerAssets.assets.length} owner-approved asset(s).` });

  const preview = await supabaseRepository.createPreviewToken({
    siteId: createdSiteId,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60).toISOString()
  });
  assert(preview?.token, "Preview token was not created.");
  const resolvedPreview = await supabaseRepository.resolvePreviewToken(preview.token);
  assert(resolvedPreview?.bundle.businessProfile.siteId === createdSiteId, "Preview token did not resolve to the created site.");
  const expiredPreview = await supabaseRepository.createPreviewToken({
    siteId: createdSiteId,
    expiresAt: new Date(Date.now() - 1000 * 60).toISOString()
  });
  assert(expiredPreview?.token, "Expired preview token probe was not created.");
  assert(
    (await supabaseRepository.resolvePreviewToken(expiredPreview.token)) === null,
    "Expired Supabase preview tokens must not resolve."
  );
  checks.push({ name: "preview_token", ok: true, detail: `Created active ${preview.token} and rejected an expired preview token.` });

  const findings = await supabaseRepository.runAndStoreAudit(createdSiteId);
  assert(Array.isArray(findings), "Audit did not return findings.");
  checks.push({ name: "audit", ok: true, detail: `Stored ${findings.length} finding(s).` });

  const sourceVersionId = loaded.siteModel.versions[0]?.id;
  assert(sourceVersionId, "No version is available to restore.");
  const restored = await supabaseRepository.restoreVersionToDraft({
    siteId: createdSiteId,
    versionId: sourceVersionId
  });
  assert(restored?.ok, "Version restore did not create a draft.");
  const restoredReload = await supabaseRepository.getSiteBundle(createdSiteId);
  assert(
    restoredReload?.siteModel.versions.some((version) => version.id === restored.draftVersionId && version.status === "draft"),
    "Restored draft version did not persist."
  );
  checks.push({ name: "version_restore", ok: true, detail: `Restored ${sourceVersionId} into draft ${restored.draftVersionId}.` });

  await supabaseRepository.recordAnalyticsEvent({
    siteId: createdSiteId,
    sessionId: `verify_${runId}`,
    visitorId: `visitor_${runId}`,
    pageId: "page_home",
    eventType: "pageview",
    timestamp: new Date().toISOString(),
    metadata: { smoke: true, runId }
  });
  await supabaseRepository.recordAnalyticsEvent({
    siteId: createdSiteId,
    sessionId: `verify_${runId}`,
    visitorId: `visitor_${runId}`,
    pageId: "page_home",
    eventType: "tel_click",
    timestamp: new Date().toISOString(),
    metadata: { role: "tel", runId }
  });
  await supabaseRepository.recordAnalyticsEvent({
    siteId: createdSiteId,
    sessionId: `verify_old_${runId}`,
    pageId: "page_home",
    eventType: "pageview",
    timestamp: "2020-01-01T00:00:00.000Z",
    metadata: { runId }
  });
  await supabaseRepository.recordAnalyticsEvent({
    siteId: createdSiteId,
    sessionId: `verify_agent_${runId}`,
    pageId: "page_home",
    eventType: "agent_readable_request",
    timestamp: new Date().toISOString(),
    metadata: {
      resource: "llms.txt",
      path: "/llms.txt",
      runId
    }
  });
  const analytics = await supabaseRepository.analyticsSummary(createdSiteId);
  assert(analytics.sessions >= 1, "Analytics summary did not include the recorded session.");
  assert(analytics.agentReadableRequests >= 1, "Agent-readable analytics did not include the recorded request.");
  const analyticsEvents = await supabaseRepository.listAnalyticsEvents(createdSiteId);
  assert(
    analyticsEvents.some((event) => event.sessionId === `verify_old_${runId}` && event.timestamp === "2020-01-01T00:00:00.000Z"),
    "Analytics events should retain old site performance history."
  );
  assert(
    analyticsEvents.some((event) => event.sessionId === `verify_${runId}` && event.visitorId === `visitor_${runId}`),
    "Analytics visitor id was not persisted."
  );
  checks.push({
    name: "analytics",
    ok: true,
    detail: `Analytics summary has ${analytics.sessions} session(s), ${analyticsEvents.length} retained event(s), and ${analytics.agentReadableRequests} agent-readable request(s).`
  });

  const forms = await supabaseRepository.getForms(createdSiteId);
  const form = forms[0];
  assert(form, "Created site has no form to submit.");
  const lead = await supabaseRepository.recordFormSubmission({
    siteId: createdSiteId,
    formId: form.id,
    pageId: "page_home",
    visitorId: `visitor_${runId}`,
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
  assert(leads.some((candidate) => candidate.id === lead.id && candidate.visitorId === `visitor_${runId}`), "Lead visitor id was not persisted.");
  const reviewedLead = await supabaseRepository.updateLeadStatus({
    siteId: createdSiteId,
    submissionId: lead.id,
    status: "reviewed"
  });
  assert(reviewedLead?.status === "reviewed", "Lead status update did not persist.");
  const delivery = await supabaseRepository.recordWorkflowDelivery({
    siteId: createdSiteId,
    workflowId: "verify_workflow_email",
    submissionId: lead.id,
    destination: "email",
    target: `owner-${runId}@example.com`,
    status: "skipped",
    message: "Verification delivery recorded without sending external email."
  });
  const deliveries = await supabaseRepository.listWorkflowDeliveries(createdSiteId);
  assert(deliveries.some((candidate) => candidate.id === delivery.id), "Workflow delivery was not persisted.");
  checks.push({ name: "lead", ok: true, detail: `Recorded lead ${lead.id}, marked it reviewed, and stored delivery ${delivery.id}.` });

  const draftAssignment = await supabaseRepository.assignExperiment({
    siteId: createdSiteId,
    sessionId: `verify_${runId}`
  });
  assert(!draftAssignment.assigned, "Experiment assignment should not run before owner opt-in.");

  const experiment = bundle.experiments[0];
  assert(experiment, "Created site has no experiment candidate.");
  const optIn = await supabaseRepository.updateExperiment({
    siteId: createdSiteId,
    experimentId: experiment.id,
    status: "running"
  });
  assert(optIn?.ok && optIn.experiment.status === "running", "Experiment opt-in did not persist.");

  const assignment = await supabaseRepository.assignExperiment({
    siteId: createdSiteId,
    sessionId: `verify_${runId}`
  });
  assert(assignment.assigned, "Experiment assignment failed.");
  for (let index = 1; index <= 20; index += 1) {
    const variantId = index <= 10 ? "control" : "sticky_action";
    await supabaseRepository.recordAnalyticsEvent({
      siteId: createdSiteId,
      sessionId: `verify_experiment_${runId}_${index}`,
      pageId: "page_home",
      eventType: "experiment_assignment",
      timestamp: new Date().toISOString(),
      metadata: { experimentId: experiment.id, variantId, runId }
    });
  }
  for (let index = 11; index <= 14; index += 1) {
    await supabaseRepository.recordAnalyticsEvent({
      siteId: createdSiteId,
      sessionId: `verify_experiment_${runId}_${index}`,
      pageId: "page_home",
      eventType: "tel_click",
      timestamp: new Date().toISOString(),
      metadata: { runId }
    });
  }
  const learning = await supabaseRepository.concludeExperimentWithLearning({
    siteId: createdSiteId,
    experimentId: experiment.id
  });
  assert(learning?.ok && learning.learning.status === "active", "Experiment learning was not adopted.");
  checks.push({ name: "experiment", ok: true, detail: `Opted in, assigned, and adopted learning ${learning.learning.id}.` });

  const claim = await supabaseRepository.createClaim({
    siteId: createdSiteId,
    ownerEmail: `owner-${runId}@example.com`,
    verifiedFacts: requiredClaimFactIds(bundle.businessProfile),
    acceptedTerms: true,
    acceptedManagement: true
  });
  assert(claim?.ownerEmail === `owner-${runId}@example.com`, "Claim was not persisted with the expected owner email.");
  const expectedCheckoutSessionId = claim.stripeCheckoutSessionId ?? `cs_verify_${runId}`;
  if (!claim.stripeCheckoutSessionId) {
    await requireSupabase(
      supabase.from("claims").update({ stripe_checkout_session_id: expectedCheckoutSessionId }).eq("id", claim.id),
      "Seed checkout session"
    );
  }
  const duplicateCheckoutClaimId = `verify_duplicate_checkout_${runId}`;
  const duplicateCheckout = await supabase.from("claims").insert({
    id: duplicateCheckoutClaimId,
    site_id: createdSiteId,
    owner_email: `duplicate-${runId}@example.com`,
    status: "checkout_required",
    stripe_checkout_session_id: expectedCheckoutSessionId,
    fact_verification: { verifier: "duplicate_checkout_session" }
  });
  if (!duplicateCheckout.error) {
    await requireSupabase(supabase.from("claims").delete().eq("id", duplicateCheckoutClaimId), "Cleanup duplicate checkout claim");
    throw new Error("Supabase schema accepted a duplicate Stripe checkout session id.");
  }
  const mismatchedClaim = await supabaseRepository.completeClaimCheckout({
    claimId: claim.id,
    siteId: createdSiteId,
    checkoutSessionId: `cs_wrong_${runId}`,
    stripeCustomerId: `cus_wrong_${runId}`,
    stripeSubscriptionId: `sub_wrong_${runId}`,
    completedAt: new Date().toISOString()
  });
  assert(mismatchedClaim === null, "Claim checkout completion accepted a mismatched Stripe checkout session.");
  const wrongSiteClaim = await supabaseRepository.completeClaimCheckout({
    claimId: claim.id,
    siteId: `site_wrong_${runId}`,
    checkoutSessionId: expectedCheckoutSessionId,
    stripeCustomerId: `cus_wrong_site_${runId}`,
    stripeSubscriptionId: `sub_wrong_site_${runId}`,
    completedAt: new Date().toISOString()
  });
  assert(wrongSiteClaim === null, "Claim checkout completion accepted mismatched site metadata.");
  const completedClaim = await supabaseRepository.completeClaimCheckout({
    claimId: claim.id,
    siteId: createdSiteId,
    checkoutSessionId: expectedCheckoutSessionId,
    stripeCustomerId: `cus_verify_${runId}`,
    stripeSubscriptionId: `sub_verify_${runId}`,
    completedAt: new Date().toISOString()
  });
  assert(completedClaim?.status === "claimed", "Claim checkout completion did not persist.");
  checks.push({ name: "claim", ok: true, detail: `Created and completed claim ${claim.id}; checkout configured=${claim.checkout.configured}.` });

  const domain = await supabaseRepository.registerDomain({
    siteId: createdSiteId,
    hostname: `verify-${runId}.example.com`,
    provider: "cloudflare_for_saas"
  });
  assert(domain?.hostname === `verify-${runId}.example.com`, "Domain registration did not persist.");
  const domainByHostname = await supabaseRepository.getDomainByHostname(domain.hostname);
  assert(domainByHostname?.id === domain.id, "Domain lookup by hostname did not return the registered domain.");
  const refreshedDomain = await supabaseRepository.refreshDomain({ domainId: domain.id });
  assert(refreshedDomain?.id === domain.id, "Domain refresh did not return the registered domain.");
  checks.push({ name: "domain", ok: true, detail: `Registered, looked up, and refreshed domain ${domain.hostname}.` });

  const campaign = await supabaseRepository.createOutboundCampaign({
    name: `Supabase verification ${runId}`,
    status: "running",
    channel: "direct_mail",
    metadata: { plannedRecipients: 1 }
  });
  createdCampaignId = campaign.id;
  const prospect = await supabaseRepository.upsertOutboundProspect({
    campaignId: campaign.id,
    siteId: createdSiteId,
    businessName: bundle.businessProfile.name,
    vertical: "home_services",
    previewToken: preview.token,
    mailingCode: `VERIFY-${runId.slice(-6)}`
  });
  await supabaseRepository.recordOutboundEvent({
    campaignId: campaign.id,
    prospectId: prospect.id,
    siteId: createdSiteId,
    type: "preview_viewed",
    value: 1
  });
  await supabaseRepository.recordOutboundEvent({
    campaignId: campaign.id,
    prospectId: prospect.id,
    siteId: createdSiteId,
    type: "claim_completed",
    value: 1
  });
  const outbound = await supabaseRepository.outboundSummary(campaign.id);
  assert(outbound.mailerToPreviewRate >= 1 && outbound.mailerToClaimRate >= 1, "Outbound summary did not include verification events.");
  checks.push({ name: "outbound", ok: true, detail: `Recorded outbound campaign ${campaign.id} with prospect ${prospect.id}.` });

  const job = await supabaseRepository.enqueueJob("monthly_action_list", { siteId: createdSiteId });
  createdJobIds.add(job.id);
  assert(job.maxAttempts >= 1 && Boolean(job.runAfter), "Queued job did not include retry/backoff metadata.");
  const processed = await supabaseRepository.processNextJob();
  assert(
    processed?.id === job.id && processed.status === "completed" && !processed.lockedBy && !processed.lockedAt,
    "Queued job did not complete and release its worker lock."
  );
  checks.push({ name: "job", ok: true, detail: `Processed monthly action-list job ${job.id}.` });

  const staleJobId = `verify_stale_${runId}`;
  createdJobIds.add(staleJobId);
  const staleLockedAt = new Date(Date.now() - 1000 * 60 * 60).toISOString();
  await requireSupabase(
    supabase.from("jobs").insert({
      id: staleJobId,
      kind: "monthly_action_list",
      status: "running",
      payload: { siteId: createdSiteId, verifier: "stale_exhausted_job" },
      attempts: 1,
      max_attempts: 1,
      run_after: staleLockedAt,
      locked_by: `verify-stale-${runId}`,
      locked_at: staleLockedAt,
      started_at: staleLockedAt,
      created_at: staleLockedAt,
      updated_at: staleLockedAt
    }),
    "Insert stale exhausted job"
  );
  await supabaseRepository.processNextJob();
  const staleJob = await supabaseRepository.getJob(staleJobId);
  assert(
    staleJob?.status === "failed" && !staleJob.lockedBy && !staleJob.lockedAt && staleJob.error?.includes("Job lock expired"),
    "Stale exhausted running job was not failed and unlocked by claim_next_job."
  );
  checks.push({ name: "stale_job", ok: true, detail: `Failed and unlocked stale exhausted job ${staleJobId}.` });

  if (!keep) {
    await cleanup(supabase);
    checks.push({ name: "cleanup", ok: true, detail: "Deleted verification site and job rows." });
  }

  process.stdout.write(`${JSON.stringify({ ok: true, runId, kept: keep, checks }, null, 2)}\n`);
}

async function cleanup(supabase: ReturnType<typeof getSupabaseAdminClient>) {
  await cleanupStorageProbe(supabase);
  if (createdCampaignId) {
    await requireSupabase(supabase.from("outbound_campaigns").delete().eq("id", createdCampaignId), "Cleanup outbound campaign");
  }
  if (createdSiteId) {
    await requireSupabase(supabase.from("sites").delete().eq("id", createdSiteId), "Cleanup site");
  }
  if (createdJobIds.size) {
    await requireSupabase(supabase.from("jobs").delete().in("id", Array.from(createdJobIds)), "Cleanup jobs");
  }
}

async function verifyAssetStorage(supabase: ReturnType<typeof getSupabaseAdminClient>) {
  const probeBytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR42mP8z8AABQMBgGIY4YAAAAAASUVORK5CYII=",
    "base64"
  );
  assert(imageMimeTypeMatchesBytes("image/png", probeBytes), "Asset storage probe PNG fixture is invalid.");
  const stored = await storeAssetBytes({
    siteId: `verify-assets-${runId}`,
    assetId: `probe-${runId}`,
    bytes: probeBytes,
    mimeType: "image/png",
    publicUrl: false
  });
  uploadedStoragePath = stored.storagePath;

  try {
    assert(stored.provider === "supabase", `Asset storage probe used ${stored.provider} storage instead of Supabase.`);
    assert(stored.bytes === probeBytes.byteLength, "Asset storage probe reported the wrong byte count.");

    const { data, error } = await supabase.storage.from(ASSET_BUCKET_NAME).download(stored.storagePath);
    if (error || !data) {
      throw new Error(`Download asset storage probe: ${error?.message ?? "no object returned"}`);
    }
    const downloaded = Buffer.from(await data.arrayBuffer());
    assert(downloaded.equals(probeBytes), "Downloaded asset storage probe bytes did not match the upload.");

    checks.push({
      name: "asset_storage",
      ok: true,
      detail: `Uploaded, downloaded, and removed a probe image from ${ASSET_BUCKET_NAME}/${stored.storagePath}.`
    });
  } finally {
    await cleanupStorageProbe(supabase);
  }
}

async function cleanupStorageProbe(supabase: ReturnType<typeof getSupabaseAdminClient>) {
  if (!uploadedStoragePath) return;
  const storagePath = uploadedStoragePath;
  await requireSupabase(supabase.storage.from(ASSET_BUCKET_NAME).remove([storagePath]), "Cleanup asset storage probe");
  uploadedStoragePath = undefined;
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
    const supabase = getSupabaseAdminClient();
    await cleanupStorageProbe(supabase);
    if (!keep) await cleanup(supabase);
  } catch {
    // Keep the original failure visible.
  }
  process.stderr.write(`Supabase verification failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
