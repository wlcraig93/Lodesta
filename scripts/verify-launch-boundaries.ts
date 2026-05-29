import "./load-env";

import type { AnalyticsEvent, ClaimRecord, JobRecord, OptimizationFinding } from "../lib/models";
import { summarizeAnalytics } from "../lib/analytics";
import { readLocalAsset, storeGeneratedAssetBytes } from "../lib/asset-storage";
import { cachePolicyForPathname } from "../lib/cache-policy";
import { scoreCrawlAssessment, type CrawlAssessment } from "../lib/crawler";
import { normalizeCustomHostname, refreshCustomHostnameStatus } from "../lib/domains";
import { createExperimentLearning } from "../lib/experiment-learning";
import { validateBusinessProfileUpdate, validateSectionUpdate } from "../lib/editor-guardrails";
import { applyFormSettingsUpdate } from "../lib/form-settings";
import { validateFormSubmission } from "../lib/form-validation";
import { createSiteFromInput } from "../lib/intake";
import { requireAdmin, requireAdminOrSiteOwner } from "../lib/security";
import { isAdminEmail } from "../lib/auth-policy";
import { applyOwnerAssetsUpdate } from "../lib/owner-assets";
import { updateSiteDesignBundle } from "../lib/design";
import { applySuggestedEdit, preserveFindingLifecycle } from "../lib/optimization";
import { newOutboundCampaign, newOutboundEvent, newOutboundProspect, applyOutboundEventToProspect, summarizeOutbound } from "../lib/outbound";
import { hashIpAddress, sanitizeAnalyticsMetadata, sanitizeAttributionUrl } from "../lib/privacy";
import { rateLimit } from "../lib/rate-limit";
import { getRenderInspectionRuntimeStatus, inspectUrlRender } from "../lib/render-inspection";
import { executeJob, retentionCutoffFromPayload, retentionDaysFromPayload } from "../lib/jobs";
import { scheduleLaunchJobs } from "../lib/job-scheduler";
import { validateLaunchMarket } from "../lib/launch-market";
import { runSiteQa } from "../lib/qa";
import { coldUrlCheckableChecks, evaluateSiteAgainstStandard } from "../lib/standard-evaluation";
import { applyVerifiedFacts, requiredClaimFactIds } from "../lib/fact-verification";
import { claimGateForBundle, isIndexableSite } from "../lib/site-publication";
import { makeLocalBusinessJsonLd } from "../lib/structured-data";
import { validatePublicFetchUrl, validatePublicHostname } from "../lib/url-safety";

const bundle = createSiteFromInput({
  prompt: "Build a website for Boundary Verify HVAC, a call-first HVAC company in Austin."
});
const requiredFacts = requiredClaimFactIds(bundle.businessProfile);

const checkoutRequiredClaim: ClaimRecord = {
  id: "claim_checkout_required",
  siteId: bundle.businessProfile.siteId,
  ownerEmail: "owner@example.com",
  verifiedFacts: requiredFacts,
  acceptedTermsAt: new Date().toISOString(),
  acceptedManagementAt: new Date().toISOString(),
  status: "checkout_required",
  createdAt: new Date().toISOString()
};

const claimedClaim: ClaimRecord = {
  ...checkoutRequiredClaim,
  id: "claim_claimed",
  status: "claimed",
  claimedAt: new Date().toISOString()
};

assert(!isIndexableSite(bundle, []), "Generated sites without claims must not be indexable.");
assert(!isIndexableSite(bundle, [checkoutRequiredClaim]), "Checkout-required claims must not be indexable.");
assert(isIndexableSite(bundle, [claimedClaim]), "Completed claimed sites should be indexable.");
const unclaimedGate = claimGateForBundle(bundle, []);
assert(
  !unclaimedGate.ok && unclaimedGate.code === "claim_required",
  "Publish/domain gates should require claim before checkout exists."
);
const checkoutGate = claimGateForBundle(bundle, [checkoutRequiredClaim]);
assert(
  !checkoutGate.ok && checkoutGate.code === "payment_required",
  "Publish/domain gates should require completed payment before checkout-required claims can publish."
);
const unverifiedClaimGate = claimGateForBundle(bundle, [{ ...claimedClaim, verifiedFacts: ["name"] }]);
assert(
  !unverifiedClaimGate.ok && unverifiedClaimGate.code === "verification_required",
  "Publish/domain gates should require required business facts after payment."
);
assert(
  claimGateForBundle(bundle, [claimedClaim]).ok,
  "Publish/domain gates should pass after a completed claim."
);

const authEnvSnapshot = {
  nodeEnv: process.env.NODE_ENV,
  requireAuth: process.env.LODESTA_REQUIRE_AUTH,
  adminToken: process.env.LODESTA_ADMIN_TOKEN,
  adminEmails: process.env.LODESTA_ADMIN_EMAILS,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  nextSupabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  nextSupabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
};
try {
  setEnv("NODE_ENV", "development");
  delete process.env.LODESTA_REQUIRE_AUTH;
  delete process.env.LODESTA_ADMIN_TOKEN;
  assert(requireAdmin(new Request("https://app.example/api/intake")) === null, "Local development may bypass admin auth when no token is configured.");
  assert(
    (await requireAdminOrSiteOwner(new Request("https://app.example/api/sites/publish"), bundle.businessProfile.siteId)) === null,
    "Local development may bypass owner auth when no token is configured."
  );

  process.env.LODESTA_REQUIRE_AUTH = "true";
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const forcedAdminAuth = requireAdmin(new Request("https://app.example/api/intake"));
  assert(forcedAdminAuth?.status === 401, "Admin routes must reject unauthenticated requests when auth enforcement is enabled.");
  const forcedOwnerAuth = await requireAdminOrSiteOwner(
    new Request("https://app.example/api/sites/publish"),
    bundle.businessProfile.siteId
  );
  assert(forcedOwnerAuth?.status === 401, "Owner routes must reject unauthenticated requests when auth enforcement is enabled.");

  setEnv("NODE_ENV", "production");
  delete process.env.LODESTA_REQUIRE_AUTH;
  const productionAdminAuth = requireAdmin(new Request("https://app.example/api/intake"));
  assert(productionAdminAuth?.status === 401, "Production admin routes must fail closed without LODESTA_ADMIN_TOKEN.");

  process.env.LODESTA_ADMIN_TOKEN = "boundary-secret";
  assert(
    requireAdmin(new Request("https://app.example/api/intake", { headers: { authorization: "Bearer boundary-secret" } })) === null,
    "Admin bearer token should authorize operator-only routes."
  );
  assert(
    requireAdmin(new Request("https://app.example/api/intake", { headers: { authorization: "Bearer wrong" } }))?.status === 401,
    "Invalid admin bearer token should be rejected."
  );

  process.env.LODESTA_ADMIN_EMAILS = "Admin@Example.com,ops@example.com";
  assert(isAdminEmail("admin@example.com"), "Admin page policy should match Supabase admin emails case-insensitively.");
  assert(!isAdminEmail("owner@example.com"), "Admin page policy should reject Supabase emails outside the admin allowlist.");
} finally {
  restoreEnv("NODE_ENV", authEnvSnapshot.nodeEnv);
  restoreEnv("LODESTA_REQUIRE_AUTH", authEnvSnapshot.requireAuth);
  restoreEnv("LODESTA_ADMIN_TOKEN", authEnvSnapshot.adminToken);
  restoreEnv("LODESTA_ADMIN_EMAILS", authEnvSnapshot.adminEmails);
  restoreEnv("SUPABASE_URL", authEnvSnapshot.supabaseUrl);
  restoreEnv("SUPABASE_ANON_KEY", authEnvSnapshot.supabaseAnonKey);
  restoreEnv("NEXT_PUBLIC_SUPABASE_URL", authEnvSnapshot.nextSupabaseUrl);
  restoreEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", authEnvSnapshot.nextSupabaseAnonKey);
}

const generatedEvaluation = evaluateSiteAgainstStandard(bundle);
const mockupArtifacts = bundle.presenceAssessment.mockupArtifacts ?? [];
const assetInventory = bundle.presenceAssessment.assetInventory ?? [];
assert(generatedEvaluation.source === "site_model", "Generated evaluation should use the site model.");
assert(generatedEvaluation.score.percent > 0, "Generated site evaluation should produce a score.");
assert(
  bundle.presenceAssessment.designDirections?.length === 3,
  "Generated launch sites should include three design directions."
);
assert(
  mockupArtifacts.length === 3,
  "Generated launch sites should include three creative mockup artifacts."
);
assert(
  mockupArtifacts.every((mockup) => mockup.planningOnly),
  "Creative mockups must be marked as planning-only artifacts."
);
assert(
  assetInventory.filter((asset) => asset.kind === "mockup").length === 3,
  "Creative mockups must be represented in the rights-aware asset inventory."
);
assert(
  !JSON.stringify(bundle.siteModel).includes("data:image"),
  "Generated image artifacts must not become the source of truth for rendered site sections."
);
const assetProbeRoot = "/private/tmp/lodesta-asset-storage-test";
const storedAsset = await storeGeneratedAssetBytes({
  siteId: "site_boundary_asset_probe",
  assetId: "asset_mockup_probe",
  base64: Buffer.from("asset probe").toString("base64"),
  mimeType: "image/jpeg",
  localRoot: assetProbeRoot,
  forceLocal: true
});
const readBackAsset = await readLocalAsset(storedAsset.storagePath, assetProbeRoot);
assert(
  storedAsset.url === "/api/assets/site_boundary_asset_probe/asset_mockup_probe.jpg" && readBackAsset?.bytes.length === 11,
  "Generated asset bytes should store outside model JSON and be readable through the local asset adapter."
);
const ipHash = hashIpAddress("203.0.113.10", {
  siteId: bundle.businessProfile.siteId,
  at: new Date("2026-05-29T12:00:00.000Z"),
  salt: "boundary-test-salt"
});
assert(
  Boolean(ipHash?.startsWith("v1:2026-05-29:")) && !ipHash?.includes("203.0.113.10"),
  "Lead IP hashing should persist only a salted daily hash, never the raw IP address."
);
const sanitizedAnalyticsMetadata = sanitizeAnalyticsMetadata({
  path: "/contact?email=owner@example.com&utm_source=mailer&token=secret",
  sourceUrl: "https://example.com/book?utm_campaign=postcard&phone=5125550101&gclid=abc123",
  ownerEmail: "owner@example.com",
  phoneNumber: "512-555-0101",
  message: "Please call me back",
  utmSource: "mailer",
  elapsedMs: 1200
});
assert(
  sanitizedAnalyticsMetadata?.path === "/contact?utm_source=mailer" &&
    sanitizedAnalyticsMetadata.sourceUrl === "https://example.com/book?utm_campaign=postcard" &&
    sanitizedAnalyticsMetadata.utmSource === "mailer" &&
    sanitizedAnalyticsMetadata.elapsedMs === 1200 &&
    !("ownerEmail" in sanitizedAnalyticsMetadata) &&
    !("phoneNumber" in sanitizedAnalyticsMetadata) &&
    !("message" in sanitizedAnalyticsMetadata),
  "Analytics metadata sanitization must strip sensitive URL params, contact fields, and form-like values while preserving safe attribution."
);
assert(
  sanitizeAttributionUrl("https://example.com/landing?utm_source=mailer&email=owner@example.com&token=secret") ===
    "https://example.com/landing?utm_source=mailer",
  "Stored attribution URLs should keep only safe attribution parameters."
);
const analyticsProbeEvents: AnalyticsEvent[] = [
  {
    siteId: bundle.businessProfile.siteId,
    sessionId: "analytics_probe_1",
    pageId: "page_home",
    eventType: "pageview",
    timestamp: "2026-05-29T12:00:00.000Z",
    deviceType: "mobile",
    metadata: { utmSource: "mailer", utmCampaign: "postcard" }
  },
  {
    siteId: bundle.businessProfile.siteId,
    sessionId: "analytics_probe_1",
    pageId: "page_home",
    sectionId: "hero_home",
    eventType: "tel_click",
    timestamp: "2026-05-29T12:00:03.000Z",
    elementRole: "sticky-tel",
    elementType: "a",
    hrefType: "tel",
    normalizedX: 0.82,
    normalizedY: 0.18,
    deviceType: "mobile"
  },
  {
    siteId: bundle.businessProfile.siteId,
    sessionId: "analytics_probe_2",
    pageId: "page_home",
    eventType: "pageview",
    timestamp: "2026-05-29T12:02:00.000Z",
    deviceType: "desktop",
    metadata: { referrerHost: "search.example" }
  },
  {
    siteId: bundle.businessProfile.siteId,
    sessionId: "analytics_probe_2",
    pageId: "page_home",
    sectionId: "contact_home",
    eventType: "form_start",
    timestamp: "2026-05-29T12:02:10.000Z",
    deviceType: "desktop"
  }
];
const analyticsProbe = summarizeAnalytics(bundle.businessProfile.siteId, analyticsProbeEvents);
assert(
  analyticsProbe.outcomesBySource.some((row) => row.key === "utm:mailer / postcard" && row.primaryActions === 1),
  "Analytics summary should attribute session outcomes back to UTM/referrer traffic sources."
);
assert(
  analyticsProbe.clickMap.some(
    (point) => point.sectionId === "hero_home" && point.elementRole === "sticky-tel" && point.primaryActions === 1
  ),
  "Analytics summary should aggregate normalized all-click coordinates into a click map."
);
assert(
  analyticsProbe.standardCorrelations.some(
    (row) => row.criterionId === "conversion.mobile_sticky_action" && row.primaryActions === 1
  ),
  "Analytics summary should correlate tracked outcomes to matching Standard criteria."
);
const unsafeUrlChecks = await Promise.all([
  validatePublicFetchUrl("http://localhost:3000", { resolveDns: false }),
  validatePublicFetchUrl("http://127.0.0.1:3000", { resolveDns: false }),
  validatePublicFetchUrl("http://10.0.0.12", { resolveDns: false }),
  validatePublicFetchUrl("http://169.254.169.254/latest/meta-data", { resolveDns: false }),
  validatePublicFetchUrl("http://[::1]/", { resolveDns: false }),
  validatePublicFetchUrl("ftp://example.com", { resolveDns: false }),
  validatePublicFetchUrl("https://user:pass@example.com", { resolveDns: false })
]);
assert(
  unsafeUrlChecks.every((check) => !check.ok),
  "URL intake safety should block localhost, private IPs, metadata endpoints, non-http protocols, and embedded credentials."
);
assert(
  validatePublicHostname("app.internal").ok === false && validatePublicHostname("printer.local").ok === false,
  "URL intake safety should block private/internal hostnames before crawl or render jobs run."
);
assert(
  (await validatePublicFetchUrl("https://www.lodesta.com", { resolveDns: false })).ok,
  "URL intake safety should allow fully qualified public HTTPS hostnames."
);
assert(
  !validateLaunchMarket({ prompt: "Build a website for a plumber in Toronto, Canada." }).ok &&
    !validateLaunchMarket({ url: "https://example.ca" }).ok &&
    !validateLaunchMarket({ facts: { address: { country: "CA" } } }).ok,
  "Launch market guard should reject explicit non-US prompt, domain, and extracted-country signals."
);
assert(
  validateLaunchMarket({
    prompt: "Build a call-first HVAC site in Tulsa, Oklahoma.",
    facts: { address: { country: "US" } }
  }).ok,
  "Launch market guard should allow US launch-market prompts and extracted US country facts."
);
const previousPrivateCrawlOverride = process.env.LODESTA_ALLOW_PRIVATE_CRAWL_URLS;
process.env.LODESTA_ALLOW_PRIVATE_CRAWL_URLS = "true";
assert(
  (await validatePublicFetchUrl("http://127.0.0.1:3000", { resolveDns: false })).ok,
  "Local fixture testing should be able to explicitly opt into private crawl URLs."
);
if (previousPrivateCrawlOverride === undefined) {
  delete process.env.LODESTA_ALLOW_PRIVATE_CRAWL_URLS;
} else {
  process.env.LODESTA_ALLOW_PRIVATE_CRAWL_URLS = previousPrivateCrawlOverride;
}

const rateLimitRequest = new Request("https://lodesta.example/api/forms/submit", {
  headers: {
    "x-forwarded-for": "203.0.113.10",
    "user-agent": "boundary-verifier"
  }
});
const firstRateLimit = rateLimit(rateLimitRequest, {
  bucket: "boundary_verify_form_submit",
  keyParts: [bundle.businessProfile.siteId, "form_contact"],
  limit: 1,
  windowMs: 60_000
});
const blockedRateLimit = rateLimit(rateLimitRequest, {
  bucket: "boundary_verify_form_submit",
  keyParts: [bundle.businessProfile.siteId, "form_contact"],
  limit: 1,
  windowMs: 60_000
});
const blockedRateLimitBody = blockedRateLimit.ok ? "" : await blockedRateLimit.response.text();
assert(
  firstRateLimit.ok &&
    !blockedRateLimit.ok &&
    blockedRateLimit.response.status === 429 &&
    blockedRateLimit.response.headers.get("Retry-After") &&
    !blockedRateLimitBody.includes("203.0.113.10"),
  "Public write rate limiting should return 429 with retry headers without exposing raw client IPs."
);
assert(
  retentionDaysFromPayload({ retentionDays: 7 }) === 30 &&
    retentionDaysFromPayload({ retentionDays: 4000 }) === 3650 &&
    retentionCutoffFromPayload({ before: "2026-01-01T00:00:00.000Z" }) === "2026-01-01T00:00:00.000Z",
  "Analytics retention windows should clamp unsafe values and accept explicit ISO cutoffs for operator jobs."
);
const retentionResult = await executeJob(
  {
    id: "job_retention_boundary",
    kind: "analytics_retention",
    status: "running",
    payload: { before: "2026-05-01T00:00:00.000Z", siteId: bundle.businessProfile.siteId },
    attempts: 1,
    maxAttempts: 1,
    runAfter: "2026-05-29T12:00:00.000Z",
    createdAt: "2026-05-29T12:00:00.000Z",
    updatedAt: "2026-05-29T12:00:00.000Z"
  },
  {
    pruneAnalyticsEvents: async (input) => ({
      deleted: input.before === "2026-05-01T00:00:00.000Z" && input.siteId === bundle.businessProfile.siteId ? 2 : 0,
      before: input.before,
      siteId: input.siteId
    })
  }
);
assert(
  retentionResult.deleted === 2 && retentionResult.siteId === bundle.businessProfile.siteId,
  "Analytics retention worker jobs should prune old raw analytics events through the repository boundary."
);
const scheduledJobs: JobRecord[] = [];
const scheduleResult = await scheduleLaunchJobs(
  {
    async listSiteBundles() {
      return [bundle];
    },
    async listJobs() {
      return scheduledJobs;
    },
    async enqueueJob(kind, payload) {
      const job = {
        id: `scheduled_${scheduledJobs.length + 1}`,
        kind,
        status: "queued" as const,
        payload,
        attempts: 0,
        maxAttempts: 3,
        runAfter: typeof payload.runAfter === "string" ? payload.runAfter : "2026-05-29T12:00:00.000Z",
        createdAt: "2026-05-29T12:00:00.000Z",
        updatedAt: "2026-05-29T12:00:00.000Z"
      };
      scheduledJobs.push(job);
      return job;
    }
  },
  {
    task: "launch_maintenance",
    siteIds: [bundle.businessProfile.siteId],
    retentionDays: 395,
    scheduleKey: "boundary-maintenance"
  },
  new Date("2026-05-29T12:00:00.000Z")
);
assert(
  scheduleResult.queued.some((job) => job.kind === "monthly_action_list") &&
    scheduleResult.queued.some((job) => job.kind === "analytics_retention"),
  "Cron scheduler should enqueue monthly action-list and analytics-retention jobs for launch maintenance."
);
const duplicateSchedule = await scheduleLaunchJobs(
  {
    async listSiteBundles() {
      return [bundle];
    },
    async listJobs() {
      return scheduledJobs;
    },
    async enqueueJob(kind, payload) {
      const job = {
        id: `scheduled_${scheduledJobs.length + 1}`,
        kind,
        status: "queued" as const,
        payload,
        attempts: 0,
        maxAttempts: 3,
        runAfter: "2026-05-29T12:00:00.000Z",
        createdAt: "2026-05-29T12:00:00.000Z",
        updatedAt: "2026-05-29T12:00:00.000Z"
      };
      scheduledJobs.push(job);
      return job;
    }
  },
  {
    task: "launch_maintenance",
    siteIds: [bundle.businessProfile.siteId],
    retentionDays: 395,
    scheduleKey: "boundary-maintenance"
  },
  new Date("2026-05-29T12:00:00.000Z")
);
assert(
  duplicateSchedule.queued.length === 0 && duplicateSchedule.skipped.length === 2,
  "Cron scheduler should skip duplicate non-failed jobs with the same schedule key."
);

const publicSiteCache = cachePolicyForPathname("/sites/boundary-verify-hvac");
assert(
  publicSiteCache.kind === "public_site" && publicSiteCache.cacheControl?.includes("s-maxage=300"),
  "Public site HTML should be CDN-cacheable with a bounded shared cache TTL."
);
assert(
  cachePolicyForPathname("/", { customDomain: true }).kind === "public_site",
  "Custom-domain root traffic should receive the public-site cache policy after host-header routing."
);
for (const privatePath of [
  "/",
  "/api/forms/submit",
  "/api/analytics",
  "/api/claim",
  "/auth/login",
  "/preview/demo-token",
  "/editor/boundary-verify-hvac",
  "/editor/boundary-verify-hvac/preview",
  "/analytics/boundary-verify-hvac",
  "/leads/boundary-verify-hvac",
  "/outbound"
]) {
  const policy = cachePolicyForPathname(privatePath);
  assert(policy.kind === "no_store" && policy.cacheControl?.includes("no-store"), `${privatePath} must bypass CDN/browser caches.`);
}
assert(
  cachePolicyForPathname("/api/assets/site/asset.jpg").kind === "public_asset",
  "Stored generated assets should be cacheable as immutable public assets."
);
assert(
  normalizeCustomHostname("HTTPS://WWW.BOUNDARY-VERIFY.EXAMPLE/path") === "www.boundary-verify.example",
  "Custom-domain normalization should strip protocol/path and lowercase hostnames."
);
const railwayDomainStatus = await refreshCustomHostnameStatus({
  provider: "railway",
  hostname: "www.boundary-verify.example",
  verification: {
    type: "cname",
    value: "customers.lodesta.example",
    configured: false,
    note: "Synthetic verifier CNAME."
  }
});
assert(
  railwayDomainStatus.status === "active" && railwayDomainStatus.verification?.configured === true,
  "Railway/manual custom domains should refresh to active after operator DNS setup."
);
const cloudflareMissingConfigStatus = await refreshCustomHostnameStatus({
  provider: "cloudflare_for_saas",
  hostname: "www.boundary-verify.example"
});
assert(
  cloudflareMissingConfigStatus.status === "pending",
  "Cloudflare custom domains without provider credentials or hostname id should remain pending until refreshed against Cloudflare."
);

const outboundCampaign = newOutboundCampaign({ name: "Boundary Verify Direct Mail", status: "running" });
const outboundProspect = newOutboundProspect({
  campaignId: outboundCampaign.id,
  siteId: bundle.businessProfile.siteId,
  businessName: bundle.businessProfile.name,
  vertical: bundle.businessProfile.vertical,
  previewToken: "demo-token"
});
const outboundEvents = [
  newOutboundEvent({ campaignId: outboundCampaign.id, prospectId: outboundProspect.id, type: "mailer_sent" }),
  newOutboundEvent({ campaignId: outboundCampaign.id, prospectId: outboundProspect.id, type: "preview_viewed" }),
  newOutboundEvent({ campaignId: outboundCampaign.id, prospectId: outboundProspect.id, type: "claim_completed" }),
  newOutboundEvent({ campaignId: outboundCampaign.id, prospectId: outboundProspect.id, type: "published" }),
  newOutboundEvent({ campaignId: outboundCampaign.id, prospectId: outboundProspect.id, type: "credibility_feedback", value: 4.5 }),
  newOutboundEvent({ campaignId: outboundCampaign.id, prospectId: outboundProspect.id, type: "support_contact" })
];
for (const event of outboundEvents) applyOutboundEventToProspect(outboundProspect, event);
const outboundSummary = summarizeOutbound([outboundCampaign], [outboundProspect], outboundEvents, outboundCampaign.id);
assert(
  outboundSummary.mailerToClaimRate === 1 &&
    outboundSummary.claimToPublishRate === 1 &&
    outboundSummary.avgCredibilityScore === 4.5 &&
    outboundSummary.supportBurdenRate === 1,
  "Outbound wedge metrics should measure mailer-to-claim, claim-to-publish, preview credibility, and support burden."
);
assert(
  bundle.presenceAssessment.designDirections.filter((direction) => direction.selected).length === 1,
  "Exactly one generated design direction should be selected."
);
assert(bundle.presenceAssessment.brandAssessment, "Generated launch sites should include a brand assessment.");
assert(bundle.presenceAssessment.qualityScore?.generated, "Generated launch sites should include a generated quality score.");
assert(
  bundle.presenceAssessment.qualityScore.measuredCriteria ===
    coldUrlCheckableChecks(bundle.presenceAssessment.standardEvaluation?.checks ?? []).length &&
    bundle.presenceAssessment.qualityScore.coldUrlCheckableFailures.every((title) =>
      coldUrlCheckableChecks(bundle.presenceAssessment.standardEvaluation?.checks ?? []).some((check) => check.title === title)
    ),
  "Outbound-facing quality scores should count and present only cold-URL-checkable current-site criteria."
);
const standardCriterionIds = generatedEvaluation.checks.map((check) => check.criterionId);
assert(
  standardCriterionIds.includes("technical.https") && standardCriterionIds.includes("seo.clean_urls"),
  "The launch Standard should cover HTTPS and clean public URLs."
);
const insecureCrawl = crawlFixture("http://example.com/services.php?ref=ad");
assert(
  insecureCrawl.score.checks.some((check) => check.standardCriterionId === "technical.https" && !check.passed) &&
    insecureCrawl.score.checks.some((check) => check.standardCriterionId === "seo.clean_urls" && !check.passed),
  "Current-site crawl scoring should fail HTTP and messy URL patterns."
);
const cleanHttpsCrawl = crawlFixture("https://example.com/services", "https://example.com/services");
assert(
  cleanHttpsCrawl.score.checks.some((check) => check.standardCriterionId === "technical.https" && check.passed) &&
    cleanHttpsCrawl.score.checks.some((check) => check.standardCriterionId === "seo.clean_urls" && check.passed),
  "Current-site crawl scoring should pass HTTPS and clean URL patterns."
);
assert(bundle.presenceAssessment.visualQa, "Generated launch sites should include visual QA results.");
assert(
  bundle.presenceAssessment.visualQa.source === "deterministic_fallback" &&
    bundle.presenceAssessment.visualQa.findings.some((finding) => finding.id === "visual_qa.direction_alignment"),
  "Visual QA should fall back to deterministic SiteModel/design-direction checks without live screenshot credentials."
);
assert(
  bundle.siteModel.versions[0]?.pages.some((page) => page.slug.startsWith("services/")),
  "Generated launch sites should include service landing pages when services are known."
);
assert(
  bundle.experiments.length > 0 && bundle.experiments.every((experiment) => experiment.status === "draft"),
  "Generated experiments must default to draft so Experiment Mode remains opt-in only."
);
assert(
  ["sticky_cta", "cta_placement", "form_length", "hero_layout"].every((surface) =>
    bundle.experiments.some((experiment) => experiment.surface === surface)
  ),
  "Generated experiment candidates must cover the launch Experiment Mode surfaces."
);

const qaBundle = createSiteFromInput({
  prompt:
    "Build a website for Boundary Verify HVAC, a call-first HVAC company in Austin. services: Emergency HVAC repair, AC maintenance phone: 512-555-0101"
});
const qa = runSiteQa(qaBundle);
assert(qa.passed, "Generated launch sites with phone and location should pass blocking QA guardrails.");

const brokenCtaBundle = structuredClone(qaBundle);
const brokenHero = brokenCtaBundle.siteModel.versions[0]?.pages[0]?.sections.find((section) => section.type === "hero");
if (brokenHero) brokenHero.props.primaryCta = { label: "", href: "" };
const brokenCtaQa = runSiteQa(brokenCtaBundle);
assert(
  brokenCtaQa.checks.some((check) => check.id === "primary_cta_guardrail" && check.severity === "fail") ||
    brokenCtaQa.checks.some((check) => check.id.includes("_primaryCta") && check.severity === "fail"),
  "QA must fail when the primary CTA is removed or blank."
);

const qaHome = qaBundle.siteModel.versions[0]?.pages[0];
const qaHero = qaHome?.sections.find((section) => section.type === "hero");
assert(qaHome && qaHero, "Guardrail verifier needs a generated home hero.");
const brokenLinkBundle = structuredClone(qaBundle);
brokenLinkBundle.siteModel.versions[0]?.pages[0]?.sections.push({
  id: "press_bad_link",
  type: "press_video",
  variant: "links",
  props: { links: [{ label: "Proof link", href: "javascript:alert(1)" }] },
  bindings: {},
  fieldPolicies: {
    links: { editScope: "owner_choice", experimentEligible: false, factField: false }
  }
});
const brokenLinkQa = runSiteQa(brokenLinkBundle);
assert(
  brokenLinkQa.checks.some((check) => check.id.includes("press_bad_link") && check.severity === "fail"),
  "QA must fail unsupported or broken non-CTA links in structured sections."
);
const blockedCtaEdit = validateSectionUpdate(qaBundle, {
  siteId: qaBundle.businessProfile.siteId,
  pageId: qaHome.id,
  sectionId: qaHero.id,
  props: { primaryCta: { label: "", href: "" } }
});
assert(
  !blockedCtaEdit.ok && blockedCtaEdit.issues.some((issue) => issue.checkId === "primary_cta_guardrail"),
  "Editor guardrails must block owner edits that remove the primary CTA."
);
const blockedSensitiveClaim = validateSectionUpdate(qaBundle, {
  siteId: qaBundle.businessProfile.siteId,
  pageId: qaHome.id,
  sectionId: qaHero.id,
  props: { heading: "Austin's guaranteed certified HVAC repair" }
});
assert(
  !blockedSensitiveClaim.ok && blockedSensitiveClaim.issues.some((issue) => issue.id === "unverified_sensitive_claim"),
  "Editor guardrails must block unverified sensitive claims in owner-editable copy."
);
const blockedProfileEdit = validateBusinessProfileUpdate(qaBundle, {
  siteId: qaBundle.businessProfile.siteId,
  phone: ""
});
assert(
  !blockedProfileEdit.ok && blockedProfileEdit.issues.some((issue) => issue.checkId === "phone_path"),
  "Business fact guardrails must block removing the click-to-call path."
);
const structuredDataBundle = structuredClone(qaBundle);
structuredDataBundle.businessProfile.address = {
  street: "100 Congress Ave",
  city: "Austin",
  region: "TX",
  postalCode: "78701",
  country: "US"
};
structuredDataBundle.businessProfile.hours = { Monday: "9:00-17:00" };
structuredDataBundle.businessProfile.reviewsSummary = { rating: 4.8, count: 91, sources: ["google_places"] };
structuredDataBundle.businessProfile.socialLinks = ["https://instagram.example/boundary"];
applyVerifiedFacts(structuredDataBundle.businessProfile, ["name", "phone", "address", "services"]);
const requiredOnlySchema = makeLocalBusinessJsonLd(structuredDataBundle.businessProfile) as Record<string, unknown> | null;
assert(
  requiredOnlySchema?.name === structuredDataBundle.businessProfile.name &&
    requiredOnlySchema.telephone === structuredDataBundle.businessProfile.phone &&
    Boolean(requiredOnlySchema.address) &&
    !("openingHours" in requiredOnlySchema) &&
    !("aggregateRating" in requiredOnlySchema) &&
    !("sameAs" in requiredOnlySchema),
  "LocalBusiness JSON-LD should include verified required facts but omit optional facts until their provenance is owner-verified."
);
applyVerifiedFacts(structuredDataBundle.businessProfile, ["hours", "reviewsSummary", "socialLinks"]);
const fullyVerifiedSchema = makeLocalBusinessJsonLd(structuredDataBundle.businessProfile) as Record<string, unknown> | null;
assert(
  Array.isArray(fullyVerifiedSchema?.openingHours) &&
    Boolean(fullyVerifiedSchema?.aggregateRating) &&
    Array.isArray(fullyVerifiedSchema?.sameAs),
  "LocalBusiness JSON-LD should include optional hours, ratings, and profile links only after those facts are verified."
);
const approvedCtaEdit = validateSectionUpdate(qaBundle, {
  siteId: qaBundle.businessProfile.siteId,
  pageId: qaHome.id,
  sectionId: qaHero.id,
  props: { primaryCta: { label: "Call Now", href: `tel:${qaBundle.businessProfile.phone}`, role: "tel" } }
});
assert(
  approvedCtaEdit.ok,
  "Editor guardrails should allow approved owner-choice CTA changes that preserve conversion paths."
);
const approvedVariantEdit = updateSiteDesignBundle(structuredClone(qaBundle), {
  siteId: qaBundle.businessProfile.siteId,
  pageId: qaHome.id,
  sectionVariants: { [qaHero.id]: "compact" }
});
assert(
  approvedVariantEdit.ok && approvedVariantEdit.applied.sectionVariants?.[qaHero.id] === "compact",
  "Curated editor should allow approved section variant swaps."
);
const blockedVariantEdit = updateSiteDesignBundle(structuredClone(qaBundle), {
  siteId: qaBundle.businessProfile.siteId,
  pageId: qaHome.id,
  sectionVariants: { [qaHero.id]: "arbitrary_custom_layout" }
});
assert(
  !blockedVariantEdit.ok,
  "Curated editor should reject unapproved arbitrary section variants."
);
const formSettingsBundle = structuredClone(qaBundle);
const formSettingsResult = applyFormSettingsUpdate(formSettingsBundle, {
  siteId: formSettingsBundle.businessProfile.siteId,
  formId: formSettingsBundle.extensionModel.forms[0]?.id ?? "form_contact",
  name: "Launch inquiry",
  submitLabel: "Send inquiry",
  notificationEmail: "owner@example.com",
  fields: [
    { id: "name", label: "Name", type: "text", required: true },
    { id: "email", label: "Email", type: "email", required: true },
    { id: "project", label: "Project details", type: "textarea", required: false }
  ]
});
assert(
  formSettingsResult.ok &&
    formSettingsResult.form.submitLabel === "Send inquiry" &&
    formSettingsResult.workflows.some((workflow) => workflow.destination === "email" && workflow.config.to === "owner@example.com"),
  "Owners should be able to configure launch form fields and notification targets."
);
if (!formSettingsResult.ok) {
  throw new Error("Form settings verifier requires a valid form result.");
}
const missingRequiredSubmission = validateFormSubmission(formSettingsResult.form, { name: "Boundary Owner" });
assert(
  !missingRequiredSubmission.ok && missingRequiredSubmission.missingFields.includes("email"),
  "Form submission validation should reject claimed lead submissions missing required configured fields."
);
const invalidEmailSubmission = validateFormSubmission(formSettingsResult.form, {
  name: "Boundary Owner",
  email: "not-an-email",
  project: "Replace old HVAC system"
});
assert(
  !invalidEmailSubmission.ok && invalidEmailSubmission.invalidFields.some((field) => field.id === "email"),
  "Form submission validation should reject invalid configured email fields."
);
const sanitizedSubmission = validateFormSubmission(formSettingsResult.form, {
  name: "Boundary Owner",
  email: "owner@example.com",
  project: "Replace old HVAC system",
  password: "do not store"
});
assert(
  sanitizedSubmission.ok &&
    sanitizedSubmission.payload.name === "Boundary Owner" &&
    !("password" in sanitizedSubmission.payload) &&
    sanitizedSubmission.ignoredFields.includes("password"),
  "Form submission validation should persist only configured managed form fields."
);
const blockedSensitiveForm = applyFormSettingsUpdate(structuredClone(qaBundle), {
  siteId: qaBundle.businessProfile.siteId,
  formId: qaBundle.extensionModel.forms[0]?.id ?? "form_contact",
  fields: [
    { id: "name", label: "Name", type: "text", required: true },
    { id: "ssn", label: "Social security number", type: "text", required: true },
    { id: "email", label: "Email", type: "email", required: true }
  ]
});
assert(
  !blockedSensitiveForm.ok,
  "Managed launch forms should reject sensitive credential, government ID, payment, token, or secret fields."
);
const ownerAssetBundle = createSiteFromInput({
  prompt: "Build a website for Boundary Verify Salon, a beauty salon in Austin. phone: 512-555-0141"
});
const ownerAssets = applyOwnerAssetsUpdate(ownerAssetBundle, {
  siteId: ownerAssetBundle.businessProfile.siteId,
  rightsAccepted: true,
  logo: { url: "https://assets.example/boundary-logo.png", alt: "Boundary Verify Salon logo" },
  photos: [
    { url: "https://assets.example/boundary-style.jpg", alt: "Salon styling" },
    { url: "https://assets.example/boundary-color.webp", alt: "Hair color service" }
  ]
});
assert(
  ownerAssets.ok &&
    ownerAssets.logo?.rightsStatus === "customer_granted" &&
    ownerAssets.assets.every((asset) => asset.ownerApproved && asset.usageScope === "published_site") &&
    ownerAssetBundle.siteModel.versions.some((version) =>
      version.pages.some((page) =>
        page.sections.some(
          (section) => section.type === "gallery" && JSON.stringify(section.props.images).includes("boundary-style.jpg")
        )
      )
    ),
  "Owner-approved photos and logos should become customer-granted published-site assets and feed gallery sections."
);
const blockedOwnerAssets = applyOwnerAssetsUpdate(structuredClone(qaBundle), {
  siteId: qaBundle.businessProfile.siteId,
  rightsAccepted: false,
  photos: [{ url: "https://assets.example/no-rights.jpg", alt: "No rights" }]
});
assert(
  !blockedOwnerAssets.ok,
  "Owner assets must require explicit rights confirmation before becoming published-site content."
);
const referenceOnlyAssetBundle = structuredClone(qaBundle);
const referenceOnlyUrl = "https://customer.example/original-job-photo.jpg";
referenceOnlyAssetBundle.presenceAssessment.assetInventory = [
  ...(referenceOnlyAssetBundle.presenceAssessment.assetInventory ?? []),
  {
    id: "site_asset_reference_probe",
    siteId: referenceOnlyAssetBundle.businessProfile.siteId,
    kind: "photo",
    url: referenceOnlyUrl,
    alt: "Reference-only original photo",
    source: "website_reference",
    rightsStatus: "reference_only",
    usageScope: "reference_only",
    ownerApproved: false,
    metadata: { preclaimUse: "reference_only" },
    createdAt: new Date().toISOString()
  }
];
const referenceOnlyHero = referenceOnlyAssetBundle.siteModel.versions[0]?.pages[0]?.sections.find(
  (section) => section.type === "hero"
);
if (referenceOnlyHero) referenceOnlyHero.props.imageUrl = referenceOnlyUrl;
assert(
  runSiteQa(referenceOnlyAssetBundle).checks.some(
    (check) => check.id === "preclaim_reference_asset_usage" && check.severity === "fail"
  ),
  "QA must fail if reference-only scraped assets are inserted into rendered site sections."
);
referenceOnlyAssetBundle.presenceAssessment.assetInventory.push({
  id: "site_asset_owner_granted_probe",
  siteId: referenceOnlyAssetBundle.businessProfile.siteId,
  kind: "photo",
  url: referenceOnlyUrl,
  alt: "Owner-approved original photo",
  source: "uploaded",
  rightsStatus: "customer_granted",
  usageScope: "published_site",
  ownerApproved: true,
  provenance: {
    source: "owner",
    confidence: 1,
    verified: true,
    observedAt: new Date().toISOString()
  },
  metadata: { ownerGranted: true },
  createdAt: new Date().toISOString()
});
assert(
  runSiteQa(referenceOnlyAssetBundle).checks.some(
    (check) => check.id === "preclaim_reference_asset_usage" && check.severity === "pass"
  ),
  "Owner-granted assets should be allowed after explicit rights approval even when they match a prior reference URL."
);

const badContrastBundle = structuredClone(qaBundle);
badContrastBundle.siteModel.theme.colors.primary = "#ffffff";
badContrastBundle.siteModel.theme.colors.primaryText = "#ffffff";
const badContrastQa = runSiteQa(badContrastBundle);
assert(
  badContrastQa.checks.some((check) => check.id === "theme_primary_button_contrast" && check.severity === "fail"),
  "QA must fail inaccessible primary button colors."
);

const aiPlannedBundle = createSiteFromInput({
  prompt: "Build a website for AI Planned Dental in Austin. phone: 512-555-0123",
  aiPlanning: {
    source: "openai",
    selectedStrategy: "premium_redesign",
    qualitySummary: "Model-backed planning selected the premium clinical path.",
    brandAssessment: {
      confidence: 0.88,
      cues: ["AI Planned Dental", "new patient clarity"],
      sourceNotes: ["Structured output override applied in verifier."]
    }
  }
});
assert(
  aiPlannedBundle.presenceAssessment.generationPlanningSource === "openai",
  "AI planning source should be persisted when a model-backed planning override is used."
);
assert(
  aiPlannedBundle.presenceAssessment.designDirections?.find((direction) => direction.strategy === "premium_redesign")?.selected,
  "AI selected strategy should control the selected design direction."
);
assert(
  aiPlannedBundle.presenceAssessment.brandAssessment?.cues.includes("AI Planned Dental"),
  "AI brand assessment cues should be merged into the presence assessment."
);

const publicPresenceObservedAt = new Date().toISOString();
const publicPresenceBundle = createSiteFromInput({
  prompt: "Build a website for Places Verify Salon, a beauty salon in Austin. phone: 512-555-0177",
  publicPresence: {
    provider: "google_places",
    observedAt: publicPresenceObservedAt,
    signals: [
      {
        id: "presence_google_places_places_verify",
        siteId: "site_pending",
        provider: "google_places",
        source: "places_api",
        sourceUrl: "https://maps.google.com/?cid=123",
        placeId: "places/places-verify",
        confidence: 0.86,
        observedAt: publicPresenceObservedAt,
        fields: {
          name: "Places Verify Salon",
          rating: 4.8,
          userRatingCount: 91,
          categories: ["beauty salon"],
          googleMapsUri: "https://maps.google.com/?cid=123"
        },
        provenance: {
          reviewsSummary: {
            source: "places_api",
            sourceUrl: "https://maps.google.com/?cid=123",
            confidence: 0.86,
            verified: false,
            observedAt: publicPresenceObservedAt
          }
        },
        notes: ["Synthetic public presence fixture."]
      }
    ],
    facts: {
      reviewsSummary: {
        rating: 4.8,
        count: 91,
        sources: ["google_places"]
      },
      categories: ["beauty salon"]
    },
    provenance: {
      reviewsSummary: {
        source: "places_api",
        sourceUrl: "https://maps.google.com/?cid=123",
        confidence: 0.86,
        verified: false,
        observedAt: publicPresenceObservedAt
      }
    },
    notes: ["Synthetic public presence fixture."]
  }
});
assert(
  publicPresenceBundle.businessProfile.reviewsSummary?.sources.includes("google_places"),
  "Public presence enrichment should merge ratings/count summaries into the business profile."
);
assert(
  publicPresenceBundle.businessProfile.provenance.reviewsSummary?.source === "places_api",
  "Public presence facts must retain places_api provenance."
);
assert(
  publicPresenceBundle.presenceAssessment.publicPresenceSignals?.[0]?.siteId === publicPresenceBundle.businessProfile.siteId,
  "Public presence signals should be assigned to the generated site id."
);

const renderFixture = encodeURIComponent(
  "<html><body><section data-section-id=\"hero\"><a class=\"button\" href=\"tel:+15551234567\">Call</a><form></form><p>Enough rendered text for the fallback render inspection to count this page as meaningful content with a real action.</p></section></body></html>"
);
const renderRuntime = await getRenderInspectionRuntimeStatus({ launch: false });
assert(
  renderRuntime.packageInstalled && renderRuntime.provider === "playwright",
  "Playwright package should be installed so deployed workers can launch Chromium after browser installation."
);
const renderInspection = await inspectUrlRender({
  url: `data:text/html,${renderFixture}`,
  captureScreenshots: false
});
assert(
  renderInspection.findings.some((finding) => finding.id === "render.primary_cta" && finding.severity === "pass"),
  "Render inspection should detect CTA-like actions."
);
assert(
  renderInspection.findings.some((finding) => finding.id === "render.form" && finding.severity === "pass"),
  "Render inspection should detect rendered forms."
);
const renderQaBundle = createSiteFromInput({
  prompt: "Build a website for Render QA HVAC, a call-first HVAC company in Austin. phone: 512-555-0124",
  renderInspection
});
assert(
  renderQaBundle.presenceAssessment.visualQa?.target === "source_site" &&
    renderQaBundle.presenceAssessment.visualQa.findings.some((finding) => finding.id === "visual_qa.cta_clarity" && finding.severity === "pass"),
  "Visual QA should consume render inspection metrics when they are available."
);

const actionListBundle = createSiteFromInput({
  prompt: "Build a website for Action List Verify Plumbing in Austin. phone: 512-555-0188"
});
const actionListHome = actionListBundle.siteModel.versions[0]?.pages[0];
assert(actionListHome, "Action-list verifier needs a generated home page.");
const actionListFinding: OptimizationFinding = {
  id: "verify_action_list_metadata",
  siteId: actionListBundle.businessProfile.siteId,
  category: "seo",
  severity: "recommended",
  title: "Verify action-list draft staging",
  rationale: "Synthetic verifier finding for publish-confirmation workflow.",
  recommendedAction: "Update metadata in a draft.",
  status: "open",
  applyMode: "one_click",
  expectedOutcomeMetric: "engaged_sessions",
  suggestedEditPayload: {
    action: "update_page_metadata",
    pageId: actionListHome.id,
    title: `${actionListBundle.businessProfile.name} | Verified Draft Metadata`,
    description:
      "This synthetic action-list edit verifies that one-click recommendations stage a draft before explicit publish confirmation."
  }
};
const actionListApply = applySuggestedEdit(actionListBundle, actionListFinding);
assert(actionListApply.ok, "Action-list suggested edits should apply to a draft.");
assert(
  actionListBundle.siteModel.versions.some((version) => version.status === "published") &&
    actionListBundle.siteModel.versions.some((version) => version.status === "draft"),
  "Action-list applies should stage a draft while leaving the published version unchanged until explicit confirmation."
);
assert(
  runSiteQa(actionListBundle, { versionStatus: "draft" }).checks.length > 0,
  "Action-list applies should leave a draft that can be QA-checked before publish confirmation."
);
assert(
  preserveFindingLifecycle([{ ...actionListFinding, status: "open" }], [{ ...actionListFinding, status: "dismissed" }])[0]
    ?.status === "dismissed",
  "Dismissed action-list findings should preserve their lifecycle status across future audit refreshes."
);

const experiment = bundle.experiments.find((candidate) => candidate.surface === "sticky_cta") ?? bundle.experiments[0];
assert(experiment, "Generated sites should include an experiment candidate.");
const learningResult = createExperimentLearning({
  siteId: bundle.businessProfile.siteId,
  experiment,
  analysis: {
    experimentId: experiment.id,
    hypothesis: experiment.hypothesis,
    status: "leader_detected",
    primaryMetric: experiment.primaryMetric,
    totalAssignments: 40,
    controlVariantId: "control",
    leaderVariantId: "sticky_action",
    leaderLabel: "Sticky mobile action",
    confidence: "directional",
    variants: [
      {
        variantId: "control",
        label: "Inline CTAs only",
        sessions: 20,
        assignments: 20,
        metricActions: 2,
        allPrimaryActions: 2,
        actionRate: 0.1,
        liftVsControl: 0,
        avgEngagedSeconds: 18
      },
      {
        variantId: "sticky_action",
        label: "Sticky mobile action",
        sessions: 20,
        assignments: 20,
        metricActions: 6,
        allPrimaryActions: 6,
        actionRate: 0.3,
        liftVsControl: 2,
        avgEngagedSeconds: 22
      }
    ]
  }
});
assert(learningResult.ok, "Directional experiment winners should produce active learnings.");
const learnedBundle = createSiteFromInput({
  prompt: "Build a website for Learned Defaults HVAC in Austin. phone: 512-555-0199",
  experimentLearnings: [learningResult.learning]
});
assert(
  learnedBundle.experiments
    .find((candidate) => candidate.surface === "sticky_cta")
    ?.variants.some((variant) => variant.id === "sticky_action" && variant.learnedDefault === true),
  "Active experiment learnings should mark matching future generation defaults."
);

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      siteId: bundle.businessProfile.siteId,
      generatedScore: generatedEvaluation.score,
      pages: bundle.siteModel.versions[0]?.pages.length ?? 0,
      designDirections: bundle.presenceAssessment.designDirections.length,
      mockupArtifacts: mockupArtifacts.length,
      assetInventory: assetInventory.length,
      visualQaFindings: bundle.presenceAssessment.visualQa.findings.length,
      outboundMailerToClaimRate: outboundSummary.mailerToClaimRate,
      actionListDraftStaged: true,
      experimentLearningApplied: true,
      qaChecks: qa.checks.length,
      renderInspectionAdapter: renderInspection.adapter
    },
    null,
    2
  )}\n`
);

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function setEnv(key: string, value: string) {
  (process.env as Record<string, string | undefined>)[key] = value;
}

function restoreEnv(key: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  setEnv(key, value);
}

function crawlFixture(url: string, canonical?: string): CrawlAssessment {
  const assessment: CrawlAssessment = {
    url,
    fetched: true,
    status: 200,
    finalUrl: url,
    title: "Boundary Verify fixture page title",
    metaDescription:
      "Boundary Verify fixture meta description with enough local-service context for launch scoring.",
    canonical,
    hasViewportMeta: true,
    hasLocalBusinessSchema: true,
    hasTelLink: true,
    robotsFound: true,
    sitemapFound: true,
    formCount: 1,
    imageCount: 0,
    imagesWithoutAlt: 0,
    internalLinkCount: 1,
    externalLinkCount: 0,
    jsonLdTypes: ["LocalBusiness"],
    extractedFacts: {
      categories: [],
      services: [],
      serviceAreas: [],
      socialLinks: [],
      bookingLinks: [],
      orderingLinks: [],
      pressLinks: []
    },
    assetReferences: [],
    sampledInternalPages: [],
    score: {
      overall: 0,
      max: 0,
      percent: 0,
      grade: "poor",
      checks: []
    },
    findings: []
  };
  return {
    ...assessment,
    score: scoreCrawlAssessment(assessment)
  };
}
