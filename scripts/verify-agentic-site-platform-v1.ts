import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentAuthoredArtifactSchema, normalizeAgentAuthoredArtifact } from "../packages/site-verification/contracts";
import { prepareSiteArtifact } from "../packages/site-verification/finalizer";
import { applyEditObjective } from "../packages/site-verification/edit-objective";
import { ArtifactClaimValidatorV1 } from "../packages/site-verification/artifact-claims";
import {
  assetRevisionV1Schema,
  businessStateV3Schema,
  controlPlaneChangePayloadSchema,
  operatorQueueItemSchema,
  platformSiteRecordSchema,
  siteAgentRunV2Schema,
  siteAgentTraceSpanV1Schema,
  siteAgentSessionV1Schema,
  siteEditObjectiveV1Schema,
  siteBuildArtifactV1Schema,
  siteIntentV3Schema,
  sitePublicBuildInputV3Schema,
  siteVersionV4Schema,
  siteVersionApprovalV1Schema,
  siteWorkspaceRevisionV1Schema,
  sourceSnapshotV1Schema,
  verticalDemandEventV1Schema,
  type TrustedRuntimePatchV1,
  type TrustedRuntimeSeriesV1
} from "../packages/site-contracts";
import { LocalSitePlatformRepository } from "../packages/platform-data/repository";
import { AgenticSiteWorkflowV1, EditClarificationRequiredError, EditPreflightFailedError, initialGenerationDeadlineMs, managerRuntimeBudget, siteEditDeadlineMs } from "../packages/site-platform/workflow";
import { candidateAttemptForRun } from "../packages/site-platform/run-outcome";
import {
  artifactBlobAuditConfirmation,
  assertArtifactBlobAuditDeletable,
  buildArtifactBlobAudit,
  LocalArtifactBlobStore,
  parseArtifactBlobAuditReport,
  workspaceSourceSidecarKey
} from "../packages/site-artifacts";
import { LocalArtifactBlobMaintenanceStore } from "../packages/site-artifacts/maintenance-store";
import { deriveSitePublicationReadiness } from "../packages/site-platform/publication-readiness";
import { unsupportedCapabilityDemands } from "../packages/site-capabilities/policy";
import { createPublicBuildInput } from "../packages/business-data/public-projection";
import { sha256 } from "../packages/business-data";
import { assetRevisionIdForBusiness, sourceSnapshotIdForBusiness } from "../packages/business-data/website-ingestion";
import { createSiteRuntimePatch, promoteRuntimePatch, rollbackRuntimePatch, runtimePatchPath } from "../packages/trusted-runtime";
import { matchVerticalContext, verticalContextFor } from "../packages/vertical-context";
import { validateWorkspaceSourcePolicy } from "../packages/site-agent/source-policy";
import { ControlPlaneServiceV2 } from "../packages/control-plane/service";
import { canAccessAgentSession } from "../app/api/site-agent/auth";
import { GET as readSiteReadinessRoute } from "../app/api/sites/[siteId]/readiness/route";
import { POST as reviewSiteVersionRoute } from "../app/api/site-versions/[versionId]/review/route";
import { LocalPlatformOperationsRepository, redirectsStrandedByRoutes, validateSiteRedirectInput } from "../packages/platform-operations";
import { buildSyntheticSiteInput } from "./support/synthetic-site-input";
import { platformCapabilityStyles } from "../workers/site-sandbox/scaffold/platform/capability-styles";
import { formatPhoneForDisplay, orderedLocationHours } from "../workers/site-sandbox/scaffold/platform/presentation";
import { deriveSiteLifecycle, deriveSiteOwnership } from "../lib/site-admin-status";
import { tracePayloadRetentionMs } from "../packages/site-platform/trace-recorder";

const buildInput = buildSyntheticSiteInput();
let retiredIntentAccepted = true;
let retiredInputAccepted = true;
try { siteIntentV3Schema.parse({ ...buildInput.intent, schemaVersion: "site-intent-v2" }); } catch { retiredIntentAccepted = false; }
try { sitePublicBuildInputV3Schema.parse({ ...buildInput, schemaVersion: "site-public-build-input-v2" }); } catch { retiredInputAccepted = false; }
assert(!retiredIntentAccepted, "SiteIntentV3 accepted the retired V2 discriminator");
assert(!retiredInputAccepted, "SitePublicBuildInputV3 accepted the retired V2 discriminator");
assert(deriveSiteLifecycle({ publishedVersionId: "version_live" }, [{ status: "published" }], { status: "running" }) === "generating", "active generation did not take precedence over publication status");
assert(deriveSiteLifecycle({ publishedVersionId: undefined }, [], { status: "failed" }) === "needs_attention", "failed generation did not surface as needing attention");
assert(deriveSiteLifecycle({ publishedVersionId: undefined }, [{ status: "candidate" }], { status: "succeeded" }) === "ready_for_review", "candidate site did not surface as ready for review");
assert(deriveSiteLifecycle({ publishedVersionId: "version_live" }, [{ status: "published" }], { status: "succeeded" }) === "published", "published site did not retain its lifecycle status");
assert(deriveSiteLifecycle({ publishedVersionId: undefined }, [], undefined) === "draft", "empty site did not default to draft");
assert(deriveSiteOwnership([{ status: "preview" }]) === "claim_pending", "preview claim did not surface as pending");
assert(deriveSiteOwnership([{ status: "checkout_required" }, { status: "claimed" }]) === "claimed", "completed claim did not take precedence over pending claims");
assert(deriveSiteOwnership([]) === "unclaimed", "site without claims did not surface as unclaimed");
assert(managerRuntimeBudget("initial_build").builds === 4 && managerRuntimeBudget("initial_build").inspections === 4, "initial manager budget drifted from four matched cycles");
assert(managerRuntimeBudget("qa_repair").builds === 3 && managerRuntimeBudget("qa_repair").inspections === 3, "QA repair budget cannot support three matched build/inspection cycles");
assert(managerRuntimeBudget("focused_edit").builds === 3 && managerRuntimeBudget("focused_edit").inspections === 3, "focused edit budget drifted from three matched cycles");
assert(initialGenerationDeadlineMs === 60 * 60_000, "initial workflow deadline drifted from 60 minutes");
assert(siteEditDeadlineMs === 25 * 60_000, "edit workflow deadline drifted from 25 minutes");
assert(tracePayloadRetentionMs === 24 * 60 * 60_000, "trace payload database expiry drifted from the one-day R2 lifecycle");
const retainedContentHash = `sha256:${"a".repeat(64)}`;
assert(sourceSnapshotIdForBusiness("business_a", retainedContentHash) === sourceSnapshotIdForBusiness("business_a", retainedContentHash), "source snapshot IDs are not stable within one business");
assert(sourceSnapshotIdForBusiness("business_a", retainedContentHash) !== sourceSnapshotIdForBusiness("business_b", retainedContentHash), "source snapshot IDs collide across business authorities");
assert(assetRevisionIdForBusiness("business_a", retainedContentHash) !== assetRevisionIdForBusiness("business_b", retainedContentHash), "asset revision IDs collide across business authorities");
const hostile = agentAuthoredArtifactSchema.parse({
  schemaVersion: "agent-authored-artifact-v1",
  siteName: "Hostile verification input",
  designRationale: "An intentionally hostile artifact that proves executable output, unsupported claims, unsafe links, direct network assets, and unbound capabilities fail closed.",
  sharedCss: "@import url('https://evil.example/theme.css'); body{background-image:url('https://evil.example/track.png')} .hidden{behavior:url(x)}",
  routes: [{
    path: "/",
    title: "Hostile verification",
    description: "Must never pass artifact verification.",
    bodyHtml: `<main onclick="fetch('https://evil.example')"><script>alert(1)</script><iframe src="https://evil.example"></iframe><h1 data-lodesta-fact-id="business:name">Northstar Collision Repair</h1><p>Certified collision specialists with a lifetime warranty and 5 stars.</p><img src="https://evil.example/pixel.png" alt=""><input type="image" src="https://evil.example/submit.png"><a href="javascript:alert(1)">Unsafe</a><a href="https://evil.example/phishing">Unverified external link</a><form data-lodesta-form-id="unknown_form"><input name="email" type="email"><button>Send</button></form></main>`
  }],
  claims: [],
  capabilityBindings: [{ id: "hostile_form", kind: "form", route: "/", config: { formId: "unknown_form" } }]
});
const claimParity: { cases: Array<{ id: string; html: string; declarations: unknown[]; expected: "pass" | "fail" }> } = {
  cases: [
    { id: "formatted_phone", html: "<p>Call 512-555-0142 today.</p>", declarations: [{ id: "phone_claim", route: "/", text: "512-555-0142", kind: "free_text", sourceFactIds: ["fact_phone"], autoDeclared: false }], expected: "pass" },
    { id: "unsupported_modifier", html: "<p>Expert collision repair for Austin drivers.</p>", declarations: [{ id: "service_claim", route: "/", text: "Expert collision repair", kind: "free_text", sourceFactIds: ["fact_service_collision"], autoDeclared: false }], expected: "fail" },
    { id: "exact_warranty_evidence", html: "<p>Limited lifetime paint warranty</p>", declarations: [{ id: "warranty_claim", route: "/", text: "Limited lifetime paint warranty", kind: "free_text", sourceFactIds: ["fact_proof_warranty"], autoDeclared: false }], expected: "pass" },
    { id: "normalized_email", html: "<p>Email SERVICE@NORTHSTAR.EXAMPLE</p>", declarations: [{ id: "email_claim", route: "/", text: "SERVICE@NORTHSTAR.EXAMPLE", kind: "free_text", sourceFactIds: ["fact_email"], autoDeclared: false }], expected: "pass" },
    { id: "missing_source_reference", html: "<p>Collision repair</p>", declarations: [{ id: "missing_source", route: "/", text: "Collision repair", kind: "free_text", sourceFactIds: ["fact_missing"], autoDeclared: false }], expected: "fail" },
    { id: "unsupported_service", html: "<p>Frame repair</p>", declarations: [{ id: "unsupported_service", route: "/", text: "Frame repair", kind: "free_text", sourceFactIds: ["fact_service_collision"], autoDeclared: false }], expected: "fail" },
    { id: "sensitive_paraphrase", html: "<p>Lifetime guarantee</p>", declarations: [{ id: "sensitive_paraphrase", route: "/", text: "Lifetime guarantee", kind: "free_text", sourceFactIds: ["fact_proof_warranty"], autoDeclared: false }], expected: "fail" },
    { id: "negated_sensitive_substring", html: "<p>Lifetime warranty</p>", declarations: [{ id: "negated_sensitive_substring", route: "/", text: "Lifetime warranty", kind: "free_text", sourceFactIds: ["fact_proof_negated"], autoDeclared: false }], expected: "fail" },
    { id: "claim_not_rendered", html: "<p>Collision repair</p>", declarations: [{ id: "not_rendered", route: "/", text: "Paintless dent repair", kind: "free_text", sourceFactIds: ["fact_service_collision"], autoDeclared: false }], expected: "fail" },
    { id: "undeclared_price", html: "<p>Repairs from $500</p>", declarations: [], expected: "fail" },
    { id: "sdk_binding_does_not_cover_credential", html: "<h1 data-lodesta-fact-id=\"business:name\">Northstar Collision Repair</h1><p>Certified repair professionals.</p>", declarations: [], expected: "fail" },
    { id: "undeclared_longevity", html: "<p>Serving Austin for 25 years.</p>", declarations: [], expected: "fail" }
  ]
};
const hostilePrepared = prepareSiteArtifact({ authoredArtifact: hostile, buildInput, runtimeSeriesId: "site-runtime-v1" });
const hostileErrors = new Set(hostilePrepared.findings.filter((finding) => finding.severity === "error").map((finding) => finding.id));
for (const required of ["html.agent_executable", "html.forbidden_tag", "html.forbidden_attribute", "asset.unbound", "link.unsafe", "capability.form_unbound", "claim.sensitive_unsupported", "css.import", "css.url", "css.executable", "capability.form"]) {
  assert(hostileErrors.has(required), `hostile vector did not fail ${required}`);
}

const businessName = buildInput.publicFacts.find((fact) => fact.kind === "business_name");
const phone = buildInput.publicFacts.find((fact) => fact.kind === "phone");
const address = buildInput.publicFacts.find((fact) => fact.kind === "address");
const offering = buildInput.publicFacts.find((fact) => fact.kind === "offering");
assert(businessName && phone && address && offering, "walking skeleton lacks required facts");
const safe = agentAuthoredArtifactSchema.parse({
  schemaVersion: "agent-authored-artifact-v1",
  siteName: buildInput.business.name,
  designRationale: "A restrained, evidence-led service website with canonical SDK bindings and managed conversion capability.",
  sharedCss: "body{margin:0;color:#17211b;background:#fff;font-family:Arial,sans-serif}main{width:min(900px,calc(100% - 32px));margin:auto;padding:64px 0}h1{font-size:48px;letter-spacing:0}a,button,input,textarea{min-height:44px;font:inherit}",
  routes: [{
    path: "/", title: buildInput.business.name, description: "Collision repair",
    bodyHtml: `<main><h1 data-lodesta-fact-id="${businessName.id}">${businessName.value}</h1><a href="tel:${phone.value}" data-lodesta-fact-id="${phone.id}">${phone.value}</a><p>Collision Repair</p><section data-lodesta-map="location_primary"><address data-lodesta-fact-id="${address.id}">${address.value}</address><a href="https://www.google.com/maps/search/?api=1&amp;query=place_id%3AChIJ-synthetic-location" data-lodesta-map-fallback>Directions</a></section><details data-lodesta-disclosure="disclosure-process"><summary>What happens next?</summary><p>We inspect the vehicle.</p></details><form data-lodesta-form-id="${buildInput.forms[0].id}"><label>Email<input name="email" type="email" required></label><button type="submit">Send</button><p data-lodesta-form-status></p></form></main>`
  }],
  claims: [{ id: "service_claim", route: "/", text: "Collision Repair", kind: "free_text", sourceFactIds: [offering.id], autoDeclared: false }],
  capabilityBindings: [
    { id: "estimate_form", kind: "form", route: "/", config: { formId: buildInput.forms[0].id } },
    { id: "primary_map", kind: "map", route: "/", config: { locationId: "location_primary" } },
    { id: "process_disclosure", kind: "disclosure", route: "/", config: { disclosureId: "disclosure-process" } }
  ]
});
const safePrepared = prepareSiteArtifact({ authoredArtifact: safe, buildInput, runtimeSeriesId: "site-runtime-v1" });
const safeErrors = safePrepared.findings.filter((finding) => finding.severity === "error");
assert(safeErrors.length === 0, `safe artifact failed: ${safeErrors.map((finding) => finding.id).join(", ")}`);
assert(safePrepared.claims.some((claim) => claim.autoDeclared && claim.sourceFactIds.includes(phone.id)), "SDK phone value was not auto-declared");
assert(safePrepared.claims.some((claim) => claim.autoDeclared && claim.sourceFactIds.includes(address.id)), "SDK map address was not auto-declared");
assert(safePrepared.claims.some((claim) => claim.kind === "structured_data" && claim.sourceFactIds.includes(businessName.id)), "JSON-LD business name lacks a source-bound claim");
assert(safePrepared.capabilityBindings.some((binding) => binding.kind === "analytics"), "platform analytics capability was not recorded in the artifact");
assert(safePrepared.files.every((file) => !file.bytes.toString("utf8").includes("<script>alert")), "hostile script survived preparation");
const containedCopy = "careful vehicle surface inspection documents visible damage before the repair plan is prepared for the customer";
const asymmetricRepetition = prepareSiteArtifact({
  authoredArtifact: agentAuthoredArtifactSchema.parse({
    schemaVersion: "agent-authored-artifact-v1",
    siteName: "Similarity verification",
    designRationale: "A deterministic two-route vector that proves smaller-page containment and duplicate metadata fail the objective gate.",
    sharedCss: "body{font:16px Arial}main{padding:40px}",
    routes: [
      { path: "/", title: "Duplicate metadata", description: "The same deterministic metadata value", bodyHtml: `<main><h1>Shared route heading</h1><p>${containedCopy}</p><a href="/contained">Details</a> <p>Additional detailed context about scheduling materials preparation communication documentation finishing delivery follow up records estimates photographs timing approvals coordination quality controls and next steps.</p></main>` },
      { path: "/contained", title: "Duplicate metadata", description: "The same deterministic metadata value", bodyHtml: `<main><h1>Shared route heading</h1><p>${containedCopy}</p><a href="/contained">Details</a></main>` }
    ],
    claims: [],
    capabilityBindings: []
  }),
  buildInput,
  runtimeSeriesId: "site-runtime-v1"
});
const asymmetricMetric = asymmetricRepetition.qualityMetrics.routeSimilarity.find((metric) => metric.left === "/" && metric.right === "/contained");
assert(asymmetricMetric && asymmetricMetric.jaccard < 0.9 && asymmetricMetric.smallerPageContainment >= 0.95, `deterministic similarity metrics did not catch asymmetric page containment: ${JSON.stringify(asymmetricRepetition.qualityMetrics.routeSimilarity)}`);
assert(asymmetricRepetition.findings.some((finding) => finding.id === "route.repetitive_content"), "asymmetric route repetition did not fail closed");
assert(asymmetricRepetition.findings.some((finding) => finding.id === "metadata.title_duplicate") && asymmetricRepetition.findings.some((finding) => finding.id === "metadata.description_duplicate"), "duplicate route metadata did not fail closed");
const serviceOffering = buildInput.business.offerings[0];
assert(serviceOffering, "synthetic V3 input has no offering for service-page verification");
const serviceGateInput = sitePublicBuildInputV3Schema.parse({
  ...buildInput,
  intent: {
    ...buildInput.intent,
    pageRequirements: [
      ...buildInput.intent.pageRequirements,
      { id: "page_service_gate", purpose: "service", slug: "service-gate", title: "Service detail", required: true, offeringId: serviceOffering.id }
    ]
  }
});
const unboundServicePage = prepareSiteArtifact({
  authoredArtifact: agentAuthoredArtifactSchema.parse({
    ...safe,
    routes: [
      { ...safe.routes[0], bodyHtml: safe.routes[0].bodyHtml.replace("</main>", '<a href="/service-gate">Service detail</a></main>') },
      { path: "/service-gate", title: "Service detail", description: "Detailed service information", bodyHtml: `<main><h1>${serviceOffering.name}</h1><p>Contact the team to discuss this service.</p><a href="/">Home</a></main>` }
    ]
  }),
  buildInput: serviceGateInput,
  runtimeSeriesId: "site-runtime-v1"
});
assert(unboundServicePage.findings.some((finding) => finding.id === "claim.service_detail_source"), "service page without offering evidence bindings passed the objective gate");
const preparedCss = safePrepared.files.find((file) => file.path === "site.css")?.bytes.toString("utf8") ?? "";
assert(preparedCss.startsWith(platformCapabilityStyles), "finalized CSS does not begin with the canonical platform capability styles");
assert(preparedCss.endsWith(safe.sharedCss), "agent CSS no longer follows platform capability styles");
assert(formatPhoneForDisplay("+15125550142") === "(512) 555-0142", "SDK presentation did not format a valid canonical US phone");
assert(formatPhoneForDisplay("+442079460958") === "+442079460958" && formatPhoneForDisplay("call the front desk") === "call the front desk", "SDK presentation changed an international or unknown phone value");
const orderedHours = orderedLocationHours(buildInput.business.locations[0]?.hours);
assert(orderedHours.map((item) => item.label).join("|") === "Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|By appointment", "managed location hours are not Monday-first with aliases normalized and unknown labels last");
assert(buildInput.business.locations[0]?.googlePlaceId === "ChIJ-synthetic-location", "synthetic public build input omitted the Google place ID");

const addPageObjective = siteEditObjectiveV1Schema.parse({
  schemaVersion: "site-edit-objective-v1",
  id: "objective_add_page_test",
  runId: "run_add_page_test",
  sessionId: "session_add_page_test",
  siteId: buildInput.siteId,
  requestId: "request_add_page_test",
  instruction: "Add /gallery and link it from navigation.",
  taskKind: "page_edit",
  operation: "add_page",
  requestedOutcome: "Add a navigable gallery page.",
  baselineRoutes: ["/"],
  baselineCapabilities: safePrepared.capabilityBindings.map((binding) => binding.id),
  baselineCapabilityBindings: safePrepared.capabilityBindings.map(({ id, kind, route }) => ({ id, kind, route })),
  ownerSpecifiedRoutes: ["/gallery"],
  checks: [
    { kind: "preserve_route", route: "/" },
    ...safePrepared.capabilityBindings.map((binding) => ({ kind: "preserve_capability" as const, capabilityId: binding.id })),
    { kind: "route_present", route: "/gallery" },
    { kind: "new_routes_navigable" }
  ],
  producerVersion: "verification",
  modelId: "verification",
  createdAt: buildInput.createdAt
});
const missingPagePrepared = prepareSiteArtifact({ authoredArtifact: safe, buildInput, runtimeSeriesId: "site-runtime-v1" });
const missingPageChecks = applyEditObjective(missingPagePrepared, addPageObjective);
assert(missingPageChecks.some((check) => check.kind === "route_present" && !check.passed), "missing requested route passed the edit objective");
const addedPagePrepared = prepareSiteArtifact({
  authoredArtifact: agentAuthoredArtifactSchema.parse({
    ...safe,
    routes: [
      { ...safe.routes[0], bodyHtml: safe.routes[0].bodyHtml.replace("</main>", "<a href=\"/gallery\">Gallery</a></main>") },
      { path: "/gallery", title: "Gallery", description: "A repair-work gallery", bodyHtml: "<main><h1>Repair gallery</h1><p>See completed work.</p></main>" }
    ]
  }),
  buildInput,
  runtimeSeriesId: "site-runtime-v1"
});
const addedPageChecks = applyEditObjective(addedPagePrepared, addPageObjective);
assert(addedPageChecks.every((check) => check.passed), `valid page addition failed objective checks: ${JSON.stringify(addedPageChecks)}`);

const normalizedSidecars = agentAuthoredArtifactSchema.parse(normalizeAgentAuthoredArtifact({
  ...safe,
  claims: [{ text: "Collision Repair", factIds: [offering.id] }],
  capabilityBindings: { form: { formId: buildInput.forms[0].id } }
}));
assert(normalizedSidecars.claims[0]?.route === "/" && normalizedSidecars.claims[0]?.kind === "free_text", "authored claim shorthand was not normalized");
assert(normalizedSidecars.capabilityBindings.some((binding) => binding.kind === "form" && binding.config.formId === buildInput.forms[0].id), "SDK form hook did not derive its capability binding");

const parityInput = sitePublicBuildInputV3Schema.parse({
  ...buildInput,
  business: {
    ...buildInput.business,
    proof: [{
      id: "proof_warranty",
      kind: "warranty",
      status: "confirmed",
      publicText: "Limited lifetime paint warranty",
      verbatim: true,
      sourceFactIds: ["fact_proof_warranty"],
      confirmedAt: buildInput.createdAt
    }]
  },
  publicFacts: [
    ...buildInput.publicFacts,
    {
      id: "fact_email", kind: "email", label: "Email", value: "service@northstar.example", publicEligible: true,
      source: { factId: "fact_email", sourceSnapshotId: "source_owner", observedAt: "2026-07-20T00:00:00.000Z", confidence: 1, ownerConfirmed: true }
    },
    {
      id: "fact_proof_warranty", kind: "proof", label: "Warranty", value: "Limited lifetime paint warranty", publicEligible: true,
      source: { factId: "fact_proof_warranty", sourceSnapshotId: "source_owner", observedAt: "2026-07-20T00:00:00.000Z", confidence: 1, ownerConfirmed: true }
    },
    {
      id: "fact_proof_negated", kind: "proof", label: "Former warranty", value: "We no longer offer a lifetime warranty", publicEligible: true,
      source: { factId: "fact_proof_negated", sourceSnapshotId: "source_owner", observedAt: "2026-07-20T00:00:00.000Z", confidence: 1, ownerConfirmed: true }
    }
  ]
});
const claimValidator = new ArtifactClaimValidatorV1();
const formattedSdkResult = claimValidator.validate({
  routes: [{
    path: "/",
    html: `<main><a data-lodesta-fact-id="${phone.id}" href="tel:+15125550142">(512) 555-0142</a><dl data-lodesta-fact-id="fact_hours"><div><dt>Monday</dt><dd>8:00 AM-5:30 PM</dd></div><div><dt>Saturday</dt><dd>Closed</dd></div><div><dt>By appointment</dt><dd>Evenings</dd></div></dl></main>`
  }],
  declarations: [],
  buildInput
});
assert(formattedSdkResult.status === "pass", `formatted SDK bindings failed claim validation: ${formattedSdkResult.findings.map((finding) => finding.message).join("; ")}`);
assert(formattedSdkResult.declarations.some((claim) => claim.sourceFactIds.includes(phone.id)), "formatted SDK phone did not produce a source-bound declaration");
assert(formattedSdkResult.declarations.filter((claim) => claim.sourceFactIds.includes("fact_hours")).map((claim) => claim.text).sort().join("|") === "8:00 AM-5:30 PM|Closed|Evenings", "structured SDK hours did not declare every distinct rendered canonical value");
for (const parityCase of claimParity.cases) {
  const result = claimValidator.validate({
    routes: [{ path: "/", html: parityCase.html }],
    declarations: parityCase.declarations as Parameters<ArtifactClaimValidatorV1["validate"]>[0]["declarations"],
    buildInput: parityInput
  });
  assert(result.status === parityCase.expected, `claim parity case ${parityCase.id} expected ${parityCase.expected}, received ${result.status}`);
}
const metadataClaimResult = claimValidator.validate({
  routes: [{ path: "/", title: "Five-star collision repair", description: "Lifetime warranty", html: "<main><h1>Collision repair</h1></main>" }],
  declarations: [],
  buildInput: parityInput
});
assert(metadataClaimResult.status === "fail" && metadataClaimResult.findings.some((finding) => finding.id === "claim.sensitive_unsupported"), "unsupported metadata claims bypassed factual validation");

const disabledCapabilityInput = sitePublicBuildInputV3Schema.parse({
  ...buildInput,
  intent: { ...buildInput.intent, enabledCapabilities: ["forms", "analytics"] }
});
const disabledCapabilityPrepared = prepareSiteArtifact({ authoredArtifact: safe, buildInput: disabledCapabilityInput, runtimeSeriesId: "site-runtime-v1" });
assert(disabledCapabilityPrepared.findings.some((finding) => finding.id === "capability.map"), "disabled map capability was accepted");
assert(disabledCapabilityPrepared.findings.some((finding) => finding.id === "capability.disclosure"), "disabled disclosure capability was accepted");

const productionVertical = verticalContextFor("auto_body");
assert(productionVertical.status === "active", "production vertical module did not load");
const syntheticVertical = verticalContextFor("synthetic_test_vertical", { includeTestModules: true });
assert(syntheticVertical.status === "test_only", "synthetic vertical did not traverse the shared module registry");
for (const module of [productionVertical, syntheticVertical]) {
  await readFile(module.skillRef, "utf8");
  await readFile(module.evaluationRef, "utf8");
}
assert(matchVerticalContext("Collision repair and paintless dent repair")?.id === "auto_body", "production vertical classification did not resolve through module evidence");
assert(matchVerticalContext("Synthetic test module", { includeTestModules: true })?.id === syntheticVertical.id, "synthetic classification did not use the shared matcher");
assert(!matchVerticalContext("Landscape maintenance, tree trimming, irrigation, and lawn care"), "unsupported generic local business matched the auto-body module");
let unsupported = false;
try { verticalContextFor("synthetic_test_vertical"); } catch { unsupported = true; }
assert(unsupported, "test-only vertical leaked into the production registry");
const syntheticState = businessStateV3Schema.parse({
  schemaVersion: "business-state-v3",
  businessId: buildInput.businessId,
  siteId: buildInput.siteId,
  revision: buildInput.businessStateRevision,
  stateHash: `sha256:${"6".repeat(64)}`,
  updatedAt: buildInput.createdAt,
  identity: { name: buildInput.business.name, description: buildInput.business.description, categories: ["Synthetic test module"] },
  contacts: buildInput.business.contacts,
  locations: buildInput.business.locations,
  serviceAreas: buildInput.business.serviceAreas,
  offerings: [],
  proof: [],
  assets: [],
  links: [],
  facts: buildInput.publicFacts.filter((fact) => fact.kind === "business_name")
});
const syntheticProjection = createPublicBuildInput({
  id: "input_synthetic_projection",
  state: syntheticState,
  intent: buildInput.intent,
  forms: buildInput.forms,
  domainContext: syntheticVertical,
  sourceSnapshotIds: buildInput.sourceSnapshotIds,
  createdAt: buildInput.createdAt,
  runtimeSeriesId: buildInput.capabilityConfiguration.trustedRuntimeSeries
});
assert(syntheticProjection.domainContext?.id === syntheticVertical.id, "synthetic module did not pass through the shared public projection");
assert(!syntheticProjection.business.contacts.phone && syntheticProjection.business.locations.length === 0, "canonical fields without eligible source facts bypassed the public projection");
const neutralProjection = createPublicBuildInput({
  id: "input_neutral_projection",
  state: syntheticState,
  intent: buildInput.intent,
  forms: buildInput.forms,
  sourceSnapshotIds: buildInput.sourceSnapshotIds,
  createdAt: buildInput.createdAt
});
assert(!neutralProjection.domainContext, "unmatched local business unexpectedly required a domain context");

const ineligibleParallelFact = {
  id: "fact_phone_enrichment_only", kind: "phone" as const, label: "Unconfirmed enrichment phone", value: "512-555-9999", publicEligible: false,
  source: { factId: "fact_phone_enrichment_only", sourceSnapshotId: "source_places", observedAt: buildInput.createdAt, confidence: 0.72, ownerConfirmed: false }
};
const ineligibleParallelState = businessStateV3Schema.parse({
  ...syntheticState,
  contacts: { ...syntheticState.contacts, phone: ineligibleParallelFact.value },
  facts: [...syntheticState.facts, ineligibleParallelFact]
});
const ineligibleParallelProjection = createPublicBuildInput({
  id: "input_ineligible_parallel_projection", state: ineligibleParallelState, intent: buildInput.intent, forms: buildInput.forms,
  domainContext: syntheticVertical, sourceSnapshotIds: buildInput.sourceSnapshotIds, createdAt: buildInput.createdAt
});
assert(!ineligibleParallelProjection.business.contacts.phone, "ineligible contact leaked through the canonical-state convenience field");
assert(!ineligibleParallelProjection.publicFacts.some((fact) => fact.id === ineligibleParallelFact.id), "ineligible enrichment fact leaked into the public fact list");

const observedProofFact = {
  id: "fact_proof_observed", kind: "proof" as const, label: "Observed testimonial", value: "They explained each repair clearly and kept us informed throughout the process.", publicEligible: false,
  source: { factId: "fact_proof_observed", sourceSnapshotId: "source_website", sourceBlockId: "source_block_testimonial", sourceUrl: "https://example.com/reviews", observedAt: buildInput.createdAt, confidence: 0.65, ownerConfirmed: false }
};
const observedProofState = businessStateV3Schema.parse({
  ...syntheticState,
  facts: [...syntheticState.facts, observedProofFact],
  proof: [{ id: "proof_observed", kind: "testimonial", status: "observed", publicText: observedProofFact.value, verbatim: true, sourceFactIds: [observedProofFact.id] }]
});
const observedProofProjection = createPublicBuildInput({
  id: "input_observed_proof_projection", state: observedProofState, intent: buildInput.intent, forms: buildInput.forms,
  domainContext: syntheticVertical, sourceSnapshotIds: buildInput.sourceSnapshotIds, createdAt: buildInput.createdAt
});
assert(!observedProofProjection.publicFacts.some((fact) => fact.id === observedProofFact.id), "unconfirmed proof fact leaked into the public projection");
assert(observedProofProjection.business.proof.length === 0, "unconfirmed proof item leaked into the public projection");

const thirdPartyProofState = businessStateV3Schema.parse({
  ...observedProofState,
  facts: observedProofState.facts.map((fact) => fact.id === observedProofFact.id ? {
    ...fact,
    publicEligible: true,
    source: { ...fact.source, evidenceClass: "third_party" as const }
  } : fact),
  proof: observedProofState.proof.map((item) => ({ ...item, status: "confirmed" as const, confirmedAt: buildInput.createdAt }))
});
const thirdPartyProofProjection = createPublicBuildInput({
  id: "input_third_party_proof_projection", state: thirdPartyProofState, intent: buildInput.intent, forms: buildInput.forms,
  domainContext: syntheticVertical, sourceSnapshotIds: buildInput.sourceSnapshotIds, createdAt: buildInput.createdAt
});
assert(!thirdPartyProofProjection.publicFacts.some((fact) => fact.id === observedProofFact.id), "third-party evidence automatically supported a public claim");
assert(thirdPartyProofProjection.business.proof.length === 0, "third-party proof was not excluded from the V3 public projection");

const confirmedProofState = businessStateV3Schema.parse({
  ...observedProofState,
  facts: observedProofState.facts.map((fact) => fact.id === observedProofFact.id ? { ...fact, publicEligible: true, source: { ...fact.source, ownerConfirmed: true } } : fact),
  proof: observedProofState.proof.map((item) => ({ ...item, status: "confirmed" as const, confirmedAt: buildInput.createdAt }))
});
const confirmedProofProjection = createPublicBuildInput({
  id: "input_confirmed_proof_projection", state: confirmedProofState, intent: buildInput.intent, forms: buildInput.forms,
  domainContext: syntheticVertical, sourceSnapshotIds: buildInput.sourceSnapshotIds, createdAt: buildInput.createdAt
});
assert(confirmedProofProjection.business.proof[0]?.publicText === observedProofFact.value, "confirmed verbatim proof did not enter the public projection");
let partialProofRejected = false;
try {
  createPublicBuildInput({
    id: "input_partial_proof_projection",
    state: businessStateV3Schema.parse({ ...confirmedProofState, proof: confirmedProofState.proof.map((item) => ({ ...item, publicText: "They explained each repair clearly." })) }),
    intent: buildInput.intent, forms: buildInput.forms, domainContext: syntheticVertical,
    sourceSnapshotIds: buildInput.sourceSnapshotIds, createdAt: buildInput.createdAt
  });
} catch { partialProofRejected = true; }
assert(partialProofRejected, "partial testimonial text was accepted as verbatim source proof");

const syntheticPrepared = prepareSiteArtifact({
  authoredArtifact: agentAuthoredArtifactSchema.parse({
    schemaVersion: "agent-authored-artifact-v1",
    siteName: syntheticProjection.business.name,
    designRationale: "A minimal synthetic artifact that proves module-owned structured data traverses the neutral finalizer.",
    sharedCss: "body{margin:0;color:#111;background:#fff;font:18px/1.5 Arial,sans-serif}main{padding:48px}",
    routes: [{ path: "/", title: syntheticProjection.business.name, description: "Synthetic module test", bodyHtml: `<main><h1 data-lodesta-fact-id="${syntheticState.facts[0].id}">${syntheticProjection.business.name}</h1></main>` }],
    claims: [],
    capabilityBindings: []
  }),
  buildInput: syntheticProjection,
  runtimeSeriesId: "site-runtime-v1"
});
assert(syntheticPrepared.files.some((file) => file.bytes.toString("utf8").includes('"@type":"LocalBusiness"')), "neutral finalization ignored the pinned module structured-data type");

assert(unsupportedCapabilityDemands("Add customer login and online payments").length === 2, "unsupported application capabilities were not blocked");
assert(unsupportedCapabilityDemands("Remove the login language and make the hero warmer").length === 0, "capability policy blocked a removal request");
assert(unsupportedCapabilityDemands("Make the contact page more visually distinctive").length === 0, "capability policy blocked a supported design edit");
assert(controlPlaneChangePayloadSchema.parse({ kind: "add_offering", name: "ADAS Calibration", pageMode: "dedicated" }).kind === "add_offering", "typed control plane rejected an owner-added custom service");
assert(canAccessAgentSession({ actorId: "owner_a", isOperator: false }, "owner_a"), "an owner could not access their own agent session");
assert(!canAccessAgentSession({ actorId: "owner_b", isOperator: false }, "owner_a"), "a same-site co-owner could access another owner's agent session");
assert(canAccessAgentSession({ actorId: "operator", isOperator: true }, "owner_a"), "an operator could not access an owner session for support");
const priorRequireAuth = process.env.LODESTA_REQUIRE_AUTH;
process.env.LODESTA_REQUIRE_AUTH = "true";
const unauthorizedReadiness = await readSiteReadinessRoute(new Request("http://127.0.0.1/api/sites/missing/readiness"), { params: Promise.resolve({ siteId: "missing" }) });
const unauthorizedReview = await reviewSiteVersionRoute(new Request("http://127.0.0.1/api/site-versions/missing/review", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ status: "approved", note: "Unauthorized verification request." })
}), { params: Promise.resolve({ versionId: "missing" }) });
assert(unauthorizedReadiness.status === 401, "readiness endpoint did not require an owner or operator");
assert(unauthorizedReview.status === 401, "exact-version review endpoint did not require an operator");
if (priorRequireAuth === undefined) delete process.env.LODESTA_REQUIRE_AUTH;
else process.env.LODESTA_REQUIRE_AUTH = priorRequireAuth;
const validRedirect = validateSiteRedirectInput({ siteId: "site_redirect_test", sourcePath: "/old-service/", destinationPath: "/services/collision-repair" }, ["/", "/services/collision-repair"]);
assert(validRedirect.sourcePath === "/old-service" && validRedirect.destinationPath === "/services/collision-repair", "site redirect paths were not normalized");
assert(redirectsStrandedByRoutes([{ id: "redirect_test", ...validRedirect, status: "active", createdAt: buildInput.createdAt, updatedAt: buildInput.createdAt }], ["/"]).length === 1, "publish validation did not detect a stranded active redirect");
assert(redirectsStrandedByRoutes([{ id: "redirect_test", ...validRedirect, status: "active", createdAt: buildInput.createdAt, updatedAt: buildInput.createdAt }], ["/", validRedirect.sourcePath]).length === 0, "a restored live source path was incorrectly treated as stranded");
for (const invalid of [
  { sourcePath: "/", destinationPath: "/services/collision-repair" },
  { sourcePath: "/old-service", destinationPath: "/missing" },
  { sourcePath: "/services/collision-repair", destinationPath: "/" },
  { sourcePath: "/old-service", destinationPath: "/old-service" }
]) {
  let rejected = false;
  try { validateSiteRedirectInput({ siteId: "site_redirect_test", ...invalid }, ["/", "/services/collision-repair"]); } catch { rejected = true; }
  assert(rejected, `invalid site redirect was accepted: ${invalid.sourcePath} -> ${invalid.destinationPath}`);
}
const hostileSourceFindings = validateWorkspaceSourcePolicy([
  { path: "src/site.tsx", content: `import React from "react"; import { Fact } from "../platform/sdk"; import { readFile } from "node:fs"; fetch("https://example.com"); const unsafe = React["constr" + "uctor"]; export const siteDefinition = { routes: [{ element: <main><link rel="preload" href="asset://asset_1" />Collision repair&amp;paint</main> }] };` },
  { path: "src/styles.css", content: `@import url("https://example.com/site.css");` }
]);
for (const id of ["source.import_module", "source.network", "source.code_generation", "source.executable_markup", "source.escaped_entity", "source.css_import", "source.css_external_url"]) {
  assert(hostileSourceFindings.some((finding) => finding.id === id), `generated source policy did not reject ${id}`);
}
const ordinaryBusinessCopyFindings = validateWorkspaceSourcePolicy([
  { path: "src/site.tsx", content: `import React from "react"; import { Fact } from "../platform/sdk"; export const siteDefinition = { routes: [{ path: "/", title: "Our process", description: "A clear repair process", element: <main><h1>Our repair process</h1><p>Document damage before work begins.</p></main> }] };` },
  { path: "src/styles.css", content: `body { color: #111; background: #fff; }` }
]);
assert(!ordinaryBusinessCopyFindings.some((finding) => finding.id === "source.runtime_environment" || finding.id === "source.browser_runtime"), "source policy treated customer-facing business copy as executable runtime access");

const repositoryDir = await mkdtemp(join(tmpdir(), "lodesta-verified-build-"));
try {
  const repository = new LocalSitePlatformRepository(join(repositoryDir, "repository.json"));
  const operations = new LocalPlatformOperationsRepository(join(repositoryDir, "operations.json"));
  const inventoryStore = new LocalArtifactBlobStore(join(repositoryDir, "inventory-blobs"));
  for (const blob of [
    { key: "site-assets/business_test/asset.webp", bytes: Buffer.from("asset"), contentType: "image/webp" },
    { key: "site-artifacts/site_test/artifact_test/index.html", bytes: Buffer.from("artifact"), contentType: "text/html" },
    { key: "legacy-v3/orphan.bin", bytes: Buffer.from("legacy"), contentType: "application/octet-stream" }
  ]) {
    await inventoryStore.putImmutable({ ...blob, contentHash: sha256(blob.bytes) });
  }
  const firstInventoryPage = await inventoryStore.listPage({ prefix: "site-", limit: 1 });
  assert(firstInventoryPage.objects.length === 1 && firstInventoryPage.truncated && firstInventoryPage.cursor, "local blob inventory did not paginate");
  const secondInventoryPage = await inventoryStore.listPage({ prefix: "site-", limit: 1, cursor: firstInventoryPage.cursor });
  assert(secondInventoryPage.objects.length === 1 && !secondInventoryPage.truncated, "local blob inventory cursor did not advance");
  const inventory = (await inventoryStore.listPage()).objects;
  const blobAudit = buildArtifactBlobAudit({
    inventory: inventory.map((object) => ({ store: "artifact" as const, ...object })),
    referencedObjects: [
      { store: "artifact", key: "site-assets/business_test/asset.webp" },
      { store: "workspace", key: "workspace-backups/missing.tar.gz" }
    ] as const,
    createdAt: "2026-07-20T00:00:00.000Z"
  });
  assert(blobAudit.missingReferencedObjects[0]?.key === "workspace-backups/missing.tar.gz", "blob audit did not fail closed on a missing retained object");
  assert(blobAudit.orphanedManagedObjects[0]?.key === "site-artifacts/site_test/artifact_test/index.html", "blob audit did not classify a managed orphan");
  assert(blobAudit.unknownPrefixObjects[0]?.key === "legacy-v3/orphan.bin", "blob audit did not preserve an unknown-prefix object");
  assert(artifactBlobAuditConfirmation(blobAudit) === `delete-orphan-blobs:${blobAudit.reportHash}`, "blob audit confirmation token drifted");
  let missingBlocked = false;
  try { assertArtifactBlobAuditDeletable(blobAudit); } catch { missingBlocked = true; }
  assert(missingBlocked, "blob audit allowed deletion while a retained object was missing");
  assert(parseArtifactBlobAuditReport(JSON.parse(JSON.stringify(blobAudit))).reportHash === blobAudit.reportHash, "blob audit report did not round-trip");
  const staleBlobAudit = JSON.parse(JSON.stringify(blobAudit)) as { inventoryObjects: Array<{ bytes: number }> };
  staleBlobAudit.inventoryObjects[0].bytes += 1;
  let staleBlocked = false;
  try { parseArtifactBlobAuditReport(staleBlobAudit); } catch { staleBlocked = true; }
  assert(staleBlocked, "blob audit accepted a stale or modified report");
  const backupKey = `workspace-backups/${"a".repeat(64)}.tar.gz`;
  const sidecarKey = workspaceSourceSidecarKey(backupKey);
  const overlapHash = sha256("archive");
  const overlapAudit = buildArtifactBlobAudit({
    inventory: [
      { store: "artifact", key: backupKey, bytes: 7, contentHash: overlapHash },
      { store: "workspace", key: backupKey, bytes: 7, contentHash: overlapHash },
      { store: "artifact", key: sidecarKey, bytes: 12 }
    ],
    referencedObjects: [
      { store: "workspace", key: backupKey },
      { store: "artifact", key: sidecarKey }
    ],
    rollbackOverlap: [{
      key: backupKey,
      bytes: 7,
      contentHash: overlapHash,
      source: { store: "artifact", key: backupKey },
      destination: { store: "workspace", key: backupKey }
    }],
    createdAt: "2026-07-20T00:00:00.000Z"
  });
  assert(!overlapAudit.orphanedManagedObjects.some((object) => object.key === sidecarKey), "retained workspace source sidecar was classified as deletable");
  assert(overlapAudit.counts.rollbackOverlap === 1 && overlapAudit.counts.overlapMismatch === 0, "location-aware audit did not preserve equal rollback overlap copies");
  const maintenanceStore = new LocalArtifactBlobMaintenanceStore({
    artifact: join(repositoryDir, "maintenance-artifact"),
    workspace: join(repositoryDir, "maintenance-workspace")
  });
  await maintenanceStore.putImmutable("workspace", { key: backupKey, bytes: Buffer.from("archive"), contentType: "application/gzip", contentHash: overlapHash });
  assert((await maintenanceStore.listPage("workspace", { prefix: "workspace-backups/", limit: 1 })).objects[0]?.store === "workspace", "local two-store inventory lost its location");
  const capacityRepository = new LocalSitePlatformRepository(join(repositoryDir, "capacity-repository.json"));
  for (let index = 1; index <= 5; index += 1) {
    await capacityRepository.saveAgentRun(siteAgentRunV2Schema.parse({
      schemaVersion: "site-agent-run-v2",
      id: `run_capacity_${index}`,
      sessionId: `session_capacity_${index}`,
      siteId: `site_capacity_${index}`,
      publicBuildInputId: `input_capacity_${index}`,
      origin: "system",
      requestedBy: "system",
      publishAfterSuccess: false,
      kind: "initial_build",
      status: "queued",
      stage: "queued",
      modelId: "verification",
      attempt: 0,
      skillVersions: {},
      attempts: [],
      usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, costEstimateStatus: "unavailable", durationMs: 0 },
      startedAt: `2026-07-20T00:00:0${index}.000Z`
    }));
  }
  for (let index = 1; index <= 4; index += 1) assert(await capacityRepository.claimAgentRun(`run_capacity_${index}`), `capacity slot ${index} was not claimed`);
  assert(!(await capacityRepository.claimAgentRun("run_capacity_5")), "atomic run capacity admitted more than four running runs");
  const cutoverToken = `sha256:${"c".repeat(64)}`;
  assert(await capacityRepository.acquireMaintenanceLease("workspace_storage_cutover", cutoverToken, "2026-07-20T00:00:00.000Z", "2026-07-20T01:00:00.000Z"), "workspace cutover lease was not acquired");
  assert(!(await capacityRepository.claimAgentRun("run_capacity_5")), "workspace cutover lease did not block atomic run claim");
  const redirect = await operations.upsertRedirect(validRedirect);
  assert((await operations.resolveRedirect(validRedirect.siteId, validRedirect.sourcePath))?.id === redirect.id, "active site redirect was not resolvable");
  await operations.setRedirectStatus({ redirectId: redirect.id, status: "inactive" });
  assert(await operations.resolveRedirect(validRedirect.siteId, validRedirect.sourcePath) === null, "inactive site redirect remained resolvable");
  const site = platformSiteRecordSchema.parse({
    id: "site_atomic_test", businessId: "business_atomic_test", slug: "atomic-test", status: "draft",
    createdAt: "2026-07-20T00:00:00.000Z", updatedAt: "2026-07-20T00:00:00.000Z"
  });
  await repository.createSite(site);
  await repository.saveVerticalDemandEvent(verticalDemandEventV1Schema.parse({
    schemaVersion: "vertical-demand-event-v1",
    id: "vertical_demand_atomic_test",
    sourceUrl: "https://landscaping.example/",
    observedVertical: "unsupported",
    requestedBy: "verification",
    status: "open",
    createdAt: "2026-07-20T00:00:30.000Z"
  }));
  assert((await repository.listVerticalDemandEvents("open")).length === 1, "unmatched domain demand was not retained independently of site state");
  const revision = siteWorkspaceRevisionV1Schema.parse({
    schemaVersion: "site-workspace-revision-v1", id: "workspace_atomic_test", siteId: site.id, revisionNumber: 1,
    sourceHash: `sha256:${"1".repeat(64)}`, sourceArchiveKey: `workspace-backups/${"1".repeat(64)}.tar.gz`,
    files: [{ path: "src/site.tsx", contentHash: `sha256:${"2".repeat(64)}`, bytes: 100 }],
    createdAt: "2026-07-20T00:01:00.000Z", createdBy: { kind: "system", id: "verification" }
  });
  const artifactBase = {
    schemaVersion: "site-build-artifact-v1" as const, id: "artifact_atomic_test", siteId: site.id,
    workspaceRevisionId: revision.id, publicBuildInputId: "input_atomic_test", createdAt: "2026-07-20T00:02:00.000Z",
    artifactHash: `sha256:${"3".repeat(64)}`, storagePrefix: "site-artifacts/site_atomic_test/artifact_atomic_test",
    files: [{ path: "index.html", contentType: "text/html", contentHash: `sha256:${"4".repeat(64)}`, bytes: 200, storageKey: "site-artifacts/site_atomic_test/artifact_atomic_test/index.html" }],
    routes: [{ path: "/", htmlFile: "index.html", title: "Atomic Test", description: "Atomic build test" }],
    claims: [], capabilityBindings: [], runtimeSeriesId: "site-runtime-v1", runtimePatchAtFinalization: "runtime_patch_test",
    toolchainVersion: "verification", sandboxImageDigest: `sha256:${"5".repeat(64)}`
  };
  const failedArtifact = siteBuildArtifactV1Schema.parse({
    ...artifactBase,
    qa: { hardGate: "failed", checkedAt: "2026-07-20T00:02:00.000Z", routesChecked: 1, linksChecked: 0, findings: [], screenshotKeys: [] }
  });
  let rejectedFailedBuild = false;
  try { await repository.commitVerifiedBuild({ revision, artifact: failedArtifact }); } catch { rejectedFailedBuild = true; }
  assert(rejectedFailedBuild && !(await repository.getSite(site.id))?.currentWorkspaceRevisionId, "failed build advanced the canonical workspace");
  const passedArtifact = siteBuildArtifactV1Schema.parse({
    ...artifactBase,
    qa: { hardGate: "passed", checkedAt: "2026-07-20T00:02:00.000Z", routesChecked: 1, linksChecked: 0, findings: [], screenshotKeys: [] }
  });
  await repository.commitVerifiedBuild({ revision, artifact: passedArtifact });
  assert((await repository.getSite(site.id))?.currentWorkspaceRevisionId === revision.id, "verified build did not atomically advance the workspace");
  assert((await repository.getBuildArtifact(passedArtifact.id))?.id === passedArtifact.id, "verified build did not atomically retain its artifact");
  const queuedRun = siteAgentRunV2Schema.parse({
    schemaVersion: "site-agent-run-v2", id: "run_atomic_claim", sessionId: "session_atomic_claim", siteId: site.id,
    publicBuildInputId: "input_atomic_claim", origin: "system", requestedBy: "verification", publishAfterSuccess: false,
    kind: "focused_edit", status: "queued", stage: "queued", exactParentRevisionId: revision.id,
    modelId: "verification", attempt: 0, skillVersions: {}, attempts: [],
    usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, costEstimateStatus: "unavailable", durationMs: 0 },
    startedAt: "2026-07-20T00:03:00.000Z"
  });
  await repository.saveAgentRun(queuedRun);
  const claimed = await repository.claimAgentRun(queuedRun.id);
  assert(claimed?.status === "running" && claimed.attempt === 1 && Boolean(claimed.heartbeatAt), "queued run was not atomically claimed");
  assert(await repository.claimAgentRun(queuedRun.id) === undefined, "a running job was claimed twice");

  const coalesceSite = platformSiteRecordSchema.parse({
    id: buildInput.siteId, businessId: buildInput.businessId, slug: "coalesce-test", status: "draft",
    createdAt: buildInput.createdAt, updatedAt: buildInput.createdAt
  });
  await repository.createSite(coalesceSite);
  await repository.savePublicBuildInput(buildInput);
  await repository.setCurrentPublicBuildInput(coalesceSite.id, buildInput.id);
  const coalesceSession = siteAgentSessionV1Schema.parse({
    schemaVersion: "site-agent-session-v1", id: "session_coalesce_test", siteId: coalesceSite.id, ownerId: "owner_coalesce_test",
    status: "active", publicBuildInputId: buildInput.id, sandboxProvider: "cloudflare", leaseTokenHash: `sha256:${"7".repeat(64)}`,
    leaseExpiresAt: "2026-07-20T01:00:00.000Z", rotateAt: "2026-07-20T02:00:00.000Z",
    createdAt: "2026-07-20T00:00:00.000Z", updatedAt: "2026-07-20T00:00:00.000Z"
  });
  await repository.saveAgentSession(coalesceSession);
  const discussionSession = siteAgentSessionV1Schema.parse({
    ...coalesceSession,
    id: "session_discussion_test",
    ownerId: "owner_discussion_test",
    sandboxId: "sandbox-discussion-test",
    leaseExpiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    rotateAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString()
  });
  await repository.saveAgentSession(discussionSession);
  let discussionTouchedSandbox = false;
  const discussionWorkflow = new AgenticSiteWorkflowV1(
    repository,
    {} as never,
    { diagnostics: async () => { discussionTouchedSandbox = true; return { ok: true, revision: "discussion-revision" }; } } as never,
    {
      discuss: async () => ({
        discussion: {
          schemaVersion: "manager-discussion-v1",
          response: "I would refine the hero hierarchy and preserve the existing conversion path.",
          proposedAction: "Refine the homepage hero hierarchy without changing its verified claims or primary conversion path.",
          requiresApply: true
        },
        modelId: "verification",
        usage: { inputTokens: 10, outputTokens: 8, estimatedCostUsd: 0, costEstimateStatus: "unavailable", durationMs: 5 }
      })
    } as never,
    operations
  );
  const versionsBeforeDiscussion = await repository.listSiteVersions(coalesceSite.id);
  const siteBeforeDiscussion = await repository.getSite(coalesceSite.id);
  const discussionResult = await discussionWorkflow.discuss({
    sessionId: discussionSession.id,
    ownerId: discussionSession.ownerId,
    message: "How would you improve the homepage hero?"
  });
  assert(discussionResult.discussion.requiresApply && Boolean(discussionResult.discussion.proposedAction), "Plan discussion did not retain its proposed Build action");
  assert((await repository.listAgentMessages(discussionSession.id)).length === 2, "Plan discussion did not persist the owner and manager messages");
  assert((await repository.listAgentRuns(discussionSession.id)).length === 0, "Plan discussion created an agent run");
  assert((await repository.listSiteVersions(coalesceSite.id)).length === versionsBeforeDiscussion.length, "Plan discussion created a site version");
  assert((await repository.getSite(coalesceSite.id))?.currentWorkspaceRevisionId === siteBeforeDiscussion?.currentWorkspaceRevisionId, "Plan discussion advanced the workspace revision");
  assert(!discussionTouchedSandbox, "Plan discussion allocated or inspected a Cloudflare sandbox");
  const preflightSite = platformSiteRecordSchema.parse({
    id: "site_preflight_test", businessId: "business_preflight_test", slug: "preflight-test", status: "draft",
    createdAt: buildInput.createdAt, updatedAt: buildInput.createdAt
  });
  const preflightInput = sitePublicBuildInputV3Schema.parse({
    ...buildInput,
    id: "input_preflight_test",
    siteId: preflightSite.id,
    businessId: preflightSite.businessId,
    inputHash: `sha256:${"8".repeat(64)}`
  });
  const preflightSession = siteAgentSessionV1Schema.parse({
    ...coalesceSession,
    id: "session_preflight_test",
    siteId: preflightSite.id,
    ownerId: "owner_preflight_test",
    publicBuildInputId: preflightInput.id
  });
  await repository.createSite(preflightSite);
  await repository.savePublicBuildInput(preflightInput);
  await repository.setCurrentPublicBuildInput(preflightSite.id, preflightInput.id);
  await repository.saveAgentSession(preflightSession);
  const preflightBlobStore = new LocalArtifactBlobStore(join(repositoryDir, "trace-blobs"));
  const preflightWorkflow = (preflight: () => Promise<Record<string, unknown>>) => new AgenticSiteWorkflowV1(
    repository,
    preflightBlobStore,
    {} as never,
    { preflightEdit: preflight } as never,
    operations
  );
  const usage = { inputTokens: 12, cachedInputTokens: 3, outputTokens: 4, estimatedCostUsd: 0, costEstimateStatus: "unavailable" as const, durationMs: 5 };
  await assertRejects(
    () => preflightWorkflow(async () => ({
      preflight: { schemaVersion: "manager-edit-preflight-v1", decision: "clarification_required", taskKind: null, operation: null, requestedOutcome: "Add a page", clarificationQuestion: "What should the page cover?" },
      modelId: "verification", usage
    })).preflightAndEnqueueApply({ session: preflightSession, instruction: "Add a page.", requestedBy: preflightSession.ownerId }),
    EditClarificationRequiredError,
    "ambiguous Apply preflight"
  );
  assert((await repository.listAgentRuns(preflightSession.id)).length === 0, "ambiguous Apply created a run");
  await assertRejects(
    () => preflightWorkflow(async () => { throw new Error("preflight_transport_failure"); }).preflightAndEnqueueApply({ session: preflightSession, instruction: "Add a services page.", requestedBy: preflightSession.ownerId }),
    EditPreflightFailedError,
    "failed Apply preflight"
  );
  assert((await repository.listAgentRuns(preflightSession.id)).length === 0, "failed Apply preflight created a run");
  const readyPreflight = await preflightWorkflow(async () => ({
    preflight: { schemaVersion: "manager-edit-preflight-v1", decision: "ready", taskKind: "page_edit", operation: "add_page", requestedOutcome: "Add a gallery page", clarificationQuestion: null },
    modelId: "verification", usage
  })).preflightAndEnqueueApply({ session: preflightSession, instruction: "Add /gallery and link it from navigation.", requestedBy: preflightSession.ownerId });
  const retainedObjective = await repository.getEditObjective(readyPreflight.run.id);
  assert(retainedObjective?.ownerSpecifiedRoutes.includes("/gallery") && retainedObjective.checks.some((check) => check.kind === "route_present" && check.route === "/gallery"), "ready Apply did not persist its deterministic route objective");
  const retainedPreflightSpans = await repository.listTraceSpans(retainedObjective!.requestId);
  const retainedPreflight = retainedPreflightSpans.find((span) => span.kind === "preflight" && span.status === "succeeded");
  assert(retainedPreflight?.payloadRef && retainedPreflight.payloadHash && retainedPreflight.payloadExpiresAt, "Apply preflight was not retained with an expiring private payload");
  assert(retainedPreflight.payloadRef.includes(retainedPreflight.payloadHash.slice("sha256:".length)), "Trace payload storage was not content-hash addressed within its private span prefix");
  const retainedPreflightPayload = await preflightBlobStore.get(retainedPreflight.payloadRef);
  assert(retainedPreflightPayload && retainedPreflightPayload.contentHash === retainedPreflight.payloadHash, "Preflight payload bytes did not match their trace hash");
  const leaseToken = `sha256:${"a".repeat(64)}`;
  assert(await repository.acquireMaintenanceLease("trace-test", leaseToken, "2026-07-20T00:00:00.000Z", "2026-07-20T01:00:00.000Z"), "first maintenance lease claim failed");
  assert(!(await repository.acquireMaintenanceLease("trace-test", `sha256:${"b".repeat(64)}`, "2026-07-20T00:30:00.000Z", "2026-07-20T01:30:00.000Z")), "active maintenance lease was claimed twice");
  assert(await repository.renewMaintenanceLease("trace-test", leaseToken, "2026-07-20T00:30:00.000Z", "2026-07-20T02:00:00.000Z"), "owned maintenance lease did not renew");
  assert(!(await repository.releaseMaintenanceLease("trace-test", `sha256:${"b".repeat(64)}`)), "foreign maintenance lease token released the lease");
  assert(await repository.releaseMaintenanceLease("trace-test", leaseToken), "owned maintenance lease did not release");
  const expiredBytes = Buffer.from("expired trace payload");
  const expiredHash = sha256(expiredBytes);
  const expiredRef = "trace-payloads/trace_expiry_test/span_expiry_test.json";
  await preflightBlobStore.putImmutable({ key: expiredRef, bytes: expiredBytes, contentType: "application/json", contentHash: expiredHash });
  await repository.saveTraceSpans([siteAgentTraceSpanV1Schema.parse({
    schemaVersion: "site-agent-trace-span-v1", id: "span_expiry_test", traceId: "trace_expiry_test", requestId: "request_expiry_test",
    sequence: 0, kind: "preflight", name: "expiry_test", status: "succeeded", summary: {}, payloadRef: expiredRef,
    payloadHash: expiredHash, payloadExpiresAt: "2026-07-20T00:00:00.000Z", startedAt: "2026-07-19T23:59:00.000Z", completedAt: "2026-07-20T00:00:00.000Z"
  })]);
  const lifecycleWorkflow = preflightWorkflow(async () => ({}));
  const retainedUntilLifecycle = await lifecycleWorkflow.sweepExpiredTracePayloads(10);
  assert(!retainedUntilLifecycle.includes("span_expiry_test") && await preflightBlobStore.exists(expiredRef), "application cleanup deleted a trace payload instead of waiting for R2 lifecycle");
  await preflightBlobStore.delete(expiredRef);
  const swept = await lifecycleWorkflow.sweepExpiredTracePayloads(10);
  assert(swept.includes("span_expiry_test"), "trace payload DB reference was not cleared after lifecycle deletion was observed");
  const destroyedSandboxIds: string[] = [];
  const workflow = new AgenticSiteWorkflowV1(
    repository,
    {} as never,
    { destroy: async (sandboxId: string) => { destroyedSandboxIds.push(sandboxId); } } as never,
    {} as never,
    operations
  );
  const deadlineSession = siteAgentSessionV1Schema.parse({
    ...coalesceSession,
    id: "session_deadline_test",
    ownerId: "owner_deadline_test",
    status: "active",
    sandboxId: undefined
  });
  await repository.saveAgentSession(deadlineSession);
  const deadlineRun = siteAgentRunV2Schema.parse({
    schemaVersion: "site-agent-run-v2",
    id: "run_deadline_test",
    sessionId: deadlineSession.id,
    siteId: coalesceSite.id,
    publicBuildInputId: buildInput.id,
    origin: "owner_request",
    requestedBy: deadlineSession.ownerId,
    publishAfterSuccess: false,
    kind: "focused_edit",
    status: "queued",
    stage: "queued",
    modelId: "verification",
    attempt: 0,
    skillVersions: {},
    attempts: [],
    usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, costEstimateStatus: "unavailable", durationMs: 0 },
    startedAt: new Date(Date.now() - siteEditDeadlineMs - 1_000).toISOString()
  });
  await repository.saveAgentRun(deadlineRun);
  const deadlineFailure = await workflow.executeRun(deadlineRun.id);
  assert(deadlineFailure.status === "failed" && deadlineFailure.failureReason === "workflow_deadline_exhausted", "expired edit workflow did not fail closed at its orchestration deadline");
  assert((await repository.getAgentSession(deadlineSession.id))?.status === "checkpointed", "deadline failure did not clean up its leased session resources");
  assert((await repository.listOperatorQueue()).some((item) => item.runId === deadlineRun.id && item.findings.some((finding) => finding.message === "workflow_deadline_exhausted")), "deadline failure did not persist its terminal diagnostic");
  const startFailureSession = siteAgentSessionV1Schema.parse({
    ...coalesceSession,
    id: "session_start_failure_test",
    ownerId: "owner_start_failure_test",
    sandboxId: undefined,
    leaseExpiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    rotateAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString()
  });
  await repository.saveAgentSession(startFailureSession);
  let startedSandboxId: string | undefined;
  let destroyedStartFailureId: string | undefined;
  const startFailureWorkflow = new AgenticSiteWorkflowV1(
    repository,
    {} as never,
    {
      bootstrap: async (sandboxId: string) => {
        startedSandboxId = sandboxId;
        throw new Error("synthetic_bootstrap_failure");
      },
      destroy: async (sandboxId: string) => { destroyedStartFailureId = sandboxId; }
    } as never,
    {} as never,
    operations
  );
  let startFailed = false;
  try {
    await (startFailureWorkflow as unknown as {
      ensureSandbox(session: typeof startFailureSession, input: typeof buildInput): Promise<unknown>;
    }).ensureSandbox(startFailureSession, buildInput);
  } catch (error) {
    startFailed = error instanceof Error && error.message === "synthetic_bootstrap_failure";
  }
  const afterStartFailure = await repository.getAgentSession(startFailureSession.id);
  assert(startFailed && Boolean(startedSandboxId) && destroyedStartFailureId === startedSandboxId,
    "sandbox bootstrap failure did not destroy the durably recorded provider instance");
  assert(afterStartFailure?.status === "checkpointed" && !afterStartFailure.sandboxId,
    "sandbox bootstrap failure did not clear its durable provider ID after destruction");
  await Promise.all([
    workflow.recoverRunIfStale(queuedRun.id, -1),
    workflow.recoverRunIfStale(queuedRun.id, -1)
  ]);
  const restartedRun = await repository.getAgentRun(queuedRun.id);
  assert(restartedRun?.status === "queued" && restartedRun.stage === "queued", "overlapping interrupted-run recovery did not converge on one queued checkpoint");
  assert(restartedRun.attempt === 1, "overlapping recovery incremented the execution attempt");
  const competingClaims = await Promise.all([
    repository.claimAgentRun(queuedRun.id),
    repository.claimAgentRun(queuedRun.id)
  ]);
  const claimedRuns = competingClaims.filter((run) => Boolean(run));
  assert(claimedRuns.length === 1, "overlapping recovery allowed more than one subsequent executor");
  const secondClaim = claimedRuns[0];
  assert(secondClaim?.attempt === 2, "restarted run did not retain the candidate-attempt count");
  const exhaustedRun = await workflow.recoverRunIfStale(queuedRun.id, -1);
  assert(exhaustedRun.status === "failed", "interrupted second candidate attempt did not stop at the recovery bound");
  let staleSelectionRejected = false;
  try {
    await workflow.enqueueRun({
      session: coalesceSession, kind: "focused_edit", instruction: "Change this element.", requestedBy: coalesceSession.ownerId,
      selection: { route: "/", selector: "#hero", workspaceRevisionId: "workspace_stale_selection" }
    });
  } catch (error) {
    staleSelectionRejected = error instanceof Error && error.message === "stale_selection";
  }
  assert(staleSelectionRejected, "stale selected-element context was accepted");
  const ownerRun = await workflow.enqueueRun({
    session: coalesceSession, kind: "focused_edit", instruction: "Make the hero more direct.", requestedBy: coalesceSession.ownerId
  });
  const firstControlRun = await workflow.enqueueRun({
    session: coalesceSession, kind: "rebase", instruction: "Apply confirmed hours.", requestedBy: coalesceSession.ownerId,
    origin: "control_plane", deferBehindActive: true, publishAfterSuccess: true
  });
  const coalescedControlRun = await workflow.enqueueRun({
    session: coalesceSession, kind: "page_edit", instruction: "Add the confirmed service.", requestedBy: coalesceSession.ownerId,
    origin: "control_plane", deferBehindActive: true, publishAfterSuccess: false
  });
  assert(firstControlRun.id === coalescedControlRun.id, "control-plane reconciliation was not coalesced");
  assert(coalescedControlRun.deferredUntilRunId === ownerRun.id, "control-plane run did not serialize behind the active owner run");
  assert(coalescedControlRun.kind === "page_edit" && !coalescedControlRun.publishAfterSuccess, "structural coalescing retained unsafe auto-publish behavior");
  assert((await workflow.executeRun(coalescedControlRun.id)).status === "queued", "deferred run executed before its predecessor");
  const retrySession = siteAgentSessionV1Schema.parse({
    ...coalesceSession,
    id: "session_retry_test",
    ownerId: "owner_retry_test"
  });
  await repository.saveAgentSession(retrySession);
  const failedRetrySource = siteAgentRunV2Schema.parse({
    schemaVersion: "site-agent-run-v2",
    id: "run_retry_source_test",
    sessionId: retrySession.id,
    siteId: coalesceSite.id,
    publicBuildInputId: buildInput.id,
    origin: "owner_request",
    requestedBy: retrySession.ownerId,
    publishAfterSuccess: false,
    kind: "focused_edit",
    status: "failed",
    stage: "failed",
    modelId: "verification",
    attempt: 2,
    skillVersions: {},
    attempts: [],
    usage: { inputTokens: 10, outputTokens: 2, estimatedCostUsd: 0, costEstimateStatus: "unavailable", durationMs: 50 },
    failureReason: "Synthetic retry source.",
    startedAt: "2026-07-20T00:07:00.000Z",
    completedAt: "2026-07-20T00:08:00.000Z"
  });
  await repository.saveAgentRun(failedRetrySource);
  await repository.appendAgentMessage({
    id: "message_retry_source_test",
    sessionId: retrySession.id,
    runId: failedRetrySource.id,
    role: "owner",
    content: "Make the homepage action more visually prominent.",
    createdAt: "2026-07-20T00:07:00.000Z"
  });
  const retriedRun = await workflow.retryFailedRun({ runId: failedRetrySource.id, actorId: retrySession.ownerId });
  assert(retriedRun.id !== failedRetrySource.id && retriedRun.status === "queued", "failed-run retry did not create a fresh queued run");
  assert(!retriedRun.publishAfterSuccess && retriedRun.kind === failedRetrySource.kind, "failed-run retry changed task semantics or bypassed review");
  const retryRequest = (await repository.listAgentMessages(retrySession.id)).find((message) => message.runId === retriedRun.id);
  assert(retryRequest?.content === "Make the homepage action more visually prominent.", "failed-run retry did not retain the original owner request");
  const expiredSession = siteAgentSessionV1Schema.parse({
    ...coalesceSession,
    id: "session_expired_test",
    ownerId: "owner_expired_test",
    sandboxId: "sandbox-expired-test",
    leaseExpiresAt: "2026-07-20T00:10:00.000Z"
  });
  await repository.saveAgentSession(expiredSession);
  const reaped = await workflow.reapExpiredSessions({ now: "2026-07-20T00:20:00.000Z" });
  assert(reaped.includes(expiredSession.id) && destroyedSandboxIds.includes("sandbox-expired-test"), "expired idle session was not destroyed by the worker lifecycle");
  assert((await repository.getAgentSession(expiredSession.id))?.status === "checkpointed", "expired idle session was not checkpointed");
  assert(!(await workflow.reapExpiredSessions({ now: "2026-07-20T00:20:00.000Z" })).includes(expiredSession.id), "checkpointed session without a sandbox was repeatedly reaped");
  const expiredCheckpointedSession = siteAgentSessionV1Schema.parse({
    ...expiredSession,
    id: "session_expired_checkpointed_test",
    ownerId: "owner_expired_checkpointed_test",
    status: "checkpointed",
    sandboxId: "sandbox-expired-checkpointed-test"
  });
  await repository.saveAgentSession(expiredCheckpointedSession);
  const checkpointedReaped = await workflow.reapExpiredSessions({ now: "2026-07-20T00:20:00.000Z" });
  assert(checkpointedReaped.includes(expiredCheckpointedSession.id)
    && destroyedSandboxIds.includes("sandbox-expired-checkpointed-test"), "expired checkpointed session retained a billable sandbox");
  const destroyFailureSession = siteAgentSessionV1Schema.parse({
    ...coalesceSession,
    id: "session_destroy_failure_test",
    ownerId: "owner_destroy_failure_test",
    sandboxId: "sandbox-destroy-failure-test",
    sandboxLastStartedAt: "2026-07-20T00:00:00.000Z",
    leaseExpiresAt: "2026-07-20T00:10:00.000Z"
  });
  await repository.saveAgentSession(destroyFailureSession);
  const failedDestroyWorkflow = new AgenticSiteWorkflowV1(
    repository,
    {} as never,
    { destroy: async () => { throw new Error("provider_destroy_failed"); } } as never,
    {} as never,
    operations
  );
  assert(!(await failedDestroyWorkflow.reapExpiredSessions({ now: "2026-07-20T00:20:00.000Z" })).includes(destroyFailureSession.id), "reaper claimed success after provider destroy failure");
  const retainedFailedDestroy = await repository.getAgentSession(destroyFailureSession.id);
  assert(retainedFailedDestroy?.status === "rotating" && retainedFailedDestroy.sandboxId === "sandbox-destroy-failure-test", "destroy failure cleared the sandbox ID instead of retaining a durable retry");
  assert(retainedFailedDestroy.sandboxDestroyAttempts === 1, "destroy failure telemetry did not increment");
  assert((await workflow.reapExpiredSessions({ now: "2026-07-20T00:20:00.000Z" })).includes(destroyFailureSession.id), "reaper did not retry a rotating destroy failure");
  const retriedDestroy = await repository.getAgentSession(destroyFailureSession.id);
  assert(!retriedDestroy?.sandboxId && retriedDestroy?.sandboxProvisionedMs === 20 * 60_000, "successful destroy retry did not clear the sandbox ID and retain provisioned duration");

  const rightsSiteId = "site_rights_gate_test";
  const rightsBusinessId = "business_rights_gate_test";
  const rightsAsset = {
    assetId: "asset_reference_only", revisionId: "asset_revision_reference_only", kind: "photo" as const,
    contentHash: `sha256:${"8".repeat(64)}` as const, storageKey: "source-assets/reference-only.webp",
    publicUrl: "https://example.com/reference-only.webp", mimeType: "image/webp" as const, alt: "Reference-only source image",
    rightsStatus: "reference_only" as const, sourceFactIds: [businessName.id], activeForFutureBuilds: true
  };
  const rightsSite = platformSiteRecordSchema.parse({
    id: rightsSiteId, businessId: rightsBusinessId, slug: "rights-gate-test", status: "draft",
    createdAt: buildInput.createdAt, updatedAt: buildInput.createdAt
  });
  const rightsState = businessStateV3Schema.parse({
    ...syntheticState,
    businessId: rightsBusinessId,
    siteId: rightsSiteId,
    identity: { name: buildInput.business.name, description: buildInput.business.description, categories: ["Auto body shop"] },
    contacts: buildInput.business.contacts,
    locations: buildInput.business.locations,
    serviceAreas: buildInput.business.serviceAreas,
    offerings: buildInput.business.offerings,
    proof: [],
    assets: [rightsAsset],
    facts: buildInput.publicFacts
  });
  const rightsIntent = { ...buildInput.intent, id: "intent_rights_gate_test", siteId: rightsSiteId };
  const rightsForm = { ...buildInput.forms[0], id: "form_rights_gate_test", siteId: rightsSiteId };
  const rightsInput = sitePublicBuildInputV3Schema.parse({
    ...buildInput,
    id: "input_rights_gate_test",
    siteId: rightsSiteId,
    businessId: rightsBusinessId,
    business: { ...buildInput.business, assets: [rightsAsset] },
    intent: rightsIntent,
    forms: [rightsForm],
    assetRevisionIds: [rightsAsset.revisionId]
  });
  const rightsSource = sourceSnapshotV1Schema.parse({
    schemaVersion: "source-snapshot-v1", id: rightsInput.sourceSnapshotIds[0], businessId: rightsBusinessId,
    sourceType: "owner_input", contentHash: `sha256:${"c".repeat(64)}`,
    capturedAt: buildInput.createdAt, payload: { verification: "rights gate" }
  });
  const rightsAssetRevision = assetRevisionV1Schema.parse({
    schemaVersion: "asset-revision-v1", id: rightsAsset.revisionId, assetId: rightsAsset.assetId,
    businessId: rightsBusinessId, contentHash: rightsAsset.contentHash, storageKey: rightsAsset.storageKey,
    publicUrl: rightsAsset.publicUrl, mimeType: rightsAsset.mimeType, bytes: 128,
    provenance: { verification: "rights gate" }, rightsStatus: rightsAsset.rightsStatus, createdAt: buildInput.createdAt
  });
  await repository.bootstrapSite({
    site: rightsSite, state: rightsState, intent: rightsIntent, forms: [rightsForm],
    sourceSnapshots: [rightsSource], assetRevisions: [rightsAssetRevision], publicBuildInput: rightsInput
  });
  const rightsRevision = siteWorkspaceRevisionV1Schema.parse({
    ...revision, id: "workspace_rights_gate_test", siteId: rightsSiteId,
    sourceHash: `sha256:${"9".repeat(64)}`, sourceArchiveKey: `workspace-backups/${"9".repeat(64)}.tar.gz`
  });
  const rightsArtifact = siteBuildArtifactV1Schema.parse({
    ...passedArtifact, id: "artifact_rights_gate_test", siteId: rightsSiteId, workspaceRevisionId: rightsRevision.id,
    publicBuildInputId: rightsInput.id, artifactHash: `sha256:${"a".repeat(64)}`,
    storagePrefix: "site-artifacts/site_rights_gate_test/artifact_rights_gate_test",
    files: [{ ...passedArtifact.files[0], contentHash: `sha256:${"b".repeat(64)}`, storageKey: "site-artifacts/site_rights_gate_test/artifact_rights_gate_test/index.html" }]
  });
  await repository.commitVerifiedBuild({ revision: rightsRevision, artifact: rightsArtifact });
  const rightsVersion = siteVersionV4Schema.parse({
    schemaVersion: "site-version-v4", id: "version_rights_gate_test", siteId: rightsSiteId, number: 1, status: "candidate",
    artifactId: rightsArtifact.id, artifactHash: rightsArtifact.artifactHash, workspaceRevisionId: rightsRevision.id,
    publicBuildInputId: rightsInput.id, formDefinitionIds: [rightsForm.id], sourceSnapshotIds: rightsInput.sourceSnapshotIds,
    assetRevisionIds: rightsInput.assetRevisionIds, createdAt: buildInput.createdAt, createdBy: { kind: "system", id: "verification" }
  });
  await repository.createSiteVersion(rightsVersion);
  let unpublishableMediaRejected = false;
  try { await repository.promoteSiteVersion(rightsVersion.id, "operator_test"); } catch (error) {
    unpublishableMediaRejected = error instanceof Error && error.message === "candidate_contains_unpublishable_media";
  }
  assert(unpublishableMediaRejected, "local publication bypassed the reference-only media rights gate");

  const experimentalSiteId = "site_experimental_test";
  const experimentalBusinessId = "business_experimental_test";
  const experimentalSourceId = "source_experimental_test";
  const experimentalForm = { ...buildInput.forms[0], id: "form_experimental_test", siteId: experimentalSiteId };
  const experimentalFacts = buildInput.publicFacts.map((fact) => ({ ...fact, source: { ...fact.source, sourceSnapshotId: experimentalSourceId } }));
  const experimentalState = businessStateV3Schema.parse({
    ...syntheticState,
    businessId: experimentalBusinessId,
    siteId: experimentalSiteId,
    facts: experimentalFacts,
    offerings: buildInput.business.offerings,
    contacts: buildInput.business.contacts,
    locations: buildInput.business.locations
  });
  const experimentalIntent = { ...buildInput.intent, id: "intent_experimental_test", siteId: experimentalSiteId };
  const experimentalInput = sitePublicBuildInputV3Schema.parse({
    ...buildInput,
    id: "input_experimental_test",
    siteId: experimentalSiteId,
    businessId: experimentalBusinessId,
    publicFacts: experimentalFacts,
    intent: experimentalIntent,
    forms: [experimentalForm],
    sourceSnapshotIds: [experimentalSourceId]
  });
  await repository.bootstrapSite({
    site: platformSiteRecordSchema.parse({
      id: experimentalSiteId,
      businessId: experimentalBusinessId,
      slug: "experimental-test",
      status: "experimental",
      createdAt: buildInput.createdAt,
      updatedAt: buildInput.createdAt
    }),
    state: experimentalState,
    intent: experimentalIntent,
    forms: [experimentalForm],
    sourceSnapshots: [sourceSnapshotV1Schema.parse({
      schemaVersion: "source-snapshot-v1",
      id: experimentalSourceId,
      businessId: experimentalBusinessId,
      sourceType: "owner_input",
      contentHash: `sha256:${"d".repeat(64)}`,
      capturedAt: buildInput.createdAt,
      payload: { verification: "experimental non-publishability" }
    })],
    assetRevisions: [],
    publicBuildInput: experimentalInput
  });
  const experimentalRevision = siteWorkspaceRevisionV1Schema.parse({
    ...revision,
    id: "workspace_experimental_test",
    siteId: experimentalSiteId,
    sourceHash: `sha256:${"e".repeat(64)}`,
    sourceArchiveKey: `workspace-backups/${"e".repeat(64)}.tar.gz`
  });
  const experimentalArtifact = siteBuildArtifactV1Schema.parse({
    ...passedArtifact,
    id: "artifact_experimental_test",
    siteId: experimentalSiteId,
    workspaceRevisionId: experimentalRevision.id,
    publicBuildInputId: experimentalInput.id,
    artifactHash: `sha256:${"f".repeat(64)}`,
    storagePrefix: "site-artifacts/site_experimental_test/artifact_experimental_test",
    files: [{ ...passedArtifact.files[0], contentHash: `sha256:${"0".repeat(64)}`, storageKey: "site-artifacts/site_experimental_test/artifact_experimental_test/index.html" }]
  });
  await repository.commitVerifiedBuild({ revision: experimentalRevision, artifact: experimentalArtifact });
  const experimentalVersion = siteVersionV4Schema.parse({
    schemaVersion: "site-version-v4",
    id: "version_experimental_test",
    siteId: experimentalSiteId,
    number: 1,
    status: "candidate",
    artifactId: experimentalArtifact.id,
    artifactHash: experimentalArtifact.artifactHash,
    workspaceRevisionId: experimentalRevision.id,
    publicBuildInputId: experimentalInput.id,
    formDefinitionIds: [experimentalForm.id],
    sourceSnapshotIds: [experimentalSourceId],
    assetRevisionIds: [],
    createdAt: buildInput.createdAt,
    createdBy: { kind: "agent", id: "run_experimental_publish_test" }
  });
  await repository.createSiteVersion(experimentalVersion);
  const initialExperimentalReadiness = await deriveSitePublicationReadiness({ versionId: experimentalVersion.id, repository, operationsRepository: operations });
  assert(initialExperimentalReadiness.blockers.some((blocker) => blocker.code === "experimental_site") && initialExperimentalReadiness.blockers.some((blocker) => blocker.code === "operator_approval"), "experimental readiness did not report its independent blockers");
  await repository.saveSiteVersionApproval(siteVersionApprovalV1Schema.parse({
    schemaVersion: "site-version-approval-v1", id: "approval_wrong_artifact_test", siteId: experimentalSiteId,
    versionId: experimentalVersion.id, artifactHash: `sha256:${"1".repeat(64)}`, status: "approved",
    actorId: "operator_test", note: "Intentionally wrong artifact hash.", createdAt: "2026-07-20T00:03:00.000Z"
  }));
  assert((await deriveSitePublicationReadiness({ versionId: experimentalVersion.id, repository, operationsRepository: operations })).blockers.some((blocker) => blocker.code === "operator_approval"), "approval for a different artifact hash unlocked publication");
  await repository.saveSiteVersionApproval(siteVersionApprovalV1Schema.parse({
    schemaVersion: "site-version-approval-v1", id: "approval_exact_artifact_test", siteId: experimentalSiteId,
    versionId: experimentalVersion.id, artifactHash: experimentalVersion.artifactHash, status: "approved",
    actorId: "operator_test", note: "Exact artifact reviewed for readiness verification.", createdAt: "2026-07-20T00:04:00.000Z"
  }));
  assert(!(await deriveSitePublicationReadiness({ versionId: experimentalVersion.id, repository, operationsRepository: operations })).blockers.some((blocker) => blocker.code === "operator_approval"), "exact artifact approval did not clear the approval blocker");
  await assertRejectsExperimental(() => repository.promoteSiteVersion(experimentalVersion.id, "operator_test"), "local repository");
  await assertRejectsExperimental(() => workflow.promoteVersion(experimentalVersion.id, "operator_test"), "workflow promotion");
  const automaticRun = siteAgentRunV2Schema.parse({
    schemaVersion: "site-agent-run-v2",
    id: "run_experimental_publish_test",
    sessionId: "session_experimental_publish_test",
    siteId: experimentalSiteId,
    publicBuildInputId: experimentalInput.id,
    origin: "system",
    requestedBy: "operator_test",
    publishAfterSuccess: true,
    kind: "focused_edit",
    status: "succeeded",
    stage: "candidate_ready",
    exactParentRevisionId: experimentalRevision.id,
    outputRevisionId: experimentalRevision.id,
    candidateVersionId: experimentalVersion.id,
    modelId: "verification",
    attempt: 1,
    skillVersions: {},
    attempts: [],
    usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, costEstimateStatus: "unavailable", durationMs: 0 },
    startedAt: buildInput.createdAt,
    completedAt: buildInput.createdAt
  });
  await repository.saveAgentRun(automaticRun);
  await workflow.executeRunAndFinalize(automaticRun.id);
  const experimentalAfterAutomaticPublish = await repository.getSite(experimentalSiteId);
  assert(experimentalAfterAutomaticPublish?.status === "experimental" && !experimentalAfterAutomaticPublish.publishedVersionId, "publishAfterSuccess bypassed experimental non-publishability");

  const priorSubjectiveFinding = operatorQueueItemSchema.parse({
    schemaVersion: "operator-queue-item-v2",
    id: "operator_subjective_continuity_test",
    siteId: experimentalSiteId,
    versionId: experimentalVersion.id,
    runId: automaticRun.id,
    reason: "subjective_finding",
    severity: "normal",
    status: "open",
    findings: [{ route: "/", area: "craft", severity: "normal", message: "A prior visual defect remains unresolved." }],
    createdAt: "2026-07-20T00:05:00.000Z",
    updatedAt: "2026-07-20T00:05:00.000Z"
  });
  await repository.saveOperatorQueueItem(priorSubjectiveFinding);
  const successorRun = siteAgentRunV2Schema.parse({
    ...automaticRun,
    id: "run_experimental_successor_test",
    publishAfterSuccess: false,
    candidateVersionId: "version_experimental_successor_test",
    subjectiveReview: {
      verdict: "ship",
      summary: "The scoped edit is complete.",
      findings: [],
      modelId: "verification",
      promptVersion: "verification",
      checkedAt: "2026-07-20T00:06:00.000Z"
    },
    startedAt: "2026-07-20T00:06:00.000Z",
    completedAt: "2026-07-20T00:06:00.000Z"
  });
  await repository.saveAgentRun(successorRun);
  await repository.createSiteVersion(siteVersionV4Schema.parse({
    ...experimentalVersion,
    id: successorRun.candidateVersionId,
    number: 2,
    createdAt: "2026-07-20T00:06:00.000Z",
    createdBy: { kind: "agent", id: successorRun.id }
  }));
  const openSubjectiveItems = (await repository.listOperatorQueue("open"))
    .filter((item) => item.siteId === experimentalSiteId && item.reason === "subjective_finding");
  assert(openSubjectiveItems.some((item) => item.id === priorSubjectiveFinding.id && item.versionId === experimentalVersion.id), "A successor ship candidate hid or resolved the prior site-scoped subjective finding.");
  const successorReadiness = await deriveSitePublicationReadiness({ versionId: successorRun.candidateVersionId!, repository, operationsRepository: operations });
  assert(successorReadiness.blockers.some((blocker) => blocker.code === "subjective_finding"), "a prior site-scoped subjective finding did not block a successor candidate");

  const fallbackRun = siteAgentRunV2Schema.parse({
    ...successorRun,
    id: "run_subjective_repair_fallback_test",
    outputRevisionId: experimentalRevision.id,
    candidateVersionId: experimentalVersion.id,
    attempts: [
      {
        number: 1, kind: "focused_edit", artifactId: experimentalArtifact.id,
        workspaceRevisionId: experimentalRevision.id, hardGate: "passed", objectiveErrorCount: 0,
        subjectiveVerdict: "revise", criticAvailable: true, modelDurationMs: 10, buildDurationMs: 10,
        startedAt: "2026-07-20T00:07:00.000Z", completedAt: "2026-07-20T00:07:01.000Z"
      },
      {
        number: 2, kind: "qa_repair", hardGate: "failed", objectiveErrorCount: 1,
        subjectiveVerdict: "revise", criticAvailable: false, failureStage: "authoring",
        failureReason: "repair stopped after the objective-valid checkpoint", modelDurationMs: 10, buildDurationMs: 0,
        startedAt: "2026-07-20T00:07:02.000Z", completedAt: "2026-07-20T00:07:03.000Z"
      }
    ]
  });
  assert(candidateAttemptForRun(fallbackRun)?.number === 1, "candidate outcome lookup selected a later failed subjective-repair attempt");

  const controlPlane = new ControlPlaneServiceV2(repository, workflow);
  const addedOffering = await controlPlane.submit({
    siteId: rightsSiteId,
    requestedBy: "owner_control_plane_test",
    payload: { kind: "add_offering", name: "Custom Aluminum Repair", pageMode: "dedicated" }
  });
  assert(addedOffering.applied, "owner-added service did not apply through the typed control plane");
  assert(addedOffering.run.kind === "page_edit" && !addedOffering.run.publishAfterSuccess, "owner-added structural service was allowed to auto-publish");
  const stateAfterOffering = await repository.getBusinessState(rightsBusinessId);
  const customOffering = stateAfterOffering?.offerings.find((item) => item.customName === "Custom Aluminum Repair");
  assert(customOffering?.status === "confirmed" && customOffering.visibility === "public" && customOffering.pageMode === "dedicated", "owner-added service did not become confirmed canonical state");
  const offeringFact = stateAfterOffering?.facts.find((fact) => customOffering?.sourceFactIds.includes(fact.id));
  assert(offeringFact?.publicEligible && offeringFact.source.ownerConfirmed, "owner-added service lacks owner-confirmed public provenance");
  const siteAfterOffering = await repository.getSite(rightsSiteId);
  const inputAfterOffering = siteAfterOffering?.currentPublicBuildInputId
    ? await repository.getPublicBuildInput(siteAfterOffering.currentPublicBuildInputId)
    : undefined;
  assert(inputAfterOffering?.business.offerings.some((item) => item.id === customOffering?.id), "owner-added service did not advance the immutable public build input");
  await repository.saveAgentRun(siteAgentRunV2Schema.parse({
    ...addedOffering.run,
    status: "succeeded",
    stage: "candidate_ready",
    completedAt: "2026-07-20T00:07:30.000Z"
  }));
  const policyChange = await controlPlane.submit({
    siteId: rightsSiteId,
    requestedBy: "owner_control_plane_test",
    payload: {
      kind: "update_agent_access_policy",
      policy: {
        search: "allow",
        aiInput: "disallow",
        aiTrain: "allow",
        trainingPermission: {
          status: "granted",
          ownerId: "owner_control_plane_test",
          grantedAt: "2026-07-20T00:08:00.000Z",
          recordedBy: "owner_control_plane_test",
          reason: "Owner affirmatively allowed model training for this site."
        }
      }
    }
  });
  assert(policyChange.applied && policyChange.run.kind === "rebase", "agent access policy change invoked authoring instead of deterministic rebase");
  const siteAfterPolicy = await repository.getSite(rightsSiteId);
  const inputAfterPolicy = siteAfterPolicy?.currentPublicBuildInputId ? await repository.getPublicBuildInput(siteAfterPolicy.currentPublicBuildInputId) : undefined;
  assert(inputAfterPolicy?.intent.agentAccessPolicy.aiTrain === "allow" && inputAfterPolicy.intent.agentAccessPolicy.aiInput === "disallow", "recorded owner agent policy was not retained in the immutable V3 input");
} finally {
  await rm(repositoryDir, { recursive: true, force: true });
}

const runtimePatches = new Map<string, TrustedRuntimePatchV1>();
const runtimeSeries = new Map<string, TrustedRuntimeSeriesV1>();
const runtimeRegistry = {
  async getSeries(id: string) { return runtimeSeries.get(id); },
  async getPatch(id: string) { return runtimePatches.get(id); },
  async savePatch(patch: TrustedRuntimePatchV1) { runtimePatches.set(patch.id, patch); },
  async saveSeries(series: TrustedRuntimeSeriesV1) { runtimeSeries.set(series.id, series); }
};
const firstRuntime = await createSiteRuntimePatch({
  id: "runtime_patch_first", version: "1.0.0", storageKey: "runtime/first.js",
  sourceRevision: "verification", builderVersion: "verification", bytes: Buffer.from("window.__lodestaRuntime='first';"),
  securityStatus: "audited", compatibilityStatus: "passed",
  createdAt: "2026-07-20T00:00:00.000Z"
});
const secondRuntime = await createSiteRuntimePatch({
  id: "runtime_patch_second", version: "1.0.1", storageKey: "runtime/second.js",
  sourceRevision: "verification", builderVersion: "verification", bytes: Buffer.from("window.__lodestaRuntime='second';"),
  securityStatus: "audited", compatibilityStatus: "passed",
  createdAt: "2026-07-20T00:01:00.000Z"
});
await runtimeRegistry.savePatch(firstRuntime.patch);
await runtimeRegistry.savePatch(secondRuntime.patch);
await promoteRuntimePatch({ registry: runtimeRegistry, seriesId: "site-runtime-v1", patchId: firstRuntime.patch.id, actorId: "operator_test", now: "2026-07-20T00:02:00.000Z" });
const promoted = await promoteRuntimePatch({ registry: runtimeRegistry, seriesId: "site-runtime-v1", patchId: secondRuntime.patch.id, actorId: "operator_test", now: "2026-07-20T00:03:00.000Z" });
assert(promoted.activePatchId === secondRuntime.patch.id && promoted.previousPatchId === firstRuntime.patch.id, "runtime promotion did not preserve its rollback target");
assert(runtimePatchPath(firstRuntime.patch) !== runtimePatchPath(secondRuntime.patch), "immutable runtime patches did not receive distinct content-hash URLs");
const rolledBack = await rollbackRuntimePatch({ registry: runtimeRegistry, seriesId: "site-runtime-v1", actorId: "operator_test", now: "2026-07-20T00:04:00.000Z" });
assert(rolledBack.activePatchId === firstRuntime.patch.id && rolledBack.previousPatchId === secondRuntime.patch.id, "runtime rollback did not atomically reverse the active patch");

console.log(JSON.stringify({
  ok: true, hostileFailures: hostileErrors.size, safeClaims: safePrepared.claims.length,
  claimParityCases: claimParity.cases.length, syntheticModule: "pass", capabilityPolicy: "pass",
  atomicVerifiedBuild: "pass", atomicRunClaim: "pass", controlPlaneCoalescing: "pass",
  editPreflightAndObjective: "pass", traceRetentionAndCleanup: "pass",
  ownerOfferingMutation: "pass", subjectiveFindingContinuity: "pass", candidateAttemptFallback: "pass", sessionIsolation: "pass", redirects: "pass", runtimePromotion: "pass",
  adminSiteStatus: "pass", blobInventoryAudit: "pass"
}));

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function assertRejectsExperimental(operation: () => Promise<unknown>, surface: string) {
  let rejected = false;
  try { await operation(); } catch (error) {
    rejected = error instanceof Error && (error.message.includes("experimental_site_not_publishable") || error.message.includes("experimental_site"));
  }
  assert(rejected, `${surface} accepted an experimental site promotion.`);
}

async function assertRejects(
  operation: () => Promise<unknown>,
  ErrorType: new (...args: never[]) => Error,
  surface: string
) {
  let rejected = false;
  try { await operation(); } catch (error) { rejected = error instanceof ErrorType; }
  assert(rejected, `${surface} did not fail with ${ErrorType.name}.`);
}
