import "./load-env";

import { getSupabaseAdminClient } from "../lib/supabase/client";
import { supabaseRepository } from "../lib/supabase/repository";
import { requiredPublicEligibilityFactIds } from "../lib/control-plane";
import { ASSET_BUCKET_NAME, imageMimeTypeMatchesBytes, storeAssetBytes } from "../lib/asset-storage";
import { assertSiteVersionV3, pageCountForVersionV3 } from "../lib/site-version-v3";
import { sampleSiteBundle } from "../lib/sample-data";
import { applySiteIdentity } from "../lib/site-identity";
import { generationSnapshotFromIntakeBundle } from "../lib/intake-generation-snapshot";
import { buildGenerationPlan } from "../lib/vertical-packs";
import { createFixtureSiteCopy } from "../lib/site-copy";
import { compileSite } from "../lib/site-compiler";
import { submitControlPlaneChange } from "../lib/control-plane-service";

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
if (!liveIntegrations) {
  process.env.STRIPE_SECRET_KEY = "";
  process.env.STRIPE_PRICE_ID = "";
  process.env.CLOUDFLARE_API_TOKEN = "";
  process.env.CLOUDFLARE_ZONE_ID = "";
}
const checks: CheckResult[] = [];
let acceptedSiteId = "";
let createdCandidateId = "";
let createdBusinessId = "";
const createdJobIds = new Set<string>();
const createdAgentRunIds = new Set<string>();
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
  await verifyAgentTelemetry(supabase);
  await verifyAssetStorage(supabase);
  if (storageOnly) {
    process.stdout.write(`${JSON.stringify({ ok: true, runId, kept: keep, checks }, null, 2)}\n`);
    return;
  }

  const candidateBundle = structuredClone(sampleSiteBundle);
  applySiteIdentity(candidateBundle, `verify-${runId}`);
  const canonicalInput = generationSnapshotFromIntakeBundle({
    bundle: candidateBundle,
    assets: [],
    crawl: {
      url: `https://verify-${runId}.example`,
      finalUrl: `https://verify-${runId}.example`,
      title: candidateBundle.businessProfile.name,
      extractedFacts: {
        name: candidateBundle.businessProfile.name,
        description: candidateBundle.businessProfile.description,
        phone: candidateBundle.businessProfile.phone,
        email: candidateBundle.businessProfile.email,
        address: candidateBundle.businessProfile.address,
        geo: candidateBundle.businessProfile.geo,
        hours: candidateBundle.businessProfile.hours,
        categories: candidateBundle.businessProfile.categories,
        services: candidateBundle.businessProfile.services,
        serviceAreas: candidateBundle.businessProfile.serviceAreas,
        socialLinks: candidateBundle.businessProfile.socialLinks,
        bookingLinks: candidateBundle.businessProfile.bookingLinks,
        orderingLinks: candidateBundle.businessProfile.orderingLinks,
        pressLinks: candidateBundle.businessProfile.pressLinks
      },
      pageSummaries: []
    } as unknown as import("../lib/crawler").CrawlAssessment,
    eligibilityMode: "public"
  });
  createdBusinessId = canonicalInput.state.business.id;
  const candidatePlan = buildGenerationPlan({
    snapshot: canonicalInput.snapshot,
    evidence: canonicalInput.snapshot.evidenceManifest
  });
  const candidateCopy = createFixtureSiteCopy(candidatePlan, canonicalInput.snapshot);
  const candidateVersion = compileSite({
    snapshot: canonicalInput.snapshot,
    plan: candidatePlan,
    copy: candidateCopy
  });
  await supabaseRepository.persistCanonicalGenerationInput(canonicalInput);
  const candidate = await supabaseRepository.createSiteCandidate({
    id: `sitecand_verify_${runId}`,
    snapshot: canonicalInput.snapshot,
    version: candidateVersion,
    plan: candidatePlan,
    copy: candidateCopy,
    sourceUrl: `https://verify-${runId}.example`,
    sourceHost: `verify-${runId}.example`,
    status: "ready",
    candidatePurpose: "test_generation"
  });
  createdCandidateId = candidate.id;
  const accepted = await supabaseRepository.acceptSiteCandidateAsSite(candidate.id);
  assert(accepted?.ok, `Canonical candidate was not accepted: ${accepted && !accepted.ok ? accepted.reason : "missing result"}`);
  const bundle = accepted.bundle;
  acceptedSiteId = bundle.businessProfile.siteId;
  assert(bundle.siteModel.versions.length > 0, "Generated site has no versions.");
  checks.push({
    name: "accept_canonical_candidate",
    ok: true,
    detail: `Accepted canonical candidate ${candidate.id} as ${bundle.businessProfile.siteId}.`
  });

  const loaded = await supabaseRepository.getSiteBundle(acceptedSiteId);
  assert(loaded?.businessProfile.siteId === acceptedSiteId, "Persisted site could not be loaded by id.");
  assert(loaded.extensionModel.forms.length > 0, "Persisted site is missing forms.");
  if (loaded.locations?.length) {
    assert(loaded.locationBindings?.length === loaded.locations.length, "Persisted site did not hydrate coherent location bindings.");
    assert(loaded.locationBindings?.[0]?.role === "primary", "Persisted site did not hydrate a primary location binding.");
  }
  checks.push({ name: "load_site", ok: true, detail: `Loaded persisted site with ${pageCountForVersionV3(assertSiteVersionV3(loaded.siteModel.versions[0]))} page(s).` });

  const bySlug = await supabaseRepository.getSiteBundleBySlug(bundle.siteModel.slug);
  assert(bySlug?.businessProfile.siteId === acceptedSiteId, "Persisted site could not be loaded by slug.");
  checks.push({ name: "load_by_slug", ok: true, detail: "Loaded persisted site by slug." });

  const assetControlPlane = await supabaseRepository.getCanonicalControlPlane(acceptedSiteId);
  assert(assetControlPlane, "Canonical control plane was not available for asset verification.");
  const now = new Date().toISOString();
  const assetId = `asset_verify_${runId}`;
  const revisionId = `assetrev_verify_${runId}`;
  const assetChange = await submitControlPlaneChange({
    repository: supabaseRepository,
    siteId: acceptedSiteId,
    requestedBy: "verify-supabase@example.com",
    payload: {
      kind: "register_asset",
      asset: {
        id: assetId,
        businessId: assetControlPlane.state.business.id,
        kind: "logo",
        alt: "Lodesta verification logo",
        source: "uploaded",
        usageScope: "published_site",
        ownerApproved: true,
        active: true,
        currentRevisionId: revisionId,
        createdAt: now,
        updatedAt: now
      },
      revision: {
        schemaVersion: "asset-revision-v1",
        id: revisionId,
        assetId,
        businessId: assetControlPlane.state.business.id,
        contentHash: `verify${runId}`.padEnd(64, "0").slice(0, 64),
        storagePath: `${acceptedSiteId}/verify-${runId}.png`,
        publicUrl: `/api/assets/${acceptedSiteId}/verify-${runId}.png`,
        mimeType: "image/png",
        bytes: 1,
        rightsStatus: "customer_granted",
        attestation: { attestedBy: "verify-supabase@example.com", attestedAt: now, statement: "Verification fixture rights attestation." },
        createdAt: now
      }
    }
  });
  assert(
    assetChange.applied && assetChange.publish === "structural_candidate_queued" && assetChange.jobId,
    "Registering a published asset must queue one structural candidate rebuild."
  );
  createdJobIds.add(assetChange.jobId);
  await requireSupabase(supabase.from("jobs").delete().eq("id", assetChange.jobId), "Cleanup structural asset rebuild job");
  createdJobIds.delete(assetChange.jobId);
  const assetReload = await supabaseRepository.getCanonicalControlPlane(acceptedSiteId);
  assert(assetReload?.state.assets.some((asset) => asset.id === assetId && asset.ownerApproved), "Owner-approved canonical asset did not persist.");
  checks.push({ name: "owner_assets", ok: true, detail: "Persisted one owner-approved immutable asset revision." });

  const preview = await supabaseRepository.createPreviewToken({
    siteId: acceptedSiteId,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60).toISOString()
  });
  assert(preview?.token, "Preview token was not created.");
  const resolvedPreview = await supabaseRepository.resolvePreviewToken(preview.token);
  assert(resolvedPreview?.bundle.businessProfile.siteId === acceptedSiteId, "Preview token did not resolve to the created site.");
  const expiredPreview = await supabaseRepository.createPreviewToken({
    siteId: acceptedSiteId,
    expiresAt: new Date(Date.now() - 1000 * 60).toISOString()
  });
  assert(expiredPreview?.token, "Expired preview token probe was not created.");
  assert(
    (await supabaseRepository.resolvePreviewToken(expiredPreview.token)) === null,
    "Expired Supabase preview tokens must not resolve."
  );
  checks.push({ name: "preview_token", ok: true, detail: `Created active ${preview.token} and rejected an expired preview token.` });

  const reloadedBundle = await supabaseRepository.getSiteBundle(acceptedSiteId);
  const sourceVersionId = reloadedBundle?.siteModel.versions[0]?.id;
  assert(sourceVersionId, "No version is available to restore.");
  const restored = await supabaseRepository.restoreVersionToDraft({
    siteId: acceptedSiteId,
    versionId: sourceVersionId
  });
  assert(restored?.ok, "Version restore did not create a draft.");
  const restoredReload = await supabaseRepository.getSiteBundle(acceptedSiteId);
  assert(
    restoredReload?.siteModel.versions.some((version) => version.id === restored.draftVersionId && version.status === "draft"),
    "Restored draft version did not persist."
  );
  checks.push({ name: "version_restore", ok: true, detail: `Restored ${sourceVersionId} into draft ${restored.draftVersionId}.` });

  await supabaseRepository.recordAnalyticsEvent({
    siteId: acceptedSiteId,
    sessionId: `verify_${runId}`,
    visitorId: `visitor_${runId}`,
    pageId: "home",
    eventType: "pageview",
    timestamp: new Date().toISOString(),
    metadata: { smoke: true, runId }
  });
  await supabaseRepository.recordAnalyticsEvent({
    siteId: acceptedSiteId,
    sessionId: `verify_${runId}`,
    visitorId: `visitor_${runId}`,
    pageId: "home",
    eventType: "tel_click",
    timestamp: new Date().toISOString(),
    metadata: { role: "tel", runId }
  });
  await supabaseRepository.recordAnalyticsEvent({
    siteId: acceptedSiteId,
    sessionId: `verify_old_${runId}`,
    pageId: "home",
    eventType: "pageview",
    timestamp: "2020-01-01T00:00:00.000Z",
    metadata: { runId }
  });
  await supabaseRepository.recordAnalyticsEvent({
    siteId: acceptedSiteId,
    sessionId: `verify_agent_${runId}`,
    pageId: "home",
    eventType: "agent_readable_request",
    timestamp: new Date().toISOString(),
    metadata: {
      resource: "llms.txt",
      path: "/llms.txt",
      runId
    }
  });
  const analytics = await supabaseRepository.analyticsSummary(acceptedSiteId);
  assert(analytics.sessions >= 1, "Analytics summary did not include the recorded session.");
  assert(analytics.agentReadableRequests >= 1, "Agent-readable analytics did not include the recorded request.");
  const analyticsEvents = await supabaseRepository.listAnalyticsEvents(acceptedSiteId);
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

  const forms = await supabaseRepository.getForms(acceptedSiteId);
  const form = forms[0];
  assert(form, "Created site has no form to submit.");
  const inquiryResult = await supabaseRepository.createInquiryFromForm({
    siteId: acceptedSiteId,
    form,
    pageId: "home",
    visitorId: `visitor_${runId}`,
    payload: {
      name: "Supabase Verify",
      phone: "+15125550199",
      details: "Testing Supabase persistence."
    },
    metadata: {
      sessionId: `verify_${runId}`,
      landingPath: `/${bundle.siteModel.slug}`
    },
    sourceUrl: `https://example.test/${bundle.siteModel.slug}`,
    userAgent: "lodesta-supabase-verifier"
  });
  const inquiryQueueJobs = await requireSupabase<Array<{ id: string }>>(
    supabase.from("jobs").select("id").contains("payload", { inquiryId: inquiryResult.inquiry.id }),
    "Track inquiry queue jobs"
  );
  for (const queuedJob of inquiryQueueJobs) {
    createdJobIds.add(queuedJob.id);
  }
  const inquiries = await supabaseRepository.listInquiries(acceptedSiteId);
  assert(inquiries.some((candidate) => candidate.id === inquiryResult.inquiry.id), "Inquiry was not persisted.");
  assert(
    inquiries.some((candidate) => candidate.id === inquiryResult.inquiry.id && candidate.contactPhone === "+15125550199"),
    "Inquiry contact snapshot was not persisted."
  );
  const events = await supabaseRepository.listInquiryEvents(inquiryResult.inquiry.id);
  assert(
    events.some((event) => event.id === inquiryResult.event.id && event.metadata?.visitorId === `visitor_${runId}`),
    "Inquiry event visitor metadata was not persisted."
  );
  const reviewedInquiry = await supabaseRepository.updateInquiryStatus({
    siteId: acceptedSiteId,
    inquiryId: inquiryResult.inquiry.id,
    status: "needs_reply"
  });
  assert(reviewedInquiry?.status === "needs_reply", "Inquiry status update did not persist.");
  const delivery = await supabaseRepository.recordInquiryDelivery({
    siteId: acceptedSiteId,
    inquiryId: inquiryResult.inquiry.id,
    eventId: inquiryResult.event.id,
    workflowId: "verify_workflow_email",
    destination: "email",
    target: `owner-${runId}@example.com`,
    status: "skipped",
    message: "Verification delivery recorded without sending external email."
  });
  const deliveries = await supabaseRepository.listInquiryDeliveries(acceptedSiteId);
  assert(deliveries.some((candidate) => candidate.id === delivery.id), "Inquiry delivery was not persisted.");
  checks.push({
    name: "inquiry",
    ok: true,
    detail: `Recorded inquiry ${inquiryResult.inquiry.id}, marked it needs_reply, and stored delivery ${delivery.id}.`
  });
  if (inquiryQueueJobs.length) {
    await requireSupabase(
      supabase.from("jobs").delete().in(
        "id",
        inquiryQueueJobs.map((queuedJob) => queuedJob.id)
      ),
      "Cleanup inquiry queue jobs before monthly job verifier"
    );
  }

  const draftAssignment = await supabaseRepository.assignExperiment({
    siteId: acceptedSiteId,
    sessionId: `verify_${runId}`
  });
  assert(!draftAssignment.assigned, "Canonical sites must not seed per-site experiments.");
  assert((await supabaseRepository.listExperiments(acceptedSiteId)).length === 0, "Persisted canonical bundle must keep experiment rails dormant.");
  checks.push({ name: "experiment", ok: true, detail: "Confirmed per-site experiment rails remain dormant." });

  const claim = await supabaseRepository.createClaim({
    siteId: acceptedSiteId,
    ownerEmail: `owner-${runId}@example.com`,
    verificationLevel: "operator_verified",
    verificationMethod: "operator_manual",
    verifiedBy: "verify-supabase",
    verifiedAt: new Date().toISOString(),
    verifiedFacts: requiredPublicEligibilityFactIds(canonicalInput.state),
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
    site_id: acceptedSiteId,
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
    siteId: acceptedSiteId,
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
    siteId: acceptedSiteId,
    checkoutSessionId: expectedCheckoutSessionId,
    stripeCustomerId: `cus_verify_${runId}`,
    stripeSubscriptionId: `sub_verify_${runId}`,
    completedAt: new Date().toISOString()
  });
  assert(completedClaim?.status === "claimed", "Claim checkout completion did not persist.");
  checks.push({ name: "claim", ok: true, detail: `Created and completed claim ${claim.id}; checkout configured=${claim.checkout.configured}.` });

  const domain = await supabaseRepository.registerDomain({
    siteId: acceptedSiteId,
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
    siteId: acceptedSiteId,
    businessName: bundle.businessProfile.name,
    vertical: "auto_body",
    previewToken: preview.token,
    mailingCode: `VERIFY-${runId.slice(-6)}`
  });
  await supabaseRepository.recordOutboundEvent({
    campaignId: campaign.id,
    prospectId: prospect.id,
    siteId: acceptedSiteId,
    type: "preview_viewed",
    value: 1
  });
  await supabaseRepository.recordOutboundEvent({
    campaignId: campaign.id,
    prospectId: prospect.id,
    siteId: acceptedSiteId,
    type: "claim_completed",
    value: 1
  });
  const outbound = await supabaseRepository.outboundSummary(campaign.id);
  assert(outbound.mailerToPreviewRate >= 1 && outbound.mailerToClaimRate >= 1, "Outbound summary did not include verification events.");
  checks.push({ name: "outbound", ok: true, detail: `Recorded outbound campaign ${campaign.id} with prospect ${prospect.id}.` });

  const job = await supabaseRepository.enqueueJob("agent_telemetry_cleanup", { olderThanDays: 30, limit: 1 });
  createdJobIds.add(job.id);
  assert(job.maxAttempts >= 1 && Boolean(job.runAfter), "Queued job did not include retry/backoff metadata.");
  const processed = await supabaseRepository.processNextJob();
  assert(
    processed?.id === job.id && processed.status === "completed" && !processed.lockedBy && !processed.lockedAt,
    "Queued job did not complete and release its worker lock."
  );
  checks.push({ name: "job", ok: true, detail: `Processed telemetry cleanup job ${job.id}.` });

  const heartbeatJobId = `verify_heartbeat_${runId}`;
  const heartbeatWorkerId = `verify-heartbeat-${runId}`;
  createdJobIds.add(heartbeatJobId);
  const heartbeatStartedAt = new Date(Date.now() - 1000 * 60).toISOString();
  await requireSupabase(
    supabase.from("jobs").insert({
      id: heartbeatJobId,
      kind: "agent_telemetry_cleanup",
      status: "running",
      payload: { siteId: acceptedSiteId, verifier: "heartbeat_job" },
      attempts: 1,
      max_attempts: 3,
      run_after: heartbeatStartedAt,
      locked_by: heartbeatWorkerId,
      locked_at: heartbeatStartedAt,
      started_at: heartbeatStartedAt,
      created_at: heartbeatStartedAt,
      updated_at: heartbeatStartedAt
    }),
    "Insert heartbeat job"
  );
  const heartbeatAt = new Date().toISOString();
  const heartbeatRows = await requireSupabase<Array<{ id: string; locked_at: string }>>(
    supabase
      .from("jobs")
      .update({ locked_at: heartbeatAt, updated_at: heartbeatAt })
      .eq("id", heartbeatJobId)
      .eq("locked_by", heartbeatWorkerId)
      .eq("status", "running")
      .select("id, locked_at"),
    "Heartbeat running job"
  );
  assert(heartbeatRows.length === 1 && heartbeatRows[0]?.locked_at, "Heartbeat did not update a matching running job lock.");
  const wrongWorkerRows = await requireSupabase<Array<{ id: string }>>(
    supabase
      .from("jobs")
      .update({ locked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", heartbeatJobId)
      .eq("locked_by", `${heartbeatWorkerId}-wrong`)
      .eq("status", "running")
      .select("id"),
    "Heartbeat wrong worker"
  );
  assert(wrongWorkerRows.length === 0, "Heartbeat must not update a job locked by a different worker.");
  checks.push({ name: "job_heartbeat", ok: true, detail: `Heartbeat updated and protected running job ${heartbeatJobId}.` });

  const staleJobId = `verify_stale_${runId}`;
  createdJobIds.add(staleJobId);
  const staleLockedAt = new Date(Date.now() - 1000 * 60 * 60).toISOString();
  await requireSupabase(
    supabase.from("jobs").insert({
      id: staleJobId,
      kind: "agent_telemetry_cleanup",
      status: "running",
      payload: { siteId: acceptedSiteId, verifier: "stale_exhausted_job" },
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
  if (createdCandidateId) {
    await requireSupabase(supabase.from("site_candidates").delete().eq("id", createdCandidateId), "Cleanup site candidate");
  }
  if (acceptedSiteId) {
    await requireSupabase(supabase.from("sites").delete().eq("id", acceptedSiteId), "Cleanup site");
  }
  if (createdBusinessId) {
    const snapshots = await requireSupabase<Array<{ id: string; site_id: string }>>(
      supabase.from("generation_input_snapshots").select("id,site_id").eq("business_id", createdBusinessId),
      "Load verification generation snapshots"
    );
    const snapshotIds = snapshots.map((snapshot) => snapshot.id);
    const siteIds = Array.from(new Set(snapshots.map((snapshot) => snapshot.site_id)));
    if (snapshotIds.length) {
      await requireSupabase(
        supabase.from("generation_snapshot_sources").delete().in("snapshot_id", snapshotIds),
        "Cleanup generation snapshot sources"
      );
      await requireSupabase(
        supabase.from("generation_snapshot_asset_revisions").delete().in("snapshot_id", snapshotIds),
        "Cleanup generation snapshot asset revisions"
      );
    }
    await requireSupabase(
      supabase.from("control_plane_change_requests").delete().eq("business_id", createdBusinessId),
      "Cleanup control-plane change requests"
    );
    await requireSupabase(
      supabase.from("generation_input_snapshots").delete().eq("business_id", createdBusinessId),
      "Cleanup generation input snapshots"
    );
    await requireSupabase(supabase.from("business_assets").delete().eq("business_id", createdBusinessId), "Cleanup business assets");
    await requireSupabase(supabase.from("asset_revisions").delete().eq("business_id", createdBusinessId), "Cleanup asset revisions");
    await requireSupabase(supabase.from("business_proof").delete().eq("business_id", createdBusinessId), "Cleanup business proof");
    await requireSupabase(supabase.from("fact_observations").delete().eq("business_id", createdBusinessId), "Cleanup fact observations");
    await requireSupabase(supabase.from("source_snapshots").delete().eq("business_id", createdBusinessId), "Cleanup source snapshots");
    await requireSupabase(supabase.from("business_offerings").delete().eq("business_id", createdBusinessId), "Cleanup business offerings");
    await requireSupabase(supabase.from("business_locations").delete().eq("business_id", createdBusinessId), "Cleanup business locations");
    if (siteIds.length) {
      await requireSupabase(supabase.from("site_intents").delete().in("site_id", siteIds), "Cleanup site intents");
      await requireSupabase(supabase.from("form_definitions").delete().in("site_id", siteIds), "Cleanup form definitions");
    }
    await requireSupabase(supabase.from("businesses").delete().eq("id", createdBusinessId), "Cleanup canonical business");
  }
  if (createdJobIds.size) {
    await requireSupabase(supabase.from("jobs").delete().in("id", Array.from(createdJobIds)), "Cleanup jobs");
  }
  if (createdAgentRunIds.size) {
    await requireSupabase(supabase.from("agent_runs").delete().in("id", Array.from(createdAgentRunIds)), "Cleanup agent telemetry");
  }
}

async function verifyAgentTelemetry(supabase: ReturnType<typeof getSupabaseAdminClient>) {
  await requireSupabase(supabase.from("agent_runs").select("id", { count: "exact", head: true }), "Query agent runs");
  await requireSupabase(supabase.from("agent_run_spans").select("id", { count: "exact", head: true }), "Query agent run spans");
  await requireSupabase(supabase.from("agent_model_calls").select("id", { count: "exact", head: true }), "Query agent model calls");

  const run = await supabaseRepository.createAgentRun({
    runType: "site_generation",
    agentType: "site_generator",
    source: "api",
    sourceUrl: `https://verify-${runId}.example`,
    sourceHost: `verify-${runId}.example`,
    inputSummary: "Telemetry verifier",
    inputJson: { url: `https://verify-${runId}.example`, email: `verify-${runId}@example.com` }
  });
  assert(run?.id, "Agent run was not created.");
  createdAgentRunIds.add(run.id);

  const span = await supabaseRepository.createAgentRunSpan({
    runId: run.id,
    spanType: "crawl",
    name: "Verifier crawl",
    inputJson: { url: run.sourceUrl },
    outputJson: { fetched: true }
  });
  assert(span?.id, "Agent run span was not created.");

  await supabaseRepository.recordAgentModelCall({
    runId: run.id,
    spanId: span.id,
    provider: "openai",
    model: "verifier-model",
    endpoint: "/v1/responses",
    operation: "verify",
    status: "completed",
    inputTokens: 7,
    outputTokens: 11,
    cacheReadTokens: 3,
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    durationMs: 1
  });
  await supabaseRepository.updateAgentRun({
    runId: run.id,
    status: "completed",
    targetType: "site",
    targetId: `verify-target-${runId}`,
    notes: "Verifier note",
    tags: ["verify"],
    endedAt: new Date().toISOString()
  });
  const detail = await supabaseRepository.getAgentRunDetail(run.id);
  assert(detail?.spans.length === 1, "Agent run detail did not include the created span.");
  assert(detail.modelCalls.length === 1, "Agent run detail did not include the created model call.");
  assert(detail.tokenTotals.totalTokens === 21, "Agent run token totals were not computed from model calls.");

  const oldRunId = `verify_old_agent_${runId}`;
  createdAgentRunIds.add(oldRunId);
  await requireSupabase(
    supabase.from("agent_runs").insert({
      id: oldRunId,
      run_type: "site_generation",
      agent_type: "site_generator",
      status: "completed",
      source: "job",
      input_summary: "Old verifier telemetry",
      tags: [],
      metadata: {},
      started_at: "2020-01-01T00:00:00.000Z",
      ended_at: "2020-01-01T00:00:01.000Z",
      created_at: "2020-01-01T00:00:00.000Z",
      updated_at: "2020-01-01T00:00:01.000Z"
    }),
    "Insert old agent telemetry"
  );
  const cleanup = await supabaseRepository.cleanupAgentTelemetry({ olderThanDays: 30, limit: 1 });
  assert(cleanup.deleted === 1, "Agent telemetry cleanup did not delete one bounded old run.");
  createdAgentRunIds.delete(oldRunId);
  checks.push({ name: "agent_telemetry", ok: true, detail: `Created run ${run.id} and verified bounded cleanup.` });
}

async function verifyAssetStorage(supabase: ReturnType<typeof getSupabaseAdminClient>) {
  const { data: bucket, error: bucketError } = await supabase.storage.getBucket(ASSET_BUCKET_NAME);
  assert(!bucketError && bucket, `Asset storage bucket is unavailable: ${bucketError?.message ?? "not found"}.`);
  assert(bucket.public === false, `Asset storage bucket ${ASSET_BUCKET_NAME} must be private.`);

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
      detail: `Verified private storage and uploaded, downloaded, and removed a probe image from ${ASSET_BUCKET_NAME}/${stored.storagePath}.`
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

async function requireSupabase<T>(query: PromiseLike<{ data: T | null; error: { message: string } | null }>, label: string) {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data as T;
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
