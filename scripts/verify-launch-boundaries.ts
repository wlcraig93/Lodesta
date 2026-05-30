import "./load-env";

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import platformRobots from "../app/robots";
import type { AnalyticsEvent, ClaimRecord, JobRecord, LeadSubmission, OptimizationFinding } from "../lib/models";
import { summarizeAnalytics } from "../lib/analytics";
import { readLocalAsset, storeAssetBytes, storeGeneratedAssetBytes } from "../lib/asset-storage";
import { cachePolicyForPathname } from "../lib/cache-policy";
import { extractCrawlPageSignals, scoreCrawlAssessment, summarizeCrawlHtml, type CrawlAssessment } from "../lib/crawler";
import { crawlFixtureHtml, crawlFixturePath } from "../lib/crawl-fixture";
import { isResolvableCustomDomain, normalizeCustomHostname, refreshCustomHostnameStatus } from "../lib/domains";
import { createExperimentLearning } from "../lib/experiment-learning";
import { validateBusinessProfileUpdate, validateSectionUpdate } from "../lib/editor-guardrails";
import { applyBusinessProfileUpdate } from "../lib/business-profile-update";
import { applyFormSettingsUpdate } from "../lib/form-settings";
import { validateFormSubmission } from "../lib/form-validation";
import { executeFormSubmissionWorkflows } from "../lib/workflows";
import { createSiteFromInput } from "../lib/intake";
import { filterSiteBundlesForOwner } from "../lib/page-access";
import { requireAdmin, requireAdminOrSiteOwner } from "../lib/security";
import { isAdminUserId } from "../lib/auth-policy";
import { applyOwnerAssetsUpdate } from "../lib/owner-assets";
import { updateSiteDesignBundle } from "../lib/design";
import { applySuggestedEdit, preserveFindingLifecycle } from "../lib/optimization";
import { recommendFromAnalytics } from "../lib/analytics-insights";
import {
  assertOutboundCompliance,
  newOutboundCampaign,
  newOutboundEvent,
  newOutboundProspect,
  applyOutboundEventToProspect,
  buildOutboundMailerManifest,
  outboundMailerManifestCsv,
  summarizeOutbound
} from "../lib/outbound";
import { hashIpAddress, sanitizeAnalyticsMetadata, sanitizeAttributionUrl } from "../lib/privacy";
import { rateLimit, rateLimitKey } from "../lib/rate-limit";
import { getRenderInspectionRuntimeStatus, inspectUrlRender } from "../lib/render-inspection";
import { runAudit } from "../lib/audit";
import { executeJob } from "../lib/jobs";
import { scheduleLaunchJobs } from "../lib/job-scheduler";
import { validateLaunchMarket } from "../lib/launch-market";
import { runSiteQa } from "../lib/qa";
import { getHealthReport } from "../lib/health";
import {
  OPENAI_IMAGE_OUTPUT_FORMAT,
  OPENAI_RUNTIME_DEFAULTS,
  StaleOperatorSettingsError,
  getOpenAiRuntimeSettings,
  resetOpenAiRuntimeSettingsCacheForTests,
  saveOpenAiRuntimeSettings,
  setOperatorSettingsLocalFileForTests,
  validateOpenAiImageSize,
  validateOpenAiRuntimeSettingsInput
} from "../lib/operator-settings";
import { resolveClaimOwner } from "../lib/claim-ownership";
import { isPublicLocalAssetPath } from "../lib/public-assets";
import { canonicalUrlForPage, siteRobotsTxt, siteSitemapXml } from "../lib/public-site-seo";
import { markdownCanonicalLinkHeader, markdownForPage, markdownUrlForPage, siteLlmsTxt } from "../lib/public-site-markdown";
import { customDomainRoutedHeader, requestHostname, requestOrigin } from "../lib/host-routing";
import { getPublishedVersion } from "../lib/sample-data";
import { coldUrlCheckableChecks, evaluateSiteAgainstStandard } from "../lib/standard-evaluation";
import { applyVerifiedFacts, requiredClaimFactIds } from "../lib/fact-verification";
import { claimGateForBundle, isIndexableSite } from "../lib/site-publication";
import { makeLocalBusinessJsonLd, serializeJsonLd } from "../lib/structured-data";
import { restoreVersionToDraftBundle } from "../lib/site-versions";
import {
  completeClaimCheckout as completeLocalClaimCheckout,
  createAndStoreSite as createLocalStoreSite,
  createPreviewToken as createLocalPreviewToken,
  createClaim as createLocalClaim,
  recordClaimCheckoutSession,
  resolvePreviewToken as resolveLocalPreviewToken
} from "../lib/store";
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
const checkoutOnlyBundle = createSiteFromInput({
  prompt: "Build a website for Boundary Checkout HVAC, a call-first HVAC company in Austin."
});
const checkoutOnlyClaim: ClaimRecord = {
  ...checkoutRequiredClaim,
  id: "claim_checkout_only",
  siteId: checkoutOnlyBundle.businessProfile.siteId
};
const expiringPreviewBundle = createLocalStoreSite({
  prompt: "Build a website for Boundary Expiring Preview HVAC in Austin. phone: 512-555-0132"
});
const expiredPreviewToken = createLocalPreviewToken({
  siteId: expiringPreviewBundle.businessProfile.siteId,
  expiresAt: new Date(Date.now() - 1000 * 60).toISOString()
});
assert(expiredPreviewToken, "Expired preview-token verifier should create a local token.");
assert(
  resolveLocalPreviewToken(expiredPreviewToken.token) === null,
  "Expired preview tokens must not resolve to private pre-claim pages."
);

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
const unauthenticatedClaimOwner = resolveClaimOwner({ requestedOwnerEmail: "Owner@Example.com" });
assert(
  unauthenticatedClaimOwner.ok && unauthenticatedClaimOwner.ownerEmail === "owner@example.com",
  "Unauthenticated claim requests should require and normalize the submitted owner email."
);
assert(
  resolveClaimOwner({
    authUser: { id: "user_claim_owner", email: "Signed-In@Example.com" },
    requestedOwnerEmail: "signed-in@example.com"
  }).ok,
  "Authenticated claim requests may include the same owner email as the signed-in Supabase user."
);
const checkoutGuardBundle = createLocalStoreSite({
  prompt: "Build a website for Boundary Checkout Guard HVAC in Austin. phone: 512-555-0199"
});
const checkoutGuardClaim = createLocalClaim({
  siteId: checkoutGuardBundle.businessProfile.siteId,
  ownerEmail: "checkout-guard@example.com",
  verifiedFacts: requiredClaimFactIds(checkoutGuardBundle.businessProfile),
  acceptedTerms: true,
  acceptedManagement: true
});
assert(checkoutGuardClaim, "Checkout guard verifier should create a local claim.");
recordClaimCheckoutSession(checkoutGuardClaim.id, "cs_boundary_expected");
const duplicateSessionClaim = createLocalClaim({
  siteId: checkoutGuardBundle.businessProfile.siteId,
  ownerEmail: "checkout-guard-duplicate@example.com",
  verifiedFacts: requiredClaimFactIds(checkoutGuardBundle.businessProfile),
  acceptedTerms: true,
  acceptedManagement: true
});
assert(duplicateSessionClaim, "Checkout guard verifier should create a duplicate-session probe claim.");
assert(
  recordClaimCheckoutSession(duplicateSessionClaim.id, "cs_boundary_expected") === null,
  "Stored Stripe checkout session ids should be unique across local claims."
);
assert(
  completeLocalClaimCheckout({ claimId: checkoutGuardClaim.id, checkoutSessionId: "cs_boundary_wrong" }) === null,
  "Claim checkout completion should reject mismatched stored Stripe checkout sessions."
);
assert(
  completeLocalClaimCheckout({
    claimId: checkoutGuardClaim.id,
    siteId: "site_other_checkout_guard",
    checkoutSessionId: "cs_boundary_expected"
  }) === null,
  "Claim checkout completion should reject Stripe checkout events whose site metadata targets a different site."
);
assert(
  completeLocalClaimCheckout({
    claimId: checkoutGuardClaim.id,
    siteId: checkoutGuardBundle.businessProfile.siteId,
    checkoutSessionId: "cs_boundary_expected",
    stripeCustomerId: "cus_boundary_expected",
    stripeSubscriptionId: "sub_boundary_expected"
  })?.status === "claimed",
  "Claim checkout completion should accept the matching stored Stripe checkout session."
);
assert(
  !resolveClaimOwner({
    authUser: { id: "user_claim_owner", email: "signed-in@example.com" },
    requestedOwnerEmail: "other-owner@example.com"
  }).ok,
  "Authenticated claim requests must not bind completed owner access to a different submitted email."
);
assert(
  filterSiteBundlesForOwner({
    bundles: [bundle, checkoutOnlyBundle],
    claims: [claimedClaim, checkoutOnlyClaim],
    authConfigured: true,
    userEmail: "owner@example.com"
  }).map((visibleBundle) => visibleBundle.businessProfile.siteId).join(",") === bundle.businessProfile.siteId,
  "Owner dashboards should list only completed claimed sites, not checkout-required previews."
);
const platformRobotsRules = platformRobots().rules;
const rootHomePage = readFileSync("app/page.tsx", "utf8");
const dashboardPage = readFileSync("app/dashboard/page.tsx", "utf8");
const experimentLearningRoute = readFileSync("app/api/experiments/learn/route.ts", "utf8");
const crawlFixtureRouteSource = readFileSync("app/crawl-fixtures/[token]/[page]/route.ts", "utf8");
const middlewareSource = readFileSync("middleware.ts", "utf8");
const hostRoutingSource = readFileSync("lib/host-routing.ts", "utf8");
const securitySource = readFileSync("lib/security.ts", "utf8");
const domainRouteSource = readFileSync("app/api/domains/route.ts", "utf8");
const platformRobotsDisallow = new Set(
  (Array.isArray(platformRobotsRules) ? platformRobotsRules : [platformRobotsRules]).flatMap((rule) =>
    Array.isArray(rule.disallow) ? rule.disallow : rule.disallow ? [rule.disallow] : []
  )
);
const supabaseSchema = readFileSync("supabase/schema.sql", "utf8");
assert(
  supabaseSchema.includes("Job lock expired after all retry attempts.") &&
    supabaseSchema.includes("and attempts >= max_attempts") &&
    supabaseSchema.indexOf("and attempts >= max_attempts") < supabaseSchema.indexOf("return query"),
  "Supabase workers should fail stale max-attempt running jobs before claiming the next queued job."
);
assert(
  rootHomePage.includes("Lodesta powers your business") && !rootHomePage.includes("requireAdminPageAccess"),
  "The root page should be a public Lodesta marketing homepage instead of the private operator dashboard."
);
assert(
  dashboardPage.includes("requireAdminPageAccess(\"/dashboard\")") && !dashboardPage.includes("requireOwnerAccess(\"/\")"),
  "The operator dashboard should use the admin page access policy, not owner dashboard access."
);
assert(
  dashboardPage.includes("index: false") && dashboardPage.includes("follow: false"),
  "The operator dashboard should emit noindex/nofollow metadata."
);
assert(
  experimentLearningRoute.includes("siteId ? await requireAdminOrSiteOwner(request, siteId) : await requireAdmin(request)"),
  "Unscoped experiment-learning reads should require admin authorization instead of exposing cross-site learnings."
);
assert(
  crawlFixtureRouteSource.includes("LODESTA_CRAWL_FIXTURE_TOKEN") &&
    crawlFixtureRouteSource.includes('"X-Robots-Tag"') &&
    crawlFixtureRouteSource.includes("noindex, nofollow") &&
    crawlFixtureRouteSource.includes("no-store"),
  "Crawler fixture route should require a token and emit noindex/no-store headers."
);
assert(
  securitySource.includes("isAdminUserId(auth.user?.id)") &&
    securitySource.includes("export async function requireAdmin") &&
    securitySource.includes("export async function requireAdminOrSiteOwner"),
  "Admin APIs should authorize Supabase-authenticated admin user ids as well as bearer-token CLI access."
);
assert(
  domainRouteSource.includes("manualCustomDomainsAllowed()") &&
    domainRouteSource.includes("LODESTA_ALLOW_MANUAL_CUSTOM_DOMAINS") &&
    domainRouteSource.includes('parsed.data.provider === "railway"'),
  "Deployed custom-domain registration should require Cloudflare for SaaS unless a manual-domain exception is explicit."
);
for (const privatePath of [
  "/api/",
  "/auth/",
  "/account",
  "/crawl-fixtures/",
  "/preview/",
  "/editor/",
  "/analytics/",
  "/optimization/",
  "/experiments/",
  "/business/",
  "/leads/",
  "/versions/",
  "/claim/",
  "/domains/",
  "/outbound",
  "/dashboard"
]) {
  assert(platformRobotsDisallow.has(privatePath), `Platform robots.txt should disallow private/admin path ${privatePath}.`);
  if (privatePath !== "/" && privatePath !== "/api/" && privatePath !== "/auth/") {
    assert(
      middlewareSource.includes(`"${privatePath}"`),
      `Middleware should not rewrite private/admin path ${privatePath} through custom-domain public-site routing.`
    );
  }
}
for (const [routePath, parseMarker] of [
  ["app/api/forms/submit/route.ts", "parseSubmissionRequest(request)"],
  ["app/api/analytics/route.ts", "analyticsEventSchema.safeParse(body)"],
  ["app/api/experiments/assign/route.ts", "assignmentSchema.safeParse(body)"],
  ["app/api/claim/route.ts", "claimSchema.safeParse(body)"],
  ["app/api/intake/route.ts", "intakeSchema.safeParse(body)"],
  ["app/api/presence/assess/route.ts", "presenceSchema.safeParse(body)"],
  ["app/api/assets/owner/route.ts", "parseOwnerAssetsRequest(request)"],
  ["app/api/stripe/webhook/route.ts", "request.text()"]
] as const) {
  assertRateLimitBeforeParse(routePath, parseMarker);
}
for (const [command, markers] of [
  ["create-site-from-url", ['post("/api/intake"', "url: args[0]"]],
  ["import-batch", ['post("/api/jobs"', 'kind: "import_batch"', 'post("/api/jobs/process"']],
  ["run-presence", ['post("/api/presence/assess"']],
  ["run-audit", ['post("/api/audits/run"']],
  ["run-qa", ['post("/api/qa/run"']],
  ["create-preview", ['post("/api/preview-tokens"']],
  ["publish", ['post("/api/sites/publish"', "confirmed: true"]],
  ["apply-safe-findings", ['post("/api/action-list/apply-all"']],
  ["inspect-leads", ["get(`/api/leads"]],
  ["connect-domain", ['post("/api/domains"', 'provider: "cloudflare_for_saas"']],
  ["monthly-action-list", ['post("/api/jobs"', 'kind: "monthly_action_list"', 'post("/api/jobs/process"']],
  ["process-jobs", ['post("/api/jobs/process"']]
] as const) {
  assertCliCommand(command, markers);
}
assertCliTransportUsesHttpApis();

const authEnvSnapshot = {
  nodeEnv: process.env.NODE_ENV,
  requireAuth: process.env.LODESTA_REQUIRE_AUTH,
  appUrl: process.env.NEXT_PUBLIC_APP_URL,
  adminToken: process.env.LODESTA_ADMIN_TOKEN,
  adminUserId: process.env.LODESTA_ADMIN_USER_ID,
  hashSecret: process.env.LODESTA_HASH_SECRET,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  nextSupabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  nextSupabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
};
try {
  setEnv("NODE_ENV", "development");
  delete process.env.LODESTA_REQUIRE_AUTH;
  delete process.env.LODESTA_ADMIN_TOKEN;
  assert(
    (await requireAdmin(new Request("https://app.example/api/intake"))) === null,
    "Local development may bypass admin auth when no token is configured."
  );
  assert(
    (await requireAdminOrSiteOwner(new Request("https://app.example/api/sites/publish"), bundle.businessProfile.siteId)) === null,
    "Local development may bypass owner auth when no token is configured."
  );

  process.env.LODESTA_REQUIRE_AUTH = "true";
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const forcedAdminAuth = await requireAdmin(new Request("https://app.example/api/intake"));
  assert(forcedAdminAuth?.status === 401, "Admin routes must reject unauthenticated requests when auth enforcement is enabled.");
  const forcedOwnerAuth = await requireAdminOrSiteOwner(
    new Request("https://app.example/api/sites/publish"),
    bundle.businessProfile.siteId
  );
  assert(forcedOwnerAuth?.status === 401, "Owner routes must reject unauthenticated requests when auth enforcement is enabled.");

  setEnv("NODE_ENV", "production");
  delete process.env.LODESTA_REQUIRE_AUTH;
  const productionAdminAuth = await requireAdmin(new Request("https://app.example/api/intake"));
  assert(productionAdminAuth?.status === 401, "Production admin routes must fail closed without LODESTA_ADMIN_TOKEN.");

  process.env.LODESTA_ADMIN_TOKEN = "boundary-secret";
  assert(
    (await requireAdmin(new Request("https://app.example/api/intake", { headers: { authorization: "Bearer boundary-secret" } }))) === null,
    "Admin bearer token should authorize operator-only routes."
  );
  assert(
    (await requireAdminOrSiteOwner(
      new Request("https://app.example/api/sites/publish", { headers: { authorization: "Bearer boundary-secret" } }),
      bundle.businessProfile.siteId
    )) === null,
    "Admin bearer token should authorize owner/admin site APIs."
  );
  assert(
    (await requireAdmin(new Request("https://app.example/api/intake", { headers: { authorization: "Bearer wrong" } })))?.status === 401,
    "Invalid admin bearer token should be rejected."
  );
  assert(
    (await requireAdminOrSiteOwner(
      new Request("https://app.example/api/sites/publish", { headers: { authorization: "Bearer wrong" } }),
      bundle.businessProfile.siteId
    ))?.status === 401,
    "Invalid admin bearer token should not authorize owner/admin site APIs."
  );

  process.env.LODESTA_ADMIN_USER_ID = "admin-user-id";
  assert(isAdminUserId("admin-user-id"), "Admin page policy should match the configured Supabase admin user id.");
  assert(!isAdminUserId("owner-user-id"), "Admin page policy should reject Supabase user ids outside the admin setting.");

  delete process.env.NEXT_PUBLIC_APP_URL;
  delete process.env.LODESTA_HASH_SECRET;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const productionHealth = await getHealthReport();
  assert(
    healthCheckState(productionHealth, "repository") === "error",
    "Production health must fail closed when Supabase repository credentials are missing."
  );
  assert(
    healthCheckState(productionHealth, "app_url") === "error",
    "Production health must require NEXT_PUBLIC_APP_URL."
  );
  assert(
    healthCheckState(productionHealth, "supabase_auth") === "error",
    "Production health must require public Supabase Auth environment."
  );
  assert(
    healthCheckState(productionHealth, "hash_secret") === "error",
    "Production health must require LODESTA_HASH_SECRET."
  );

  process.env.NEXT_PUBLIC_APP_URL = "https://app.example";
  process.env.LODESTA_HASH_SECRET = "boundary-health-hash-secret";
  process.env.SUPABASE_URL = "https://supabase.example";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://supabase.example";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon";
  const configuredHealth = await getHealthReport();
  assert(healthCheckState(configuredHealth, "repository") === "ok", "Configured Supabase repository health should pass.");
  assert(healthCheckState(configuredHealth, "app_url") === "ok", "Configured application URL health should pass.");
  assert(healthCheckState(configuredHealth, "supabase_auth") === "ok", "Configured Supabase Auth health should pass.");
  assert(healthCheckState(configuredHealth, "hash_secret") === "ok", "Configured hash secret health should pass.");
} finally {
  restoreEnv("NODE_ENV", authEnvSnapshot.nodeEnv);
  restoreEnv("LODESTA_REQUIRE_AUTH", authEnvSnapshot.requireAuth);
  restoreEnv("NEXT_PUBLIC_APP_URL", authEnvSnapshot.appUrl);
  restoreEnv("LODESTA_ADMIN_TOKEN", authEnvSnapshot.adminToken);
  restoreEnv("LODESTA_ADMIN_USER_ID", authEnvSnapshot.adminUserId);
  restoreEnv("LODESTA_HASH_SECRET", authEnvSnapshot.hashSecret);
  restoreEnv("SUPABASE_URL", authEnvSnapshot.supabaseUrl);
  restoreEnv("SUPABASE_ANON_KEY", authEnvSnapshot.supabaseAnonKey);
  restoreEnv("SUPABASE_SERVICE_ROLE_KEY", authEnvSnapshot.supabaseServiceRoleKey);
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
const privatePlanningAsset = await storeGeneratedAssetBytes({
  siteId: "site_boundary_asset_probe",
  assetId: "asset_private_mockup_probe",
  base64: Buffer.from("private planning asset").toString("base64"),
  mimeType: "image/jpeg",
  localRoot: assetProbeRoot,
  forceLocal: true,
  publicUrl: false
});
const readBackAsset = await readLocalAsset(storedAsset.storagePath, assetProbeRoot);
assert(
  storedAsset.url === "/api/assets/site_boundary_asset_probe/asset_mockup_probe.jpg" && readBackAsset?.bytes.length === 11,
  "Generated asset bytes should store outside model JSON and be readable through the local asset adapter."
);
assert(
  !privatePlanningAsset.url && (await readLocalAsset(privatePlanningAsset.storagePath, assetProbeRoot))?.bytes.length === 22,
  "Internal-planning generated asset bytes should be stored without returning a public URL."
);
const imageGenerationSource = readFileSync("lib/image-generation.ts", "utf8");
assert(
  imageGenerationSource.includes("publicUrl: false") &&
    imageGenerationSource.includes("Image bytes stored privately"),
  "Generated mockup planning artifacts should store bytes without exposing public storage URLs."
);
const validOpenAiSettings = validateOpenAiRuntimeSettingsInput(OPENAI_RUNTIME_DEFAULTS);
assert(validOpenAiSettings.ok, "OpenAI runtime defaults should satisfy operator-settings validation.");
assert(
  validateOpenAiImageSize("1536x1024").ok &&
    validateOpenAiImageSize("auto").ok &&
    !validateOpenAiImageSize("99999x99999").ok &&
    !validateOpenAiImageSize("1000x1000").ok,
  "OpenAI image size validation should enforce gpt-image-2 constraints."
);
assert(
  OPENAI_IMAGE_OUTPUT_FORMAT === "jpeg" && imageGenerationSource.includes("outputFormat: settings.imageFormat"),
  "Generated mockup output format should be hard-coded through operator settings defaults."
);
const previousRepositoryMode = process.env.LODESTA_REPOSITORY;
const operatorSettingsProbeFile = join(mkdtempSync(join(tmpdir(), "lodesta-operator-settings-")), "settings.json");
setEnv("LODESTA_REPOSITORY", "local");
setOperatorSettingsLocalFileForTests(operatorSettingsProbeFile);
try {
  const initialOperatorSettings = await getOpenAiRuntimeSettings({ bypassCache: true });
  assert(initialOperatorSettings.version === 0 && initialOperatorSettings.source === "default", "Missing local operator settings should use versioned defaults.");
  const savedOperatorSettings = await saveOpenAiRuntimeSettings({
    settings: { ...OPENAI_RUNTIME_DEFAULTS, imageQuality: "medium" },
    expectedVersion: initialOperatorSettings.version,
    changedBy: "launch-boundary-verifier"
  });
  assert(savedOperatorSettings.version === 1 && savedOperatorSettings.source === "file", "Local operator settings should save to the configured file.");
  let staleSettingsRejected = false;
  try {
    await saveOpenAiRuntimeSettings({
      settings: { ...OPENAI_RUNTIME_DEFAULTS, imageQuality: "high" },
      expectedVersion: initialOperatorSettings.version,
      changedBy: "launch-boundary-verifier"
    });
  } catch (caught) {
    staleSettingsRejected = caught instanceof StaleOperatorSettingsError;
  }
  assert(staleSettingsRejected, "Operator settings saves should reject stale versions.");
  assert((await getOpenAiRuntimeSettings()).source === "cache", "Operator settings should use the in-process cache inside the TTL window.");
  writeFileSync(operatorSettingsProbeFile, "{not-json");
  const lkgOperatorSettings = await getOpenAiRuntimeSettings({ bypassCache: true });
  assert(
    lkgOperatorSettings.source === "lkg" && lkgOperatorSettings.settings.imageQuality === "medium",
    "Operator settings should use last-known-good values when the backing store becomes unreadable."
  );
} finally {
  restoreEnv("LODESTA_REPOSITORY", previousRepositoryMode);
  setOperatorSettingsLocalFileForTests(undefined);
  resetOpenAiRuntimeSettingsCacheForTests();
}
const crawlPageSignals = extractCrawlPageSignals(
  `<html>
    <head>
      <script type="application/ld+json">{"@type":"LocalBusiness","name":"Boundary Crawl Signals"}</script>
    </head>
    <body>
      <a href="tel:+15125550101">Call</a>
      <a href="/schedule">Book service</a>
      <a href="https://www.youtube.com/watch?v=owner-proof">Video proof</a>
      <img src="/brand-logo.png" alt="Boundary Crawl Signals logo">
      <form action="/contact" method="post">
        <input type="text" name="name" required>
        <input type="email" name="email" required>
        <input type="tel" name="phone">
        <textarea name="message"></textarea>
      </form>
    </body>
  </html>`,
  "https://boundary-crawl.example/"
);
assert(
  crawlPageSignals.jsonLdTypes.includes("LocalBusiness") &&
    crawlPageSignals.formReferences.some(
      (form) =>
        form.action === "https://boundary-crawl.example/contact" &&
        form.method === "post" &&
        form.hasEmailField &&
        form.hasPhoneField &&
        form.hasTextarea &&
        form.requiredFields.includes("email")
    ) &&
    crawlPageSignals.linkReferences.some((link) => link.kind === "tel" && link.href.startsWith("tel:")) &&
    crawlPageSignals.linkReferences.some((link) => link.kind === "booking" && link.href === "https://boundary-crawl.example/schedule") &&
    crawlPageSignals.linkReferences.some((link) => link.kind === "press_video" && link.href.includes("youtube.com")) &&
    crawlPageSignals.assetReferences.some((asset) => asset.kind === "logo" && asset.rightsStatus === "reference_only"),
  "URL crawl extraction should preserve schema types, structured forms, categorized links, and reference-only image signals."
);
const fixtureToken = "boundary-fixture-token";
const fixtureUrl = `https://dev.lodesta.com${crawlFixturePath(fixtureToken)}`;
const fixtureSummary = summarizeCrawlHtml(crawlFixtureHtml("https://dev.lodesta.com", fixtureToken), fixtureUrl);
assert(
  fixtureSummary.hasViewportMeta &&
    fixtureSummary.hasLocalBusinessSchema &&
    fixtureSummary.hasTelLink &&
    fixtureSummary.jsonLdTypes.includes("Restaurant") &&
    fixtureSummary.formCount > 0 &&
    fixtureSummary.internalLinkCount >= 3 &&
    fixtureSummary.formReferences.some((form) => form.hasEmailField && form.hasPhoneField && form.hasTextarea) &&
    fixtureSummary.linkReferences.some((link) => link.kind === "booking") &&
    fixtureSummary.linkReferences.some((link) => link.kind === "ordering") &&
    fixtureSummary.linkReferences.some((link) => link.kind === "social") &&
    fixtureSummary.extractedFacts.name === "Boundary Fixture Pizza" &&
    fixtureSummary.extractedFacts.phone === "+15125550191" &&
    fixtureSummary.extractedFacts.address?.country === "US",
  "Protected crawl fixture HTML should exercise schema, phone, form, internal link, booking, ordering, social, and business-fact extraction."
);
const fixtureScore = scoreCrawlAssessment({
  url: fixtureUrl,
  fetched: true,
  status: 200,
  finalUrl: fixtureUrl,
  title: fixtureSummary.title,
  metaDescription: fixtureSummary.metaDescription,
  canonical: fixtureSummary.canonical,
  hasViewportMeta: fixtureSummary.hasViewportMeta,
  hasLocalBusinessSchema: fixtureSummary.hasLocalBusinessSchema,
  hasTelLink: fixtureSummary.hasTelLink,
  robotsFound: true,
  sitemapFound: true,
  formCount: fixtureSummary.formCount,
  imageCount: fixtureSummary.imageCount,
  imagesWithoutAlt: fixtureSummary.imagesWithoutAlt,
  internalLinkCount: fixtureSummary.internalLinkCount,
  externalLinkCount: fixtureSummary.externalLinkCount,
  jsonLdTypes: fixtureSummary.jsonLdTypes,
  extractedFacts: fixtureSummary.extractedFacts,
  formReferences: fixtureSummary.formReferences,
  linkReferences: fixtureSummary.linkReferences,
  assetReferences: fixtureSummary.assetReferences,
  sampledInternalPages: fixtureSummary.linkReferences.filter((link) => link.kind === "internal").map((link) => link.href),
  pageSummaries: [fixtureSummary],
  score: { overall: 0, max: 0, percent: 0, grade: "poor", checks: [] },
  findings: []
});
assert(
  fixtureScore.percent >= 90 &&
    fixtureScore.checks.some((check) => check.id === "seo.local_business_schema" && check.passed) &&
    fixtureScore.checks.some((check) => check.id === "conversion.mobile_click_to_call" && check.passed) &&
    fixtureScore.checks.some((check) => check.id === "conversion.lead_form" && check.passed),
  "Protected crawl fixture should provide enough local parser signals for high-confidence crawl scoring."
);
const ipHash = hashIpAddress("203.0.113.10", {
  siteId: bundle.businessProfile.siteId,
  at: new Date("2026-05-29T12:00:00.000Z"),
  salt: "boundary-test-secret"
});
const nextDayIpHash = hashIpAddress("203.0.113.10", {
  siteId: bundle.businessProfile.siteId,
  at: new Date("2026-05-30T12:00:00.000Z"),
  salt: "boundary-test-secret"
});
const differentSecretIpHash = hashIpAddress("203.0.113.10", {
  siteId: bundle.businessProfile.siteId,
  at: new Date("2026-05-29T12:00:00.000Z"),
  salt: "boundary-different-secret"
});
assert(
  Boolean(ipHash?.startsWith("v2:")) &&
    ipHash === nextDayIpHash &&
    ipHash !== differentSecretIpHash &&
    !ipHash?.includes("203.0.113.10"),
  "Lead IP hashing should persist only a stable v2 HMAC digest, never the raw IP address."
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
assert(
  sanitizeAttributionUrl("owner@example.com") === undefined &&
    sanitizeAttributionUrl("Call 512-555-0101") === undefined &&
    sanitizeAttributionUrl("not a url") === undefined &&
    sanitizeAttributionUrl("https://example.com/owner@example.com?utm_source=mailer") === undefined &&
    sanitizeAttributionUrl("/sites/joes-pizza?utm_source=mailer&token=secret") === "/sites/joes-pizza?utm_source=mailer",
  "Stored attribution URLs should reject non-URL/contact-like values and preserve only safe HTTP(S) or root-relative attribution URLs."
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
    eventType: "section_view",
    timestamp: "2026-05-29T12:00:01.000Z",
    deviceType: "mobile",
    metadata: { elapsedMs: 1000 }
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
    deviceType: "mobile",
    metadata: { elapsedMs: 3000 }
  },
  {
    siteId: bundle.businessProfile.siteId,
    sessionId: "analytics_probe_1",
    pageId: "page_home",
    eventType: "web_vital",
    timestamp: "2026-05-29T12:00:04.000Z",
    value: 4200,
    deviceType: "mobile",
    metadata: { metric: "LCP" }
  },
  {
    siteId: bundle.businessProfile.siteId,
    sessionId: "analytics_probe_1",
    pageId: "page_home",
    eventType: "web_vital",
    timestamp: "2026-05-29T12:00:05.000Z",
    value: 0.18,
    deviceType: "mobile",
    metadata: { metric: "CLS" }
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
  },
  {
    siteId: bundle.businessProfile.siteId,
    sessionId: "analytics_probe_2",
    pageId: "page_home",
    sectionId: "services_home",
    eventType: "click",
    timestamp: "2026-05-29T12:02:12.000Z",
    elementRole: "div",
    elementType: "div",
    hrefType: "internal",
    normalizedX: 0.42,
    normalizedY: 0.52,
    deviceType: "desktop"
  },
  {
    siteId: bundle.businessProfile.siteId,
    sessionId: "agent_probe_1",
    pageId: "page_home",
    eventType: "agent_readable_request",
    timestamp: "2026-05-29T12:03:00.000Z",
    metadata: { resource: "llms_txt", path: "/llms.txt", agentFamily: "gptbot", verifiedBot: true }
  },
  {
    siteId: bundle.businessProfile.siteId,
    sessionId: "agent_probe_2",
    pageId: "page_home",
    eventType: "agent_readable_request",
    timestamp: "2026-05-29T12:03:05.000Z",
    metadata: { resource: "markdown_alternate", path: "/md", agentFamily: "chatgpt-user", acceptMarkdown: true }
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
  analyticsProbe.clickMap.some(
    (point) => point.sectionId === "services_home" && point.elementRole === "div" && point.count === 1
  ),
  "Analytics summary should include sanitized non-link/non-button clicks in all-click aggregation."
);
assert(
  analyticsProbe.sectionConversionPaths.some(
    (row) =>
      row.sectionId === "hero_home" &&
      row.exposedSessions === 1 &&
      row.actionSessions === 1 &&
      row.primaryActions === 1 &&
      row.medianTimeToActionMs === 2000
  ),
  "Analytics summary should connect section exposure to later primary actions in the same session."
);
assert(
  analyticsProbe.funnelDropoffs.some(
    (row) => row.key === "form_start_to_submit" && row.fromCount === 1 && row.toCount === 0 && row.dropoffRate === 1
  ) &&
    analyticsProbe.funnelDropoffs.some(
      (row) => row.key === "section_view_to_primary_action" && row.fromCount === 1 && row.toCount === 1 && row.conversionRate === 1
    ),
  "Analytics summary should expose funnel dropoff rows for internal conversion-path analysis."
);
assert(
  analyticsProbe.standardCorrelations.some(
    (row) => row.criterionId === "conversion.mobile_sticky_action" && row.primaryActions === 1
  ),
  "Analytics summary should correlate tracked outcomes to matching Standard criteria."
);
assert(
  analyticsProbe.standardCorrelations.some(
    (row) => row.criterionId === "technical.mobile_performance" && row.signal === "weak" && row.rate === 0
  ),
  "Analytics summary should correlate mobile Web Vitals to the mobile performance Standard criterion."
);
assert(
  analyticsProbe.agentReadableRequests === 2 &&
    analyticsProbe.agentReadableByResource.some((row) => row.key === "llms_txt" && row.requests === 1) &&
    analyticsProbe.agentReadableByResource.some((row) => row.key === "markdown_alternate" && row.requests === 1),
  "Analytics summary should track llms.txt and Markdown alternate requests for agent-readable publishing experiments."
);
assert(
  recommendFromAnalytics(bundle, analyticsProbe).some(
    (finding) => finding.id === "analytics_mobile_performance" && finding.standardCriterionId === "technical.mobile_performance"
  ),
  "Monthly recommendations should turn poor Web Vitals into a Standard-backed performance Action List item."
);
const monthlyLeadSubmissions: LeadSubmission[] = [
  {
    id: "lead_monthly_new",
    siteId: bundle.businessProfile.siteId,
    formId: "form_contact",
    pageId: "page_home",
    payload: { name: "New Lead", email: "new@example.com" },
    metadata: { utmSource: "mailer", utmCampaign: "postcard" },
    sourceUrl: "https://boundary-verify.example/?utm_source=mailer&utm_campaign=postcard",
    submittedAt: "2026-05-29T12:03:00.000Z",
    status: "new"
  },
  {
    id: "lead_monthly_reviewed",
    siteId: bundle.businessProfile.siteId,
    formId: "form_contact",
    pageId: "page_home",
    payload: { name: "Reviewed Lead", email: "reviewed@example.com" },
    metadata: { referrerHost: "search.example" },
    submittedAt: "2026-05-29T12:04:00.000Z",
    status: "reviewed"
  },
  {
    id: "lead_monthly_spam",
    siteId: bundle.businessProfile.siteId,
    formId: "form_quote",
    pageId: "page_contact",
    payload: { name: "Spam Lead" },
    submittedAt: "2026-05-29T12:05:00.000Z",
    status: "spam"
  }
];
const monthlyActionListResult = (await executeJob(
  {
    id: "job_monthly_boundary",
    kind: "monthly_action_list",
    status: "running",
    payload: { siteId: bundle.businessProfile.siteId },
    attempts: 1,
    maxAttempts: 1,
    runAfter: "2026-05-29T12:00:00.000Z",
    createdAt: "2026-05-29T12:00:00.000Z",
    updatedAt: "2026-05-29T12:00:00.000Z"
  },
  {
    getSiteBundle: async () => bundle,
    runAndStoreAudit: async () => runAudit(bundle.businessProfile, bundle.siteModel),
    analyticsSummary: async () => analyticsProbe,
    analyzeExperiments: async () => [],
    listExperimentLearnings: async () => [],
    listFormSubmissions: async () => monthlyLeadSubmissions
  }
)) as {
  leads?: number;
  leadSummary?: {
    total?: number;
    new?: number;
    reviewed?: number;
    spam?: number;
    byForm?: Array<{ formId: string; total: number }>;
    recent?: Array<{ id: string; sourceHost?: string; utmSource?: string; utmCampaign?: string }>;
  };
};
assert(
  monthlyActionListResult.leads === 3 &&
    monthlyActionListResult.leadSummary?.total === 3 &&
    monthlyActionListResult.leadSummary.new === 1 &&
    monthlyActionListResult.leadSummary.reviewed === 1 &&
    monthlyActionListResult.leadSummary.spam === 1 &&
    monthlyActionListResult.leadSummary.byForm?.some((row) => row.formId === "form_contact" && row.total === 2) &&
    monthlyActionListResult.leadSummary.recent?.some(
      (lead) => lead.id === "lead_monthly_new" && lead.sourceHost === "boundary-verify.example" && lead.utmSource === "mailer"
    ),
  "Monthly action-list jobs should include a lead summary with status counts, form counts, and safe attribution."
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
    !validateLaunchMarket({ url: "https://example.ae" }).ok &&
    !validateLaunchMarket({ facts: { address: { country: "CA" } } }).ok,
  "Launch market guard should reject explicit non-US prompt, country-code domain, and extracted-country signals."
);
assert(
  validateLaunchMarket({
    prompt: "Build a call-first HVAC site in Tulsa, Oklahoma.",
    facts: { address: { country: "US" } }
  }).ok && validateLaunchMarket({ url: "https://example.us" }).ok,
  "Launch market guard should allow US launch-market prompts, US country facts, and .us domains."
);
const previousPrivateCrawlOverride = process.env.LODESTA_ALLOW_PRIVATE_CRAWL_URLS;
process.env.LODESTA_ALLOW_PRIVATE_CRAWL_URLS = "true";
assert(
  !(await validatePublicFetchUrl("http://127.0.0.1:3000", { resolveDns: false })).ok,
  "Removed private-crawl environment variable should not allow localhost crawl URLs."
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
const previousRateLimitHashSecret = process.env.LODESTA_HASH_SECRET;
process.env.LODESTA_HASH_SECRET = "boundary-rate-limit-secret";
const stableHashForRateLimitProbe = hashIpAddress("203.0.113.10", {
  siteId: bundle.businessProfile.siteId,
  salt: "boundary-rate-limit-secret"
});
const rateLimitProbeKey = rateLimitKey(rateLimitRequest, {
  bucket: "boundary_verify_form_submit_probe",
  keyParts: [bundle.businessProfile.siteId, "form_contact"],
  limit: 1,
  windowMs: 60_000
});
assert(
  rateLimitProbeKey !== stableHashForRateLimitProbe && !rateLimitProbeKey.includes("203.0.113.10"),
  "Rate-limit fingerprints should use a separate HMAC purpose and never expose raw client IPs."
);
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
restoreEnv("LODESTA_HASH_SECRET", previousRateLimitHashSecret);
const blockedRateLimitBody = blockedRateLimit.ok ? "" : await blockedRateLimit.response.text();
assert(
  firstRateLimit.ok &&
    !blockedRateLimit.ok &&
    blockedRateLimit.response.status === 429 &&
    blockedRateLimit.response.headers.get("Retry-After") &&
    !blockedRateLimitBody.includes("203.0.113.10"),
  "Public write rate limiting should return 429 with retry headers without exposing raw client IPs."
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
    scheduleKey: "boundary-maintenance"
  },
  new Date("2026-05-29T12:00:00.000Z")
);
assert(
  scheduleResult.queued.length === 1 && scheduleResult.queued[0]?.kind === "monthly_action_list",
  "Cron scheduler should enqueue monthly action-list jobs without analytics-retention pruning."
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
    scheduleKey: "boundary-maintenance"
  },
  new Date("2026-05-29T12:00:00.000Z")
);
assert(
  duplicateSchedule.queued.length === 0 && duplicateSchedule.skipped.length === 1,
  "Cron scheduler should skip duplicate non-failed jobs with the same schedule key."
);

const publicSiteCache = cachePolicyForPathname("/sites/boundary-verify-hvac");
assert(
  publicSiteCache.kind === "public_site" &&
    publicSiteCache.cacheControl?.includes("s-maxage=300") &&
    publicSiteCache.vary === "Host, X-Forwarded-Host",
  "Public site HTML should be CDN-cacheable with a bounded shared cache TTL and vary by host plus forwarded host."
);
assert(
  cachePolicyForPathname("/", { customDomain: true }).kind === "public_site" &&
    cachePolicyForPathname("/", { customDomain: true }).vary === "Host, X-Forwarded-Host",
  "Custom-domain root traffic should receive the public-site cache policy after host-header routing."
);
assert(
  cachePolicyForPathname("/llms.txt").kind === "metadata" &&
    cachePolicyForPathname("/llms.txt").vary === "Host, X-Forwarded-Host",
  "llms.txt should receive short metadata caching that varies by host plus forwarded host."
);
const seoHeaders = new Headers({ host: "www.boundary-verify.example", "x-forwarded-proto": "https", [customDomainRoutedHeader]: "1" });
const platformSeoHeaders = new Headers({ host: "localhost:3000", "x-forwarded-proto": "http" });
const chainedForwardedHeaders = new Headers({
  host: "internal.proxy",
  "x-forwarded-host": "www.boundary-verify.example, edge.proxy",
  "x-forwarded-proto": "https, http",
  [customDomainRoutedHeader]: "1"
});
const malformedForwardedHeaders = new Headers({
  host: "internal.proxy",
  "x-forwarded-host": "HTTPS://WWW.BOUNDARY-VERIFY.EXAMPLE./bad-path?utm=bad, edge.proxy",
  "x-forwarded-proto": "javascript, https",
  [customDomainRoutedHeader]: "1"
});
const seoHome = getPublishedVersion(bundle.siteModel).pages[0];
assert(seoHome, "SEO verifier needs a generated home page.");
assert(
  canonicalUrlForPage(bundle, seoHome, seoHeaders) === "https://www.boundary-verify.example/",
  "Custom-domain canonical URLs should resolve to the customer host root."
);
assert(
  requestHostname(chainedForwardedHeaders) === "www.boundary-verify.example" &&
    requestOrigin(chainedForwardedHeaders) === "https://www.boundary-verify.example" &&
    canonicalUrlForPage(bundle, seoHome, chainedForwardedHeaders) === "https://www.boundary-verify.example/",
  "Forwarded host/proto chains should use the public customer-facing origin for canonical URLs."
);
assert(
  requestHostname(malformedForwardedHeaders) === "www.boundary-verify.example" &&
    requestOrigin(malformedForwardedHeaders) === "https://www.boundary-verify.example" &&
    canonicalUrlForPage(bundle, seoHome, malformedForwardedHeaders) === "https://www.boundary-verify.example/",
  "Forwarded host/proto parsing should strip schemes, paths, and unsupported protocols before creating public URLs."
);
assert(
  middlewareSource.includes("getCachedDomainResolution") &&
    middlewareSource.includes("rememberDomainResolution") &&
    middlewareSource.includes("const platformHost = !hostname || isPlatformHost(hostname);") &&
    middlewareSource.includes("const hostname = requestHostname(request.headers);") &&
    middlewareSource.includes('const forwardedHostRewriteParam = "__lodesta_forwarded_host";') &&
    middlewareSource.includes("request.nextUrl.searchParams.get(forwardedHostRewriteParam) === \"1\"") &&
    middlewareSource.includes("request.headers.get(customDomainRoutedHeader) === \"1\"") &&
    middlewareSource.includes('Boolean(request.headers.get("x-forwarded-host")) && hostname !== directHostname') &&
    middlewareSource.includes("isPublicRuntimeSkippedPath(pathname)") &&
    middlewareSource.includes('pathname.startsWith("/api/")') &&
    middlewareSource.includes("if (!payload.resolved || !payload.slug) return notFound();") &&
    middlewareSource.includes("const rewrittenSitePrefix = `/sites/${payload.slug}`") &&
    middlewareSource.includes("pathname.startsWith(`${rewrittenSitePrefix}/`)") &&
    middlewareSource.includes('rewriteUrl.searchParams.set(forwardedHostRewriteParam, "1")') &&
    middlewareSource.includes("headers.set(customDomainRoutedHeader, \"1\")") &&
    middlewareSource.includes("new NextResponse(null, { status: 404 })") &&
    middlewareSource.includes('cachePolicyForPathname("/__forwarded-host-no-store")') &&
    middlewareSource.includes('"Cloudflare-CDN-Cache-Control"') &&
    middlewareSource.includes('"X-Lodesta-Forwarded-Host-Cache"'),
  "Custom-domain middleware should use cached positive host lookup, return bare 404 for unknown non-platform hosts, avoid double-rewriting internal site paths, and disable CDN caching when routing depends on X-Forwarded-Host."
);
assert(
  hostRoutingSource.includes('hostname.endsWith(".railway.app")') &&
    hostRoutingSource.includes('hostname.endsWith(".up.railway.app")') &&
    !hostRoutingSource.includes("LODESTA_PLATFORM_HOSTS"),
  "Host routing should keep local/Railway platform identity checks without LODESTA_PLATFORM_HOSTS."
);
assert(
  canonicalUrlForPage(bundle, seoHome, platformSeoHeaders).includes(`/sites/${bundle.siteModel.slug}`),
  "Platform-host canonical URLs should keep the /sites/{slug} prefix."
);
const claimedRobots = siteRobotsTxt(bundle, [claimedClaim], seoHeaders);
assert(
  claimedRobots.includes("Allow: /") && claimedRobots.includes("Sitemap: https://www.boundary-verify.example/sitemap.xml"),
  "Claimed custom domains should serve an allow-all robots.txt with a customer-host sitemap URL."
);
assert(
  siteRobotsTxt(bundle, [], seoHeaders).includes("Disallow: /"),
  "Unclaimed sites should serve disallow-all site robots output."
);
const claimedSitemap = siteSitemapXml(bundle, [claimedClaim], seoHeaders);
assert(
  claimedSitemap.includes("<loc>https://www.boundary-verify.example/</loc>") &&
    !claimedSitemap.includes("/sites/"),
  "Custom-domain sitemap URLs should use customer-host URLs rather than platform /sites paths."
);
const claimedLlmsTxt = siteLlmsTxt(bundle, [claimedClaim], seoHeaders);
assert(
  claimedLlmsTxt?.includes(`# ${bundle.businessProfile.name}`) &&
    claimedLlmsTxt.includes("## Core Pages") &&
    claimedLlmsTxt.includes("https://www.boundary-verify.example/md"),
  "Claimed sites should expose an agent-readable llms.txt with custom-domain Markdown alternates."
);
assert(siteLlmsTxt(bundle, [], seoHeaders) === null, "Unclaimed sites should not expose llms.txt content.");
const claimedMarkdown = markdownForPage(bundle, seoHome, seoHeaders);
assert(
  claimedMarkdown.includes(`# ${seoHome.title}`) &&
    claimedMarkdown.includes("Canonical: https://www.boundary-verify.example/") &&
    claimedMarkdown.includes("## Business") &&
    markdownUrlForPage(bundle, seoHome, seoHeaders) === "https://www.boundary-verify.example/md" &&
    markdownCanonicalLinkHeader(bundle, seoHome, seoHeaders) ===
      '<https://www.boundary-verify.example/>; rel="canonical"; type="text/html"',
  "Markdown alternates should summarize public page content and point back to the canonical HTML URL."
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
  "/business/boundary-verify-hvac",
  "/leads/boundary-verify-hvac",
  "/versions/boundary-verify-hvac",
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
assert(
  isResolvableCustomDomain({ provider: "railway", status: "active" }) &&
    !isResolvableCustomDomain({ provider: "railway", status: "pending" }) &&
    !isResolvableCustomDomain({ provider: "cloudflare_for_saas", status: "pending" }),
  "Host-header custom-domain routing should serve only active domains after claim and DNS/provider setup."
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
const outboundManifest = buildOutboundMailerManifest(
  [outboundCampaign],
  [outboundProspect],
  outboundCampaign.id,
  "https://lodesta.example"
);
const outboundManifestCsv = outboundMailerManifestCsv(outboundManifest);
assert(
  outboundManifest.length === 1 &&
    outboundManifest[0].previewUrl === "https://lodesta.example/preview/demo-token" &&
    outboundManifestCsv.includes("campaignId,campaignName,campaignStatus,complianceStatus") &&
    outboundManifestCsv.includes(bundle.businessProfile.name),
  "Outbound wedge tooling should export a mailer manifest with preview URLs and campaign/prospect reconciliation fields."
);
assert(
  !assertOutboundCompliance({
    name: "High Volume Mailer",
    status: "running",
    metadata: { plannedRecipients: 250 }
  }).ok &&
    assertOutboundCompliance({
      name: "Reviewed High Volume Mailer",
      status: "running",
      metadata: { plannedRecipients: 250, legalReviewedAt: "2026-05-29", legalReviewer: "counsel@example.com" }
    }).ok,
  "High-volume outbound campaigns should require IP/legal review metadata before launch."
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
  standardCriterionIds.includes("technical.https") &&
    standardCriterionIds.includes("seo.clean_urls") &&
    standardCriterionIds.includes("trust.credentials_or_years") &&
    standardCriterionIds.includes("content.service_area_clarity") &&
    standardCriterionIds.includes("content.faqs"),
  "The launch Standard should cover HTTPS, clean URLs, trust proof, service-area clarity, and FAQs."
);
assert(
  generatedEvaluation.checks.some((check) => check.criterionId === "trust.credentials_or_years" && check.passed) &&
    generatedEvaluation.checks.some((check) => check.criterionId === "content.service_area_clarity" && check.passed) &&
    generatedEvaluation.checks.some((check) => check.criterionId === "content.faqs" && check.passed),
  "Generated launch sites should pass universal trust, service-area, and FAQ Standard criteria."
);
assert(
  [
    "technical.healthy_response",
    "technical.mobile_viewport",
    "seo.canonical",
    "seo.robots_txt",
    "seo.sitemap",
    "accessibility.image_alt"
  ].every((criterionId) =>
    generatedEvaluation.checks.some(
      (check) => check.criterionId === criterionId && check.passed && !check.evidence.includes("not yet evaluated")
    )
  ),
  "Generated launch sites should explicitly evaluate response, viewport, canonical, robots, sitemap, and image-alt Standard criteria."
);
const missingUniversalStandardBundle = structuredClone(bundle);
missingUniversalStandardBundle.businessProfile.address = undefined;
missingUniversalStandardBundle.businessProfile.serviceAreas = ["Local area"];
missingUniversalStandardBundle.businessProfile.reviewsSummary = undefined;
for (const version of missingUniversalStandardBundle.siteModel.versions) {
  version.pages = version.pages.filter((page) => !page.slug.startsWith("areas/"));
  for (const page of version.pages) {
    page.sections = page.sections.filter(
      (section) => !["faq", "trust_bar", "testimonials", "team", "map"].includes(section.type)
    );
    for (const section of page.sections) section.props = scrubTrustProofTerms(section.props);
  }
}
const universalStandardFindings = runAudit(
  missingUniversalStandardBundle.businessProfile,
  missingUniversalStandardBundle.siteModel
);
const faqFinding = universalStandardFindings.find((finding) => finding.standardCriterionId === "content.faqs");
assert(
  faqFinding?.applyMode === "one_click" &&
    universalStandardFindings.some(
      (finding) => finding.standardCriterionId === "content.service_area_clarity" && finding.applyMode === "manual_service"
    ) &&
    universalStandardFindings.some(
      (finding) => finding.standardCriterionId === "trust.credentials_or_years" && finding.applyMode === "manual_service"
    ),
  "Audits should create Standard-backed findings for missing FAQs, service-area clarity, and trust proof."
);
const universalStandardQa = runSiteQa(missingUniversalStandardBundle);
assert(
  universalStandardQa.checks.some(
    (check) => check.standardCriterionId === "content.faqs" && check.severity === "warning"
  ) &&
    universalStandardQa.checks.some(
      (check) => check.standardCriterionId === "content.service_area_clarity" && check.severity === "warning"
    ) &&
    universalStandardQa.checks.some(
      (check) => check.standardCriterionId === "trust.credentials_or_years" && check.severity === "warning"
    ),
  "QA should include Standard-backed checks for missing FAQs, service-area clarity, and trust proof."
);
const faqApplyResult = applySuggestedEdit(missingUniversalStandardBundle, faqFinding);
assert(
  faqApplyResult.ok &&
    evaluateSiteAgainstStandard(missingUniversalStandardBundle, { versionStatus: "draft" }).checks.some(
      (check) => check.criterionId === "content.faqs" && check.passed
    ) &&
    runSiteQa(missingUniversalStandardBundle, { versionStatus: "draft" }).checks.some(
      (check) => check.standardCriterionId === "content.faqs" && check.severity === "pass"
    ),
  "The FAQ Standard finding should be one-click applicable and produce a draft that passes the FAQ criterion in Standard evaluation and QA."
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
const copiedSourceCopy = "Exact source marketing sentence that should never be reused verbatim in generated previews.";
const copyRiskCrawl = crawlFixture("https://boundary-copy.example/services", "https://boundary-copy.example/services");
copyRiskCrawl.extractedFacts = {
  ...copyRiskCrawl.extractedFacts,
  name: "Boundary Copy HVAC",
  description: copiedSourceCopy,
  services: ["Emergency HVAC repair"]
};
const copySafeBundle = createSiteFromInput({ url: "https://boundary-copy.example/services", crawl: copyRiskCrawl });
assert(
  copySafeBundle.businessProfile.description !== copiedSourceCopy &&
    !JSON.stringify(copySafeBundle.siteModel.versions).includes(copiedSourceCopy),
  "Generated pre-claim previews must not reuse source-site marketing descriptions verbatim."
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
  bundle.experiments.every((experiment) => (experiment.holdoutPercent ?? 0) >= 0 && (experiment.holdoutPercent ?? 0) <= 0.5),
  "Generated experiment candidates should keep holdout controls inside the governed 0-50% range."
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
assert(
  qa.passed &&
    qa.checks.some((check) => check.standardCriterionId === "content.faqs" && check.severity === "pass") &&
    qa.checks.some((check) => check.standardCriterionId === "content.service_area_clarity" && check.severity === "pass") &&
    qa.checks.some((check) => check.standardCriterionId === "trust.credentials_or_years" && check.severity === "pass"),
  "Generated launch sites with phone and location should pass blocking QA guardrails and universal Standard-backed QA checks."
);

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
const pressLinkBundle = structuredClone(qaBundle);
applyBusinessProfileUpdate(pressLinkBundle, {
  siteId: pressLinkBundle.businessProfile.siteId,
  pressLinks: ["https://www.youtube.com/watch?v=owner-approved", "https://news.example/profile"]
});
assert(
  pressLinkBundle.businessProfile.pressLinks.length === 2 &&
    pressLinkBundle.businessProfile.provenance.pressLinks?.source === "owner" &&
    pressLinkBundle.businessProfile.provenance.pressLinks.verified,
  "Owners should be able to curate press/video links as verified business profile facts."
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
const serializedJsonLd = serializeJsonLd({ name: "</script><script>alert(1)</script>", sameAs: ["https://example.com?a=1&b=2"] });
assert(
  !serializedJsonLd.includes("</script>") &&
    serializedJsonLd.includes("\\u003c/script\\u003e") &&
    serializedJsonLd.includes("\\u0026"),
  "LocalBusiness JSON-LD serialization must escape script-breaking characters."
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
const blockedPrivateWebhook = applyFormSettingsUpdate(structuredClone(qaBundle), {
  siteId: qaBundle.businessProfile.siteId,
  formId: qaBundle.extensionModel.forms[0]?.id ?? "form_contact",
  webhookUrl: "http://127.0.0.1:3000/private-leads",
  fields: [
    { id: "name", label: "Name", type: "text", required: true },
    { id: "email", label: "Email", type: "email", required: true }
  ]
});
assert(
  !blockedPrivateWebhook.ok,
  "Managed launch forms should reject private-network webhook URLs before saving notification workflows."
);
const unsafeWebhookBundle = structuredClone(qaBundle);
unsafeWebhookBundle.extensionModel.workflows = [
  {
    id: "workflow_unsafe_webhook",
    trigger: "form_submission",
    destination: "webhook",
    config: { url: "http://127.0.0.1:3000/private-leads" }
  }
];
const unsafeWebhookLead: LeadSubmission = {
  id: "lead_unsafe_webhook",
  siteId: unsafeWebhookBundle.businessProfile.siteId,
  formId: unsafeWebhookBundle.extensionModel.forms[0]?.id ?? "form_contact",
  pageId: "page_home",
  payload: { name: "Boundary Owner", email: "owner@example.com" },
  submittedAt: new Date().toISOString(),
  status: "new"
};
const unsafeWebhookDeliveries = await executeFormSubmissionWorkflows(unsafeWebhookBundle, unsafeWebhookLead, async (delivery) => ({
  id: "delivery_unsafe_webhook",
  createdAt: new Date().toISOString(),
  ...delivery
}));
assert(
  unsafeWebhookDeliveries.some((delivery) => delivery.status === "failed" && delivery.message.includes("URL safety")),
  "Webhook delivery should fail closed if an existing workflow points at a private or reserved network target."
);
const workflowSource = readFileSync("lib/workflows.ts", "utf8");
assert(
  workflowSource.includes("AbortSignal.timeout(workflowTimeoutMs())") &&
    workflowSource.includes("LODESTA_WORKFLOW_TIMEOUT_MS") &&
    !workflowSource.includes("allowPrivateOverride") &&
    workflowSource.includes("Math.min(Math.max(Math.trunc(parsed), 1000), 30000)"),
  "External workflow delivery fetches should use a bounded timeout without private-crawl URL override plumbing."
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
const ownerUploadedAsset = await storeAssetBytes({
  siteId: ownerAssetBundle.businessProfile.siteId,
  assetId: "owner-uploaded-logo-probe",
  bytes: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
    "base64"
  ),
  mimeType: "image/png",
  localRoot: assetProbeRoot,
  forceLocal: true
});
assert(ownerUploadedAsset.url, "Owner upload storage should return a public URL.");
const ownerUploadedAssets = applyOwnerAssetsUpdate(ownerAssetBundle, {
  siteId: ownerAssetBundle.businessProfile.siteId,
  rightsAccepted: true,
  logo: { url: ownerUploadedAsset.url, alt: "Uploaded Boundary Verify Salon logo" }
});
assert(
  ownerUploadedAssets.ok &&
    ownerUploadedAssets.logo?.url.startsWith("/api/assets/") &&
    ownerUploadedAssets.logo.rightsStatus === "customer_granted" &&
    ownerUploadedAssets.assets.some((asset) => asset.url === ownerUploadedAsset.url && asset.ownerApproved),
  "Storage-backed owner uploads should be accepted as customer-granted published-site assets."
);
assert(
  isPublicLocalAssetPath(ownerAssetBundle, ownerUploadedAsset.storagePath),
  "Public local asset serving should allow owner-approved published-site uploads."
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
const blockedPrivateOwnerAssets = applyOwnerAssetsUpdate(structuredClone(qaBundle), {
  siteId: qaBundle.businessProfile.siteId,
  rightsAccepted: true,
  logo: { url: "http://127.0.0.1/private-logo.png", alt: "Private network logo" }
});
assert(
  !blockedPrivateOwnerAssets.ok,
  "Owner-provided remote asset URLs should reject localhost, private, and reserved network hosts."
);
const ownerAssetsRouteSource = readFileSync("app/api/assets/owner/route.ts", "utf8");
assert(
  ownerAssetsRouteSource.includes("validatePublicHostname(url.hostname)") && ownerAssetsRouteSource.includes("!url.username"),
  "Owner asset API validation should reject private-host and credentialed remote asset URLs before publishing."
);
const referenceOnlyAssetBundle = structuredClone(qaBundle);
const referenceOnlyLocalStoragePath = `${referenceOnlyAssetBundle.businessProfile.siteId}/source-reference.jpg`;
const referenceOnlyUrl = `/api/assets/${referenceOnlyLocalStoragePath}`;
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
assert(
  !isPublicLocalAssetPath(referenceOnlyAssetBundle, referenceOnlyLocalStoragePath),
  "Public local asset serving should not expose reference-only scraped assets."
);
const internalPlanningLocalStoragePath = `${referenceOnlyAssetBundle.businessProfile.siteId}/mockup-planning.jpg`;
referenceOnlyAssetBundle.presenceAssessment.assetInventory.push({
  id: "site_asset_internal_planning_probe",
  siteId: referenceOnlyAssetBundle.businessProfile.siteId,
  kind: "mockup",
  url: `/api/assets/${internalPlanningLocalStoragePath}`,
  alt: "Internal planning mockup",
  source: "generated",
  rightsStatus: "preclaim_safe",
  usageScope: "internal_planning",
  ownerApproved: false,
  metadata: { planningOnly: true },
  createdAt: new Date().toISOString()
});
assert(
  !isPublicLocalAssetPath(referenceOnlyAssetBundle, internalPlanningLocalStoragePath),
  "Public local asset serving should not expose internal-planning mockups even when the bytes are generated."
);
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
  actionListApply.ok && actionListApply.changeSummary.summary.includes("SEO title and description"),
  "Action-list suggested edits should return owner-reviewable change evidence before publish confirmation."
);
assert(
  actionListBundle.siteModel.versions.some((version) => version.status === "published") &&
    actionListBundle.siteModel.versions.some((version) => version.status === "draft"),
  "Action-list applies should stage a draft while leaving the published version unchanged until explicit confirmation."
);
assert(
  runSiteQa(actionListBundle, { versionStatus: "draft" }).checks.length > 0,
  "Action-list applies should leave a draft that can be QA-checked before publish confirmation."
);
const publishedBeforeRestore = actionListBundle.siteModel.versions.find((version) => version.status === "published");
const existingDraftBeforeRestore = actionListBundle.siteModel.versions.find((version) => version.status === "draft");
assert(publishedBeforeRestore && existingDraftBeforeRestore, "Rollback verifier needs published and draft versions.");
const restoredDraft = restoreVersionToDraftBundle(actionListBundle, {
  versionId: publishedBeforeRestore.id,
  createdAt: "2026-01-01T00:00:00.000Z"
});
assert(restoredDraft.ok, "Version history should restore any selected version into a fresh draft.");
assert(
  actionListBundle.siteModel.versions.find((version) => version.id === publishedBeforeRestore.id)?.status === "published",
  "Restoring a version should leave the current published version live until explicit publish confirmation."
);
assert(
  actionListBundle.siteModel.versions.some(
    (version) => version.id === restoredDraft.draftVersionId && version.status === "draft"
  ),
  "Version history restore should create a QA-checkable draft version."
);
assert(
  runSiteQa(actionListBundle, { versionId: restoredDraft.draftVersionId }).checks.length > 0,
  "Restored drafts should be addressable by QA before publish."
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

function healthCheckState(report: Awaited<ReturnType<typeof getHealthReport>>, id: string) {
  return report.checks.find((check) => check.id === id)?.state;
}

function assertRateLimitBeforeParse(routePath: string, parseMarker: string) {
  const source = readFileSync(routePath, "utf8");
  const rateLimitIndex = source.indexOf("rateLimit(request");
  const parseIndex = source.indexOf(parseMarker);
  assert(
    rateLimitIndex >= 0 && parseIndex >= 0 && rateLimitIndex < parseIndex,
    `${routePath} should apply its endpoint rate limit before parsing request bodies.`
  );
}

function assertCliCommand(command: string, markers: readonly string[]) {
  const source = readFileSync("scripts/lodesta.mjs", "utf8");
  const caseIndex = source.indexOf(`case "${command}":`);
  assert(caseIndex >= 0, `Launch CLI should expose ${command}.`);
  const nextCaseIndex = source.indexOf("\n    case ", caseIndex + 1);
  const defaultIndex = source.indexOf("\n    default:", caseIndex + 1);
  const endIndex = nextCaseIndex >= 0 ? nextCaseIndex : defaultIndex >= 0 ? defaultIndex : source.length;
  const commandSource = source.slice(caseIndex, endIndex);
  for (const marker of markers) {
    assert(commandSource.includes(marker), `Launch CLI command ${command} should call the app API marker ${marker}.`);
  }
}

function assertCliTransportUsesHttpApis() {
  const source = readFileSync("scripts/lodesta.mjs", "utf8");
  assert(source.includes("async function get(path)") && source.includes("async function post(path, body)"), "Launch CLI should use HTTP helpers.");
  assert(source.includes("fetch(`${baseUrl}${path}`"), "Launch CLI should call configured app API URLs through fetch.");
  assert(source.includes("authHeaders()"), "Launch CLI should attach admin auth headers when configured.");
  assert(
    !source.includes("../lib/repository") && !source.includes("../lib/store") && !source.includes("../lib/supabase/repository"),
    "Launch CLI should not bypass the app API by importing repository internals."
  );
}

function scrubTrustProofTerms(value: unknown): Record<string, unknown> {
  return scrubValue(value) as Record<string, unknown>;
}

function scrubValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(
      /credential|certified|licensed|insured|years|award|provider|attorney|trainer|veterinarian|doctor|portfolio|project proof|results/gi,
      "service detail"
    );
  }
  if (Array.isArray(value)) return value.map(scrubValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrubValue(item)]));
  }
  return value;
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
    formReferences: [],
    linkReferences: [],
    assetReferences: [],
    sampledInternalPages: [],
    pageSummaries: [],
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
