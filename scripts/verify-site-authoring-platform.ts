import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentAuthoredArtifactSchema, normalizeAgentAuthoredArtifact } from "../packages/site-verification/contracts";
import { finalizePreparedArtifact, prepareSiteArtifact } from "../packages/site-verification/finalizer";
import { FactDeclarationValidator } from "../packages/site-verification/fact-declarations";
import {
  assetRevisionSchema,
  businessStateSchema,
  controlPlaneChangePayloadSchema,
  platformSiteRecordSchema,
  siteAgentRunSchema,
  siteAgentRunEventSchema,
  siteAgentSessionSchema,
  siteBuildArtifactSchema,
  siteIntentSchema,
  sitePublicBuildInputSchema,
  siteVersionSchema,
  siteWorkspaceRevisionSchema,
  sourceSnapshotSchema,
  verticalDemandEventSchema,
  expectedSiteSandboxManifest,
  type TrustedRuntimePatch,
  type TrustedRuntimeSeries
} from "../packages/site-contracts";
import { LocalSitePlatformRepository } from "../packages/platform-data/repository";
import { SiteAuthoringWorkflow, initialGenerationDeadlineMs, siteEditDeadlineMs } from "../packages/site-platform/workflow";
import {
  artifactBlobAuditConfirmation,
  assertArtifactBlobAuditDeletable,
  buildArtifactBlobAudit,
  LocalArtifactBlobStore,
  parseArtifactBlobAuditReport,
  workspaceSourceSidecarKey
} from "../packages/site-artifacts";
import { LocalArtifactBlobMaintenanceStore } from "../packages/site-artifacts/maintenance-store";
import { createPublicBuildInput } from "../packages/business-data/public-projection";
import { sha256 } from "../packages/business-data";
import { assetRevisionIdForBusiness, sourceSnapshotIdForBusiness } from "../packages/business-data/website-ingestion";
import { createSiteRuntimePatch, promoteRuntimePatch, rollbackRuntimePatch, runtimePatchPath } from "../packages/trusted-runtime";
import { matchVerticalContext, verticalContextFor } from "../packages/vertical-context";
import { validateWorkspaceSourcePolicy } from "../packages/site-agent/source-policy";
import { ControlPlaneService } from "../packages/control-plane/service";
import { canAccessAgentSession } from "../app/api/site-agent/auth";
import { GET as readSiteReadinessRoute } from "../app/api/sites/[siteId]/readiness/route";
import { LocalPlatformOperationsRepository, redirectsStrandedByRoutes, validateSiteRedirectInput } from "../packages/platform-operations";
import { buildSyntheticSiteInput } from "./support/synthetic-site-input";
import { platformCapabilityStyles } from "../workers/site-sandbox/scaffold/platform/capability-styles";
import { formatPhoneForDisplay, orderedLocationHours } from "../workers/site-sandbox/scaffold/platform/presentation";
import { deriveSiteLifecycle, deriveSiteOwnership } from "../lib/site-admin-status";
import { runEventPayloadRetentionMs } from "../packages/site-platform/run-events";

const buildInput = buildSyntheticSiteInput();
let retiredIntentAccepted = true;
let retiredInputAccepted = true;
try { siteIntentSchema.parse({ ...buildInput.intent, schemaVersion: "site-intent-v2" }); } catch { retiredIntentAccepted = false; }
try { sitePublicBuildInputSchema.parse({ ...buildInput, schemaVersion: "site-public-build-input-v2" }); } catch { retiredInputAccepted = false; }
assert(!retiredIntentAccepted, "SiteIntent accepted the retired V2 discriminator");
assert(!retiredInputAccepted, "SitePublicBuildInput accepted the retired V2 discriminator");
assert(deriveSiteLifecycle({ publishedVersionId: "version_live" }, [{ status: "published" }], { status: "running" }) === "generating", "active generation did not take precedence over publication status");
assert(deriveSiteLifecycle({ publishedVersionId: undefined }, [], { status: "failed" }) === "needs_attention", "failed generation did not surface as needing attention");
assert(deriveSiteLifecycle({ publishedVersionId: undefined }, [{ status: "candidate" }], { status: "succeeded" }) === "ready_for_review", "candidate site did not surface as ready for review");
assert(deriveSiteLifecycle({ publishedVersionId: "version_live" }, [{ status: "published" }], { status: "succeeded" }) === "published", "published site did not retain its lifecycle status");
assert(deriveSiteLifecycle({ publishedVersionId: undefined }, [], undefined) === "draft", "empty site did not default to draft");
assert(deriveSiteOwnership({ ownerUserId: "00000000-0000-4000-8000-000000000001" }) === "owned", "owned site did not surface as account owned");
assert(deriveSiteOwnership({ ownerUserId: undefined }) === "unowned", "site without an owner did not surface as unowned");
assert(initialGenerationDeadlineMs === 60 * 60_000, "initial workflow deadline drifted from 60 minutes");
assert(siteEditDeadlineMs === 25 * 60_000, "edit workflow deadline drifted from 25 minutes");
assert(runEventPayloadRetentionMs === 24 * 60 * 60_000, "run event payload database expiry drifted from the one-day R2 lifecycle");
const retainedContentHash = `sha256:${"a".repeat(64)}`;
assert(sourceSnapshotIdForBusiness("business_a", retainedContentHash) === sourceSnapshotIdForBusiness("business_a", retainedContentHash), "source snapshot IDs are not stable within one business");
assert(sourceSnapshotIdForBusiness("business_a", retainedContentHash) !== sourceSnapshotIdForBusiness("business_b", retainedContentHash), "source snapshot IDs collide across business authorities");
assert(assetRevisionIdForBusiness("business_a", retainedContentHash) !== assetRevisionIdForBusiness("business_b", retainedContentHash), "asset revision IDs collide across business authorities");
const hostile = agentAuthoredArtifactSchema.parse({
  schemaVersion: "agent-authored-artifact-v2",
  compilerManifest: expectedSiteSandboxManifest,
  siteName: "Hostile verification input",
  sharedCss: "@import url('https://evil.example/theme.css'); body{background-image:url('https://evil.example/track.png')} .hidden{behavior:url(x)}",
  routes: [{
    path: "/",
    title: "Hostile verification",
    description: "Must never pass artifact verification.",
    bodyHtml: `<main onclick="fetch('https://evil.example')"><script>alert(1)</script><iframe src="https://evil.example"></iframe><h1 data-lodesta-fact-id="business:name">Northstar Collision Repair</h1><p>Certified collision specialists with a lifetime warranty and 5 stars.</p><img src="https://evil.example/pixel.png" alt=""><input type="image" src="https://evil.example/submit.png"><a href="javascript:alert(1)">Unsafe</a><a href="https://evil.example/phishing">Unverified external link</a><form data-lodesta-form-id="unknown_form"><input name="email" type="email"><button>Send</button></form></main>`
  }],
  factDeclarations: [],
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
  schemaVersion: "agent-authored-artifact-v2",
  compilerManifest: expectedSiteSandboxManifest,
  siteName: buildInput.business.name,
  sharedCss: "body{margin:0;color:#17211b;background:#fff;font-family:Arial,sans-serif}main{width:min(900px,calc(100% - 32px));margin:auto;padding:64px 0}h1{font-size:48px;letter-spacing:0}a,button,input,textarea{min-height:44px;font:inherit}",
  routes: [{
    path: "/", title: buildInput.business.name, description: "Collision repair",
    bodyHtml: `<main><h1 data-lodesta-fact-id="${businessName.id}">${businessName.value}</h1><a href="tel:${phone.value}" data-lodesta-fact-id="${phone.id}">${phone.value}</a><p>Collision Repair</p><section data-lodesta-map="location_primary"><address data-lodesta-fact-id="${address.id}">${address.value}</address><a href="https://www.google.com/maps/search/?api=1&amp;query=place_id%3AChIJ-synthetic-location" data-lodesta-map-fallback>Directions</a></section><details data-lodesta-disclosure="disclosure-process"><summary>What happens next?</summary><p>We inspect the vehicle.</p></details><form data-lodesta-form-id="${buildInput.forms[0].id}"><label>Email<input name="email" type="email" required></label><button type="submit">Send</button><p data-lodesta-form-status></p></form></main>`
  }],
  factDeclarations: [{ id: "service_claim", route: "/", text: "Collision Repair", kind: "free_text", sourceFactIds: [offering.id], autoDeclared: false }],
  capabilityBindings: [
    { id: "estimate_form", kind: "form", route: "/", config: { formId: buildInput.forms[0].id } },
    { id: "primary_map", kind: "map", route: "/", config: { locationId: "location_primary" } },
    { id: "process_disclosure", kind: "disclosure", route: "/", config: { disclosureId: "disclosure-process" } }
  ]
});
const safePrepared = prepareSiteArtifact({ authoredArtifact: safe, buildInput, runtimeSeriesId: "site-runtime-v1" });
const safeErrors = safePrepared.findings.filter((finding) => finding.severity === "error");
assert(safeErrors.length === 0, `safe artifact failed: ${safeErrors.map((finding) => finding.id).join(", ")}`);
assertThrows(
  () => agentAuthoredArtifactSchema.parse({ ...safe, factDeclarations: undefined, claims: safe.factDeclarations }),
  "The clean artifact contract accepted the retired claims field."
);
const normalizedMissingDeclarations = agentAuthoredArtifactSchema.parse(normalizeAgentAuthoredArtifact({
  ...safe,
  factDeclarations: undefined
}));
assert(normalizedMissingDeclarations.factDeclarations.length === 0, "The compiler boundary did not normalize omitted fact declarations.");
assertThrows(
  () => agentAuthoredArtifactSchema.parse(normalizeAgentAuthoredArtifact({ ...safe, factDeclarations: undefined, claims: safe.factDeclarations })),
  "The authored-artifact normalizer retained a claims compatibility reader."
);
assert(safePrepared.factDeclarations.some((claim) => claim.autoDeclared && claim.sourceFactIds.includes(phone.id)), "SDK phone value was not auto-declared");
assert(safePrepared.factDeclarations.some((claim) => claim.autoDeclared && claim.sourceFactIds.includes(address.id)), "SDK map address was not auto-declared");
assert(safePrepared.factDeclarations.some((claim) => claim.kind === "structured_data" && claim.sourceFactIds.includes(businessName.id)), "JSON-LD business name lacks a source-bound claim");
assert(safePrepared.capabilityBindings.some((binding) => binding.kind === "analytics"), "platform analytics capability was not recorded in the artifact");
assert(safePrepared.files.every((file) => !file.bytes.toString("utf8").includes("<script>alert")), "hostile script survived preparation");
const fixedFinalization = {
  prepared: safePrepared,
  buildInput,
  artifactId: "artifact_hash_test",
  workspaceRevisionId: "workspace_hash_test",
  runtimeSeriesId: "site-runtime-v1",
  runtimePatchId: "runtime_patch_hash_test",
  storagePrefix: "site-artifacts/site_hash_test/artifact_hash_test",
  toolchainVersion: "verification",
  sandboxImageDigest: `sha256:${"f".repeat(64)}` as const,
  browserGate: { findings: [], screenshotKeys: [], routesChecked: 1, linksChecked: 0 },
  createdAt: "2026-07-20T00:00:00.000Z"
};
const finalizedHashA = finalizePreparedArtifact(fixedFinalization);
const finalizedHashB = finalizePreparedArtifact(fixedFinalization);
assert(finalizedHashA.artifact.artifactHash === finalizedHashB.artifact.artifactHash, "Artifact hashing is not deterministic.");
assertThrows(
  () => siteBuildArtifactSchema.parse({
    ...finalizedHashA.artifact,
    factDeclarations: undefined,
    claims: finalizedHashA.artifact.factDeclarations
  }),
  "The retained artifact contract accepted the retired claims field."
);
const changedHash = finalizePreparedArtifact({
  ...fixedFinalization,
  prepared: {
    ...safePrepared,
    factDeclarations: [
      ...safePrepared.factDeclarations,
      { id: "hash_change", route: "/", text: "Collision Repair", kind: "free_text", sourceFactIds: [offering.id], autoDeclared: false }
    ]
  }
});
assert(changedHash.artifact.artifactHash !== finalizedHashA.artifact.artifactHash, "Fact declarations were excluded from artifact hashing.");
assert(
  changedHash.artifact.artifactHash !== siteVersionSchema.parse({
    schemaVersion: 1,
    id: "version_hash_test",
    siteId: buildInput.siteId,
    number: 1,
    status: "candidate",
    artifactId: finalizedHashA.artifact.id,
    artifactHash: finalizedHashA.artifact.artifactHash,
    workspaceRevisionId: finalizedHashA.artifact.workspaceRevisionId,
    publicBuildInputId: buildInput.id,
    formDefinitionIds: [],
    sourceSnapshotIds: [],
    assetRevisionIds: [],
    createdAt: fixedFinalization.createdAt,
    createdBy: { kind: "system", id: "verification" }
  }).artifactHash,
  "A declaration-tampered artifact still matched the pinned version hash."
);
const containedCopy = "careful vehicle surface inspection documents visible damage before the repair plan is prepared for the customer";
const asymmetricRepetition = prepareSiteArtifact({
  authoredArtifact: agentAuthoredArtifactSchema.parse({
    schemaVersion: "agent-authored-artifact-v2",
    compilerManifest: expectedSiteSandboxManifest,
    siteName: "Similarity verification",
    sharedCss: "body{font:16px Arial}main{padding:40px}",
    routes: [
      { path: "/", title: "Duplicate metadata", description: "The same deterministic metadata value", bodyHtml: `<main><h1>Shared route heading</h1><p>${containedCopy}</p><a href="/contained">Details</a> <p>Additional detailed context about scheduling materials preparation communication documentation finishing delivery follow up records estimates photographs timing approvals coordination quality controls and next steps.</p></main>` },
      { path: "/contained", title: "Duplicate metadata", description: "The same deterministic metadata value", bodyHtml: `<main><h1>Shared route heading</h1><p>${containedCopy}</p><a href="/contained">Details</a></main>` }
    ],
    factDeclarations: [],
    capabilityBindings: []
  }),
  buildInput,
  runtimeSeriesId: "site-runtime-v1"
});
const asymmetricMetric = asymmetricRepetition.qualityMetrics.routeSimilarity.find((metric) => metric.left === "/" && metric.right === "/contained");
assert(asymmetricMetric && asymmetricMetric.jaccard < 0.9 && asymmetricMetric.smallerPageContainment >= 0.95, `deterministic similarity metrics did not catch asymmetric page containment: ${JSON.stringify(asymmetricRepetition.qualityMetrics.routeSimilarity)}`);
assert(asymmetricRepetition.findings.some((finding) => finding.id === "route.repetitive_content" && finding.severity === "warning"), "asymmetric route repetition was not advisory");
assert(asymmetricRepetition.findings.some((finding) => finding.id === "metadata.title_duplicate" && finding.severity === "warning")
  && asymmetricRepetition.findings.some((finding) => finding.id === "metadata.description_duplicate" && finding.severity === "warning"), "duplicate route metadata was not advisory");
const serviceOffering = buildInput.business.offerings[0];
assert(serviceOffering, "synthetic V3 input has no offering for service-page verification");
const serviceGateInput = sitePublicBuildInputSchema.parse({
  ...buildInput,
  intent: {
    ...buildInput.intent,
    pageRequirements: [
      ...buildInput.intent.pageRequirements,
      { id: "page_service_gate", purpose: "service", slug: "service-gate", title: "Service detail", required: true, offeringId: serviceOffering.id }
    ]
  }
});
const explicitlyOmittedRequestedPage = prepareSiteArtifact({
  authoredArtifact: safe,
  buildInput: serviceGateInput,
  runtimeSeriesId: "site-runtime-v1"
});
assert(explicitlyOmittedRequestedPage.findings.some((finding) => finding.id === "route.required" && finding.severity === "warning"), "an intentionally omitted requested route was not reported as advisory");
assert(!explicitlyOmittedRequestedPage.findings.some((finding) => finding.id === "route.required" && finding.severity === "error"), "an intentionally omitted requested route still blocked an exact edit");
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
assert(unboundServicePage.findings.some((finding) => finding.id === "claim.service_detail_source"), "service page without offering evidence bindings passed the release hard gate");
const preparedCss = safePrepared.files.find((file) => file.path === "site.css")?.bytes.toString("utf8") ?? "";
assert(preparedCss.startsWith(platformCapabilityStyles), "finalized CSS does not begin with the canonical platform capability styles");
assert(preparedCss.endsWith(safe.sharedCss), "agent CSS no longer follows platform capability styles");
assert(formatPhoneForDisplay("+15125550142") === "(512) 555-0142", "SDK presentation did not format a valid canonical US phone");
assert(formatPhoneForDisplay("+442079460958") === "+442079460958" && formatPhoneForDisplay("call the front desk") === "call the front desk", "SDK presentation changed an international or unknown phone value");
const orderedHours = orderedLocationHours(buildInput.business.locations[0]?.hours);
assert(orderedHours.map((item) => item.label).join("|") === "Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday", "managed canonical location hours are not Monday-first");
assert(buildInput.business.locations[0]?.googlePlaceId === "ChIJ-synthetic-location", "synthetic public build input omitted the Google place ID");

const normalizedSidecars = agentAuthoredArtifactSchema.parse(normalizeAgentAuthoredArtifact({
  ...safe,
  factDeclarations: [{ text: "Collision Repair", factIds: [offering.id] }],
  capabilityBindings: { form: { formId: buildInput.forms[0].id } }
}));
assert(normalizedSidecars.factDeclarations[0]?.route === "/" && normalizedSidecars.factDeclarations[0]?.kind === "free_text", "authored claim shorthand was not normalized");
assert(normalizedSidecars.capabilityBindings.some((binding) => binding.kind === "form" && binding.config.formId === buildInput.forms[0].id), "SDK form hook did not derive its capability binding");

const parityInput = sitePublicBuildInputSchema.parse({
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
const claimValidator = new FactDeclarationValidator();
const formattedSdkResult = claimValidator.validate({
  routes: [{
    path: "/",
    html: `<main><a data-lodesta-fact-id="${phone.id}" href="tel:+15125550142">(512) 555-0142</a><dl data-lodesta-fact-id="fact_hours"><div><dt>Monday</dt><dd>8:00 AM-5:30 PM</dd></div><div><dt>Saturday</dt><dd>Closed</dd></div></dl></main>`
  }],
  declarations: [],
  buildInput
});
assert(formattedSdkResult.status === "pass", `formatted SDK bindings failed claim validation: ${formattedSdkResult.findings.map((finding) => finding.message).join("; ")}`);
assert(formattedSdkResult.declarations.some((claim) => claim.sourceFactIds.includes(phone.id)), "formatted SDK phone did not produce a source-bound declaration");
assert(formattedSdkResult.declarations.filter((claim) => claim.sourceFactIds.includes("fact_hours")).map((claim) => claim.text).sort().join("|") === "8:00 AM-5:30 PM|Closed", "structured SDK hours did not declare every distinct rendered canonical value");
const sourceBoundOfferInput = sitePublicBuildInputSchema.parse({
  ...parityInput,
  publicFacts: [
    ...parityInput.publicFacts,
    {
      id: "fact_free_estimates", kind: "offering", label: "Offering", value: "Free estimates", publicEligible: true,
      source: { factId: "fact_free_estimates", sourceSnapshotId: "source_owner", observedAt: "2026-07-20T00:00:00.000Z", confidence: 1, ownerConfirmed: true }
    },
    {
      id: "fact_insurance_work", kind: "offering", label: "Offering", value: "Insurance work", publicEligible: true,
      source: { factId: "fact_insurance_work", sourceSnapshotId: "source_owner", observedAt: "2026-07-20T00:00:00.000Z", confidence: 1, ownerConfirmed: true }
    }
  ]
});
const sourceBoundOffer = claimValidator.validate({
  routes: [{ path: "/", html: '<main><p data-lodesta-fact-id="fact_free_estimates">Free estimates</p></main>' }],
  declarations: [],
  buildInput: sourceBoundOfferInput
});
assert(sourceBoundOffer.status === "pass", `source-bound canonical offer failed sensitive claim validation: ${sourceBoundOffer.findings.map((finding) => finding.message).join("; ")}`);
const sourceBoundInsuranceOffer = claimValidator.validate({
  routes: [{ path: "/", html: '<main><p data-lodesta-fact-id="fact_insurance_work">Insurance work</p></main>' }],
  declarations: [],
  buildInput: sourceBoundOfferInput
});
assert(sourceBoundInsuranceOffer.status === "pass", `source-bound offering name triggered a false insurance claim: ${sourceBoundInsuranceOffer.findings.map((finding) => finding.message).join("; ")}`);
const unboundOffer = claimValidator.validate({
  routes: [{ path: "/", html: "<main><p>Free estimates</p></main>" }],
  declarations: [],
  buildInput: sourceBoundOfferInput
});
assert(unboundOffer.status === "fail" && unboundOffer.findings.some((finding) => finding.id === "claim.sensitive_unsupported"), "unbound pricing language bypassed sensitive claim validation");
for (const parityCase of claimParity.cases) {
  const result = claimValidator.validate({
    routes: [{ path: "/", html: parityCase.html }],
    declarations: parityCase.declarations as Parameters<FactDeclarationValidator["validate"]>[0]["declarations"],
    buildInput: parityInput
  });
  assert(result.status === parityCase.expected, `claim parity case ${parityCase.id} expected ${parityCase.expected}, received ${result.status}`);
}
const advisoryPuffery = claimValidator.validate({
  routes: [{ path: "/", html: "<main><p>Thoughtful service with a personal touch.</p></main>" }],
  declarations: [{
    id: "advisory_puffery",
    route: "/",
    text: "Thoughtful service with a personal touch.",
    kind: "free_text",
    sourceFactIds: [businessName.id],
    autoDeclared: false
  }],
  buildInput: parityInput
});
assert(advisoryPuffery.status === "pass" && advisoryPuffery.findings.some((finding) => finding.severity === "warning"), "ordinary marketing language became a factual hard blocker");
const metadataClaimResult = claimValidator.validate({
  routes: [{ path: "/", title: "Five-star collision repair", description: "Lifetime warranty", html: "<main><h1>Collision repair</h1></main>" }],
  declarations: [],
  buildInput: parityInput
});
assert(metadataClaimResult.status === "fail" && metadataClaimResult.findings.some((finding) => finding.id === "claim.sensitive_unsupported"), "unsupported metadata claims bypassed factual validation");

const disabledCapabilityInput = sitePublicBuildInputSchema.parse({
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
const syntheticState = businessStateSchema.parse({
  schemaVersion: 1,
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
const ineligibleParallelState = businessStateSchema.parse({
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
const observedProofState = businessStateSchema.parse({
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

const thirdPartyProofState = businessStateSchema.parse({
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

const confirmedProofState = businessStateSchema.parse({
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
    state: businessStateSchema.parse({ ...confirmedProofState, proof: confirmedProofState.proof.map((item) => ({ ...item, publicText: "They explained each repair clearly." })) }),
    intent: buildInput.intent, forms: buildInput.forms, domainContext: syntheticVertical,
    sourceSnapshotIds: buildInput.sourceSnapshotIds, createdAt: buildInput.createdAt
  });
} catch { partialProofRejected = true; }
assert(partialProofRejected, "partial testimonial text was accepted as verbatim source proof");

const syntheticPrepared = prepareSiteArtifact({
  authoredArtifact: agentAuthoredArtifactSchema.parse({
    schemaVersion: "agent-authored-artifact-v2",
    compilerManifest: expectedSiteSandboxManifest,
    siteName: syntheticProjection.business.name,
    sharedCss: "body{margin:0;color:#111;background:#fff;font:18px/1.5 Arial,sans-serif}main{padding:48px}",
    routes: [{ path: "/", title: syntheticProjection.business.name, description: "Synthetic module test", bodyHtml: `<main><h1 data-lodesta-fact-id="${syntheticState.facts[0].id}">${syntheticProjection.business.name}</h1></main>` }],
    factDeclarations: [],
    capabilityBindings: []
  }),
  buildInput: syntheticProjection,
  runtimeSeriesId: "site-runtime-v1"
});
assert(syntheticPrepared.files.some((file) => file.bytes.toString("utf8").includes('"@type":"LocalBusiness"')), "neutral finalization ignored the pinned module structured-data type");

assert(controlPlaneChangePayloadSchema.parse({ kind: "add_offering", name: "ADAS Calibration", pageMode: "dedicated" }).kind === "add_offering", "typed control plane rejected an owner-added custom service");
assert(canAccessAgentSession({ actorId: "owner_a", isOperator: false }, "owner_a"), "an owner could not access their own agent session");
assert(!canAccessAgentSession({ actorId: "owner_b", isOperator: false }, "owner_a"), "a same-site co-owner could access another owner's agent session");
assert(canAccessAgentSession({ actorId: "operator", isOperator: true }, "owner_a"), "an operator could not access an owner session for support");
const priorRequireAuth = process.env.LODESTA_REQUIRE_AUTH;
process.env.LODESTA_REQUIRE_AUTH = "true";
const unauthorizedReadiness = await readSiteReadinessRoute(new Request("http://127.0.0.1/api/sites/missing/readiness"), { params: Promise.resolve({ siteId: "missing" }) });
assert(unauthorizedReadiness.status === 401, "readiness endpoint did not require an owner or operator");
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
    createdAt: "2026-07-20T00:00:00.000Z"
  });
  assert(!overlapAudit.orphanedManagedObjects.some((object) => object.key === sidecarKey), "retained workspace source sidecar was classified as deletable");
  assert(overlapAudit.orphanedManagedObjects.some((object) => object.store === "artifact" && object.key === backupKey), "retired rollback copy was not classified as an orphan");
  const maintenanceStore = new LocalArtifactBlobMaintenanceStore({
    artifact: join(repositoryDir, "maintenance-artifact"),
    workspace: join(repositoryDir, "maintenance-workspace")
  });
  await maintenanceStore.putImmutable("workspace", { key: backupKey, bytes: Buffer.from("archive"), contentType: "application/gzip", contentHash: overlapHash });
  assert((await maintenanceStore.listPage("workspace", { prefix: "workspace-backups/", limit: 1 })).objects[0]?.store === "workspace", "local two-store inventory lost its location");
  const capacityRepository = new LocalSitePlatformRepository(join(repositoryDir, "capacity-repository.json"));
  for (let index = 1; index <= 5; index += 1) {
    await capacityRepository.saveAgentRun(siteAgentRunSchema.parse({
      schemaVersion: "site-agent-run",
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
      executionNumber: 0,
      skillVersions: {},
      usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, costEstimateStatus: "unavailable", durationMs: 0 },
      startedAt: `2026-07-20T00:00:0${index}.000Z`
    }));
  }
  for (let index = 1; index <= 4; index += 1) assert(await capacityRepository.claimAgentRun(`run_capacity_${index}`), `capacity slot ${index} was not claimed`);
  assert(!(await capacityRepository.claimAgentRun("run_capacity_5")), "atomic run capacity admitted more than four running runs");
  const cutoverToken = `sha256:${"c".repeat(64)}`;
  assert(await capacityRepository.acquireMaintenanceLease("site_authoring_maintenance", cutoverToken, "2026-07-20T00:00:00.000Z", "2026-07-20T01:00:00.000Z"), "site-authoring maintenance lease was not acquired");
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
  await repository.saveVerticalDemandEvent(verticalDemandEventSchema.parse({
    schemaVersion: "vertical-demand-event",
    id: "vertical_demand_atomic_test",
    sourceUrl: "https://landscaping.example/",
    observedVertical: "unsupported",
    requestedBy: "verification",
    status: "open",
    createdAt: "2026-07-20T00:00:30.000Z"
  }));
  assert((await repository.listVerticalDemandEvents("open")).length === 1, "unmatched domain demand was not retained independently of site state");
  const revision = siteWorkspaceRevisionSchema.parse({
    schemaVersion: 1, id: "workspace_atomic_test", siteId: site.id, revisionNumber: 1,
    sourceHash: `sha256:${"1".repeat(64)}`, sourceArchiveKey: `workspace-backups/${"1".repeat(64)}.tar.gz`,
    files: [{ path: "src/site.tsx", contentHash: `sha256:${"2".repeat(64)}`, bytes: 100 }],
    createdAt: "2026-07-20T00:01:00.000Z", createdBy: { kind: "system", id: "verification" }
  });
  const artifactBase = {
    schemaVersion: 1 as const, id: "artifact_atomic_test", siteId: site.id,
    workspaceRevisionId: revision.id, publicBuildInputId: "input_atomic_test", createdAt: "2026-07-20T00:02:00.000Z",
    artifactHash: `sha256:${"3".repeat(64)}`, storagePrefix: "site-artifacts/site_atomic_test/artifact_atomic_test",
    files: [{ path: "index.html", contentType: "text/html", contentHash: `sha256:${"4".repeat(64)}`, bytes: 200, storageKey: "site-artifacts/site_atomic_test/artifact_atomic_test/index.html" }],
    routes: [{ path: "/", htmlFile: "index.html", title: "Atomic Test", description: "Atomic build test" }],
    factDeclarations: [], capabilityBindings: [], runtimeSeriesId: "site-runtime-v1", runtimePatchAtFinalization: "runtime_patch_test",
    toolchainVersion: "verification", sandboxImageDigest: `sha256:${"5".repeat(64)}`
  };
  const failedArtifact = siteBuildArtifactSchema.parse({
    ...artifactBase,
    qa: { hardGate: "failed", checkedAt: "2026-07-20T00:02:00.000Z", routesChecked: 1, linksChecked: 0, findings: [], screenshotKeys: [] }
  });
  let rejectedFailedBuild = false;
  try { await repository.commitVerifiedBuild({ revision, artifact: failedArtifact }); } catch { rejectedFailedBuild = true; }
  assert(rejectedFailedBuild && !(await repository.getSite(site.id))?.currentWorkspaceRevisionId, "failed build advanced the canonical workspace");
  const passedArtifact = siteBuildArtifactSchema.parse({
    ...artifactBase,
    qa: { hardGate: "passed", checkedAt: "2026-07-20T00:02:00.000Z", routesChecked: 1, linksChecked: 0, findings: [], screenshotKeys: [] }
  });
  await repository.commitVerifiedBuild({ revision, artifact: passedArtifact });
  assert((await repository.getSite(site.id))?.currentWorkspaceRevisionId === revision.id, "verified build did not atomically advance the workspace");
  assert((await repository.getBuildArtifact(passedArtifact.id))?.id === passedArtifact.id, "verified build did not atomically retain its artifact");
  const queuedRun = siteAgentRunSchema.parse({
    schemaVersion: "site-agent-run", id: "run_atomic_claim", sessionId: "session_atomic_claim", siteId: site.id,
    publicBuildInputId: "input_atomic_claim", origin: "system", requestedBy: "verification", publishAfterSuccess: false,
    kind: "edit", status: "queued", stage: "queued", exactParentRevisionId: revision.id,
    modelId: "verification", executionNumber: 0, skillVersions: {},
    usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, costEstimateStatus: "unavailable", durationMs: 0 },
    startedAt: "2026-07-20T00:03:00.000Z"
  });
  await repository.saveAgentRun(queuedRun);
  const claimed = await repository.claimAgentRun(queuedRun.id);
  assert(claimed?.status === "running" && claimed.executionNumber === 1 && Boolean(claimed.heartbeatAt), "queued run was not atomically claimed");
  assert(await repository.claimAgentRun(queuedRun.id) === undefined, "a running job was claimed twice");

  const coalesceSite = platformSiteRecordSchema.parse({
    id: buildInput.siteId, businessId: buildInput.businessId, slug: "coalesce-test", status: "draft",
    createdAt: buildInput.createdAt, updatedAt: buildInput.createdAt
  });
  await repository.createSite(coalesceSite);
  await repository.saveSiteIntent(buildInput.intent);
  await repository.savePublicBuildInput(buildInput);
  await repository.setCurrentPublicBuildInput(coalesceSite.id, buildInput.id);
  const coalesceSession = siteAgentSessionSchema.parse({
    schemaVersion: "site-agent-session", id: "session_coalesce_test", siteId: coalesceSite.id, ownerId: "owner_coalesce_test",
    status: "active", publicBuildInputId: buildInput.id, sandboxProvider: "cloudflare", leaseTokenHash: `sha256:${"7".repeat(64)}`,
    leaseExpiresAt: "2026-07-20T01:00:00.000Z", rotateAt: "2026-07-20T02:00:00.000Z",
    createdAt: "2026-07-20T00:00:00.000Z", updatedAt: "2026-07-20T00:00:00.000Z"
  });
  await repository.saveAgentSession(coalesceSession);
  const discussionSession = siteAgentSessionSchema.parse({
    ...coalesceSession,
    id: "session_discussion_test",
    ownerId: "owner_discussion_test",
    sandboxId: "sandbox-discussion-test",
    leaseExpiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    rotateAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString()
  });
  await repository.saveAgentSession(discussionSession);
  let discussionTouchedSandbox = false;
  const discussionWorkflow = new SiteAuthoringWorkflow(
    repository,
    {} as never,
    { diagnostics: async () => { discussionTouchedSandbox = true; return { ok: true, revision: "discussion-revision" }; } } as never,
    {
      discuss: async () => ({
        discussion: {
          schemaVersion: "manager-discussion",
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
  assert(discussionResult.discussion.requiresApply && Boolean(discussionResult.discussion.proposedAction), "Discussion did not retain its suggested Build action");
  assert((await repository.listAgentMessages(discussionSession.id)).length === 2, "Discussion did not persist the owner and manager messages");
  assert((await repository.listAgentRuns(discussionSession.id)).length === 0, "Discussion created an agent run");
  assert((await repository.listSiteVersions(coalesceSite.id)).length === versionsBeforeDiscussion.length, "Discussion created a site version");
  assert((await repository.getSite(coalesceSite.id))?.currentWorkspaceRevisionId === siteBeforeDiscussion?.currentWorkspaceRevisionId, "Discussion advanced the workspace revision");
  assert(!discussionTouchedSandbox, "Discussion allocated or inspected a Cloudflare sandbox");
  const editSite = platformSiteRecordSchema.parse({
    id: "site_direct_edit_test", businessId: "business_direct_edit_test", slug: "direct-edit-test", status: "draft",
    createdAt: buildInput.createdAt, updatedAt: buildInput.createdAt
  });
  const editInput = sitePublicBuildInputSchema.parse({
    ...buildInput,
    id: "input_direct_edit_test",
    siteId: editSite.id,
    businessId: editSite.businessId,
    intent: { ...buildInput.intent, id: "intent_direct_edit_test", siteId: editSite.id },
    inputHash: `sha256:${"8".repeat(64)}`
  });
  const editSession = siteAgentSessionSchema.parse({
    ...coalesceSession,
    id: "session_direct_edit_test",
    siteId: editSite.id,
    ownerId: "owner_direct_edit_test",
    publicBuildInputId: editInput.id
  });
  await repository.createSite(editSite);
  await repository.saveSiteIntent(editInput.intent);
  await repository.savePublicBuildInput(editInput);
  await repository.setCurrentPublicBuildInput(editSite.id, editInput.id);
  await repository.saveAgentSession(editSession);
  const eventBlobStore = new LocalArtifactBlobStore(join(repositoryDir, "run-event-blobs"));
  const authoringWorkflow = () => new SiteAuthoringWorkflow(
    repository,
    eventBlobStore,
    {} as never,
    {} as never,
    operations
  );
  const readyApply = await authoringWorkflow().enqueueEdit({ session: editSession, instruction: "Add /gallery and link it from navigation.", requestedBy: editSession.ownerId });
  assert(readyApply.run.kind === "edit", "direct Apply did not create the canonical edit run");
  assert((await repository.listAgentRunEvents(readyApply.run.id)).length === 0, "direct Apply created a separate orchestration phase");
  await repository.saveAgentRun(siteAgentRunSchema.parse({
    ...readyApply.run,
    status: "needs_input",
    stage: "needs_input",
    inputQuestion: "Which phone number should be primary?",
    inputExpiresAt: "2099-07-29T00:00:00.000Z"
  }));
  const interveningRevision = siteWorkspaceRevisionSchema.parse({
    ...revision,
    id: "workspace_revision_intervening_edit",
    siteId: editSite.id,
    parentRevisionId: undefined,
    revisionNumber: 1,
    sourceArchiveKey: "workspace-backups/site_direct_edit_test/intervening.tar.gz",
    createdBy: { kind: "owner", id: editSession.ownerId }
  });
  const interveningArtifact = siteBuildArtifactSchema.parse({
    ...passedArtifact,
    id: "artifact_intervening_edit",
    siteId: editSite.id,
    workspaceRevisionId: interveningRevision.id,
    publicBuildInputId: editInput.id,
    artifactHash: `sha256:${"6".repeat(64)}`,
    storagePrefix: "site-artifacts/site_direct_edit_test/artifact_intervening_edit"
  });
  await repository.commitVerifiedBuild({ revision: interveningRevision, artifact: interveningArtifact });
  const currentResumeInput = sitePublicBuildInputSchema.parse({
    ...editInput,
    id: "input_direct_edit_current",
    inputHash: `sha256:${"9".repeat(64)}`,
    createdAt: "2026-07-20T00:06:30.000Z"
  });
  await repository.savePublicBuildInput(currentResumeInput);
  await repository.setCurrentPublicBuildInput(editSite.id, currentResumeInput.id);
  let crossSessionResumeRejected = false;
  try {
    await authoringWorkflow().resumeNeedsInput({
      runId: readyApply.run.id,
      sessionId: "session_unrelated",
      answer: "Use the verified main office number.",
      actorId: editSession.ownerId
    });
  } catch (error) {
    crossSessionResumeRejected = error instanceof Error && error.message === "run_session_mismatch";
  }
  assert(crossSessionResumeRejected, "clarification resume accepted a run from another session");
  const resumed = await authoringWorkflow().resumeNeedsInput({
    runId: readyApply.run.id,
    sessionId: editSession.id,
    answer: "Use the verified main office number.",
    actorId: editSession.ownerId
  });
  assert(resumed.id === readyApply.run.id && resumed.status === "queued", "clarification did not resume the same live run");
  assert(resumed.exactParentRevisionId === interveningRevision.id, "clarification resumed against a stale workspace head");
  assert(resumed.publicBuildInputId === currentResumeInput.id, "clarification resumed against stale public evidence");
  assert((await repository.getAgentSession(editSession.id))?.publicBuildInputId === currentResumeInput.id, "clarification did not advance the retained session input");
  await repository.saveAgentRun(siteAgentRunSchema.parse({ ...resumed, status: "cancelled", completedAt: new Date().toISOString() }));

  const expiringApply = await authoringWorkflow().enqueueEdit({ session: editSession, instruction: "Update the contact emphasis.", requestedBy: editSession.ownerId });
  await repository.saveAgentRun(siteAgentRunSchema.parse({
    ...expiringApply.run,
    status: "needs_input",
    stage: "needs_input",
    inputQuestion: "Should calls or forms be emphasized?",
    inputExpiresAt: "2020-01-01T00:00:00.000Z"
  }));
  const restarted = await authoringWorkflow().resumeNeedsInput({
    runId: expiringApply.run.id,
    sessionId: editSession.id,
    answer: "Emphasize calls.",
    actorId: editSession.ownerId
  });
  assert(restarted.id !== expiringApply.run.id && restarted.exactParentRevisionId === interveningRevision.id, "expired clarification did not restart from the current workspace head");
  assert(restarted.publicBuildInputId === currentResumeInput.id, "expired clarification did not restart from current public evidence");
  assert((await repository.getAgentRun(expiringApply.run.id))?.status === "cancelled", "expired clarification run was not cancelled");
  await repository.saveAgentRun(siteAgentRunSchema.parse({ ...restarted, status: "cancelled", completedAt: new Date().toISOString() }));
  const leaseToken = `sha256:${"a".repeat(64)}`;
  assert(await repository.acquireMaintenanceLease("run-event-test", leaseToken, "2026-07-20T00:00:00.000Z", "2026-07-20T01:00:00.000Z"), "first maintenance lease claim failed");
  assert(!(await repository.acquireMaintenanceLease("run-event-test", `sha256:${"b".repeat(64)}`, "2026-07-20T00:30:00.000Z", "2026-07-20T01:30:00.000Z")), "active maintenance lease was claimed twice");
  assert(await repository.renewMaintenanceLease("run-event-test", leaseToken, "2026-07-20T00:30:00.000Z", "2026-07-20T02:00:00.000Z"), "owned maintenance lease did not renew");
  assert(!(await repository.releaseMaintenanceLease("run-event-test", `sha256:${"b".repeat(64)}`)), "foreign maintenance lease token released the lease");
  assert(await repository.releaseMaintenanceLease("run-event-test", leaseToken), "owned maintenance lease did not release");
  const destroyedSandboxIds: string[] = [];
  const workflow = new SiteAuthoringWorkflow(
    repository,
    {} as never,
    { destroy: async (sandboxId: string) => { destroyedSandboxIds.push(sandboxId); } } as never,
    {} as never,
    operations
  );
  const deadlineSession = siteAgentSessionSchema.parse({
    ...coalesceSession,
    id: "session_deadline_test",
    ownerId: "owner_deadline_test",
    status: "active",
    sandboxId: undefined
  });
  await repository.saveAgentSession(deadlineSession);
  const deadlineRun = siteAgentRunSchema.parse({
    schemaVersion: "site-agent-run",
    id: "run_deadline_test",
    sessionId: deadlineSession.id,
    siteId: coalesceSite.id,
    publicBuildInputId: buildInput.id,
    origin: "owner_request",
    requestedBy: deadlineSession.ownerId,
    publishAfterSuccess: false,
    kind: "edit",
    status: "queued",
    stage: "queued",
    modelId: "verification",
    executionNumber: 0,
    skillVersions: {},
    usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, costEstimateStatus: "unavailable", durationMs: 0 },
    startedAt: new Date(Date.now() - siteEditDeadlineMs - 1_000).toISOString()
  });
  await repository.saveAgentRun(deadlineRun);
  const deadlineFailure = await workflow.executeRun(deadlineRun.id);
  assert(deadlineFailure.status === "failed" && deadlineFailure.failureReason === "workflow_deadline_exhausted", "expired edit workflow did not fail closed at its orchestration deadline");
  assert(deadlineFailure.failureCode === "deadline_exhausted" && deadlineFailure.failureCategory === "budget" && !deadlineFailure.retryableByOwner,
    "expired edit workflow did not persist a non-retryable budget classification");
  assert((await repository.getAgentSession(deadlineSession.id))?.status === "checkpointed", "deadline failure did not clean up its leased session resources");
  assert((await repository.listOperatorQueue()).some((item) => item.runId === deadlineRun.id && item.reason === "authoring_runtime_failure" && item.findings.some((finding) => finding.message === "workflow_deadline_exhausted")), "deadline failure did not persist its terminal diagnostic");
  let deadlineRetryRejected = false;
  try {
    await workflow.retryFailedRun({ runId: deadlineRun.id, actorId: deadlineSession.ownerId });
  } catch (error) {
    deadlineRetryRejected = error instanceof Error && error.message === "run_not_retryable";
  }
  assert(deadlineRetryRejected, "non-retryable budget failure could be resubmitted by an owner");
  const startFailureSession = siteAgentSessionSchema.parse({
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
  const startFailureWorkflow = new SiteAuthoringWorkflow(
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
  const staleManifestSession = siteAgentSessionSchema.parse({
    ...coalesceSession,
    id: "session_stale_manifest_test",
    ownerId: "owner_stale_manifest_test",
    sandboxId: "sandbox-stale-manifest-test",
    leaseExpiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    rotateAt: new Date(Date.now() + 2 * 60 * 60_000).toISOString()
  });
  await repository.saveAgentSession(staleManifestSession);
  const staleManifestRun = siteAgentRunSchema.parse({
    schemaVersion: "site-agent-run",
    id: "run_stale_manifest_test",
    sessionId: staleManifestSession.id,
    siteId: coalesceSite.id,
    publicBuildInputId: buildInput.id,
    origin: "system",
    requestedBy: staleManifestSession.ownerId,
    publishAfterSuccess: false,
    kind: "initial_build",
    status: "queued",
    stage: "queued",
    modelId: "verification",
    executionNumber: 0,
    skillVersions: {},
    usage: { inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0, costEstimateStatus: "unavailable", durationMs: 0 },
    startedAt: new Date().toISOString()
  });
  await repository.saveAgentRun(staleManifestRun);
  let staleManifestManagerCalls = 0;
  const staleManifestWorkflow = new SiteAuthoringWorkflow(
    repository,
    {} as never,
    {
      diagnostics: async () => ({
        ok: true,
        revision: "stale-manifest-revision",
        versions: [],
        sandboxManifest: {
          ...expectedSiteSandboxManifest,
          artifactContractVersion: "agent-authored-artifact-v1"
        },
        placementId: "stale-placement",
        processes: []
      }),
      bootstrap: async () => ({ ok: true, revision: "fresh-stale-manifest-revision" }),
      destroy: async () => ({ ok: true })
    } as never,
    { run: async () => { staleManifestManagerCalls += 1; throw new Error("manager_must_not_run"); } } as never,
    operations
  );
  const staleManifestFailure = await staleManifestWorkflow.executeRun(staleManifestRun.id);
  assert(staleManifestFailure.failureCode === "platform_version_mismatch" && staleManifestFailure.failureCategory === "platform",
    "fresh stale sandbox did not fail with a typed platform mismatch");
  assert(staleManifestManagerCalls === 0 && staleManifestFailure.usage.inputTokens === 0,
    "sandbox manifest mismatch consumed a model request");
  await Promise.all([
    workflow.recoverRunIfStale(queuedRun.id, -1),
    workflow.recoverRunIfStale(queuedRun.id, -1)
  ]);
  const restartedRun = await repository.getAgentRun(queuedRun.id);
  assert(restartedRun?.status === "queued" && restartedRun.stage === "queued", "overlapping interrupted-run recovery did not converge on one queued checkpoint");
  assert(restartedRun.executionNumber === 1, "overlapping recovery incremented the execution number");
  const competingClaims = await Promise.all([
    repository.claimAgentRun(queuedRun.id),
    repository.claimAgentRun(queuedRun.id)
  ]);
  const claimedRuns = competingClaims.filter((run) => Boolean(run));
  assert(claimedRuns.length === 1, "overlapping recovery allowed more than one subsequent executor");
  const secondClaim = claimedRuns[0];
  assert(secondClaim?.executionNumber === 2, "restarted run did not retain the execution count");
  const exhaustedRun = await workflow.recoverRunIfStale(queuedRun.id, -1);
  assert(exhaustedRun.status === "failed", "interrupted second execution did not stop at the recovery bound");
  let staleSelectionRejected = false;
  try {
    await workflow.enqueueRun({
      session: coalesceSession, kind: "edit", instruction: "Change this element.", requestedBy: coalesceSession.ownerId,
      selection: { route: "/", selector: "#hero", workspaceRevisionId: "workspace_stale_selection" }
    });
  } catch (error) {
    staleSelectionRejected = error instanceof Error && error.message === "stale_selection";
  }
  assert(staleSelectionRejected, "stale selected-element context was accepted");
  const ownerRun = await workflow.enqueueRun({
    session: coalesceSession, kind: "edit", instruction: "Make the hero more direct.", requestedBy: coalesceSession.ownerId
  });
  const firstControlRun = await workflow.enqueueRun({
    session: coalesceSession, kind: "rebase", instruction: "Apply confirmed hours.", requestedBy: coalesceSession.ownerId,
    origin: "control_plane", deferBehindActive: true, publishAfterSuccess: true
  });
  const coalescedControlRun = await workflow.enqueueRun({
    session: coalesceSession, kind: "edit", instruction: "Add the confirmed service.", requestedBy: coalesceSession.ownerId,
    origin: "control_plane", deferBehindActive: true, publishAfterSuccess: false
  });
  assert(firstControlRun.id === coalescedControlRun.id, "control-plane reconciliation was not coalesced");
  assert(coalescedControlRun.deferredUntilRunId === ownerRun.id, "control-plane run did not serialize behind the active owner run");
  assert(coalescedControlRun.kind === "edit" && !coalescedControlRun.publishAfterSuccess, "edit coalescing retained unsafe auto-publish behavior");
  assert((await workflow.executeRun(coalescedControlRun.id)).status === "queued", "deferred run executed before its predecessor");
  const retrySession = siteAgentSessionSchema.parse({
    ...coalesceSession,
    id: "session_retry_test",
    ownerId: "owner_retry_test"
  });
  await repository.saveAgentSession(retrySession);
  const failedRetrySource = siteAgentRunSchema.parse({
    schemaVersion: "site-agent-run",
    id: "run_retry_source_test",
    sessionId: retrySession.id,
    siteId: coalesceSite.id,
    publicBuildInputId: buildInput.id,
    origin: "owner_request",
    requestedBy: retrySession.ownerId,
    publishAfterSuccess: false,
    kind: "edit",
    status: "failed",
    stage: "failed",
    modelId: "verification",
    executionNumber: 2,
    skillVersions: {},
    usage: { inputTokens: 10, outputTokens: 2, estimatedCostUsd: 0, costEstimateStatus: "unavailable", durationMs: 50 },
    failureCode: "provider_temporarily_unavailable",
    failureCategory: "provider",
    retryableByOwner: true,
    failureReason: "Synthetic retry source.",
    startedAt: "2026-07-20T00:07:00.000Z",
    completedAt: "2026-07-20T00:08:00.000Z"
  });
  await repository.saveAgentRun(failedRetrySource);
  await repository.appendAgentMessage({
    schemaVersion: "site-agent-message",
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
  const expiredSession = siteAgentSessionSchema.parse({
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
  const expiredCheckpointedSession = siteAgentSessionSchema.parse({
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
  const destroyFailureSession = siteAgentSessionSchema.parse({
    ...coalesceSession,
    id: "session_destroy_failure_test",
    ownerId: "owner_destroy_failure_test",
    sandboxId: "sandbox-destroy-failure-test",
    sandboxLastStartedAt: "2026-07-20T00:00:00.000Z",
    leaseExpiresAt: "2026-07-20T00:10:00.000Z"
  });
  await repository.saveAgentSession(destroyFailureSession);
  const failedDestroyWorkflow = new SiteAuthoringWorkflow(
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
  const rightsState = businessStateSchema.parse({
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
  const rightsInput = sitePublicBuildInputSchema.parse({
    ...buildInput,
    id: "input_rights_gate_test",
    siteId: rightsSiteId,
    businessId: rightsBusinessId,
    business: { ...buildInput.business, assets: [rightsAsset] },
    intent: rightsIntent,
    forms: [rightsForm],
    assetRevisionIds: [rightsAsset.revisionId]
  });
  const rightsSource = sourceSnapshotSchema.parse({
    schemaVersion: 1, id: rightsInput.sourceSnapshotIds[0], businessId: rightsBusinessId,
    sourceType: "owner_input", contentHash: `sha256:${"c".repeat(64)}`,
    capturedAt: buildInput.createdAt, payload: { verification: "rights gate" }
  });
  const rightsAssetRevision = assetRevisionSchema.parse({
    schemaVersion: 1, id: rightsAsset.revisionId, assetId: rightsAsset.assetId,
    businessId: rightsBusinessId, contentHash: rightsAsset.contentHash, storageKey: rightsAsset.storageKey,
    publicUrl: rightsAsset.publicUrl, mimeType: rightsAsset.mimeType, bytes: 128,
    provenance: { verification: "rights gate" }, rightsStatus: rightsAsset.rightsStatus, createdAt: buildInput.createdAt
  });
  await repository.bootstrapSite({
    site: rightsSite, state: rightsState, intent: rightsIntent, forms: [rightsForm],
    sourceSnapshots: [rightsSource], assetRevisions: [rightsAssetRevision], publicBuildInput: rightsInput
  });
  const rightsRevision = siteWorkspaceRevisionSchema.parse({
    ...revision, id: "workspace_rights_gate_test", siteId: rightsSiteId,
    sourceHash: `sha256:${"9".repeat(64)}`, sourceArchiveKey: `workspace-backups/${"9".repeat(64)}.tar.gz`
  });
  const rightsArtifact = siteBuildArtifactSchema.parse({
    ...passedArtifact, id: "artifact_rights_gate_test", siteId: rightsSiteId, workspaceRevisionId: rightsRevision.id,
    publicBuildInputId: rightsInput.id, artifactHash: `sha256:${"a".repeat(64)}`,
    storagePrefix: "site-artifacts/site_rights_gate_test/artifact_rights_gate_test",
    files: [{ ...passedArtifact.files[0], contentHash: `sha256:${"b".repeat(64)}`, storageKey: "site-artifacts/site_rights_gate_test/artifact_rights_gate_test/index.html" }]
  });
  await repository.commitVerifiedBuild({ revision: rightsRevision, artifact: rightsArtifact });
  const rightsVersion = siteVersionSchema.parse({
    schemaVersion: 1, id: "version_rights_gate_test", siteId: rightsSiteId, number: 1, status: "candidate",
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

  const controlPlane = new ControlPlaneService(repository, workflow);
  const addedOffering = await controlPlane.submit({
    siteId: rightsSiteId,
    requestedBy: "owner_control_plane_test",
    payload: { kind: "add_offering", name: "Custom Aluminum Repair", pageMode: "dedicated" }
  });
  assert(addedOffering.applied, "owner-added service did not apply through the typed control plane");
  assert("run" in addedOffering && addedOffering.run, "owner-added structural service did not enqueue a site run");
  assert(addedOffering.run.kind === "edit" && !addedOffering.run.publishAfterSuccess, "owner-added structural service was allowed to auto-publish");
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
  await repository.saveAgentRun(siteAgentRunSchema.parse({
    ...addedOffering.run,
    status: "succeeded",
    stage: "candidate_ready",
    completedAt: "2026-07-20T00:07:30.000Z"
  }));
  const policySession = await repository.getActiveAgentSession(rightsSiteId, "owner_control_plane_test");
  assert(policySession, "policy-only verification could not load the control-plane session");
  const [runsBeforePolicy, versionsBeforePolicy] = await Promise.all([
    repository.listAgentRuns(policySession.id),
    repository.listSiteVersions(rightsSiteId)
  ]);
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
  assert(policyChange.applied && !("run" in policyChange), "agent access policy change created a site run");
  const siteAfterPolicy = await repository.getSite(rightsSiteId);
  const intentAfterPolicy = await repository.getSiteIntent(rightsSiteId);
  const [runsAfterPolicy, versionsAfterPolicy] = await Promise.all([
    repository.listAgentRuns(policySession.id),
    repository.listSiteVersions(rightsSiteId)
  ]);
  assert(siteAfterPolicy?.currentPublicBuildInputId === siteAfterOffering?.currentPublicBuildInputId, "policy-only change replaced the immutable public build input");
  assert(runsAfterPolicy.length === runsBeforePolicy.length, "policy-only change persisted an agent run");
  assert(versionsAfterPolicy.length === versionsBeforePolicy.length, "policy-only change persisted a candidate version");
  assert(intentAfterPolicy?.agentAccessPolicy.aiTrain === "allow" && intentAfterPolicy.agentAccessPolicy.aiInput === "disallow", "recorded owner agent policy was not retained in the current site intent");
} finally {
  await rm(repositoryDir, { recursive: true, force: true });
}

const runtimePatches = new Map<string, TrustedRuntimePatch>();
const runtimeSeries = new Map<string, TrustedRuntimeSeries>();
const runtimeRegistry = {
  async getSeries(id: string) { return runtimeSeries.get(id); },
  async getPatch(id: string) { return runtimePatches.get(id); },
  async savePatch(patch: TrustedRuntimePatch) { runtimePatches.set(patch.id, patch); },
  async saveSeries(series: TrustedRuntimeSeries) { runtimeSeries.set(series.id, series); }
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
  ok: true, hostileFailures: hostileErrors.size, safeFactDeclarations: safePrepared.factDeclarations.length,
  claimParityCases: claimParity.cases.length, syntheticModule: "pass", capabilityPolicy: "pass",
  atomicVerifiedBuild: "pass", atomicRunClaim: "pass", controlPlaneCoalescing: "pass",
  directEditEnqueue: "pass", policyOnlyIsolation: "pass", clarificationLifecycle: "pass", runEventLifecycle: "pass",
  ownerOfferingMutation: "pass", subjectiveFindingsAreAdvisory: "pass", sessionIsolation: "pass", redirects: "pass", runtimePromotion: "pass",
  adminSiteStatus: "pass", blobInventoryAudit: "pass"
}));

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertThrows(operation: () => unknown, message: string) {
  let rejected = false;
  try { operation(); } catch { rejected = true; }
  assert(rejected, message);
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
