import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentAuthoredArtifactSchema, normalizeAgentAuthoredArtifact } from "../packages/site-verification/contracts";
import { prepareSiteArtifact } from "../packages/site-verification/finalizer";
import { ArtifactClaimValidatorV1 } from "../packages/site-verification/artifact-claims";
import {
  assetRevisionV1Schema,
  businessStateV2Schema,
  controlPlaneChangePayloadSchema,
  operatorQueueItemSchema,
  platformSiteRecordSchema,
  siteAgentRunV1Schema,
  siteAgentSessionV1Schema,
  siteBuildArtifactV1Schema,
  sitePublicBuildInputV1Schema,
  siteVersionV4Schema,
  siteWorkspaceRevisionV1Schema,
  sourceSnapshotV1Schema,
  verticalDemandEventV1Schema,
  type TrustedRuntimePatchV1,
  type TrustedRuntimeSeriesV1
} from "../packages/site-contracts";
import { LocalSitePlatformRepository } from "../packages/platform-data/repository";
import { AgenticSiteWorkflowV1, managerRuntimeBudget } from "../packages/site-platform/workflow";
import { unsupportedCapabilityDemands } from "../packages/site-capabilities/policy";
import { createPublicBuildInput } from "../packages/business-data/public-projection";
import { assetRevisionIdForBusiness, sourceSnapshotIdForBusiness } from "../packages/business-data/website-ingestion";
import { createSiteRuntimePatch, promoteRuntimePatch, rollbackRuntimePatch, runtimePatchPath } from "../packages/trusted-runtime";
import { matchVerticalContext, resolveProductionVerticalContext, verticalContextFor } from "../packages/vertical-context";
import { validateWorkspaceSourcePolicy } from "../packages/site-agent/source-policy";
import { ControlPlaneServiceV2 } from "../packages/control-plane/service";
import { canAccessAgentSession } from "../app/api/site-agent/auth";
import { LocalPlatformOperationsRepository, redirectsStrandedByRoutes, validateSiteRedirectInput } from "../packages/platform-operations";
import { buildSyntheticSiteInput } from "./support/synthetic-site-input";

const buildInput = buildSyntheticSiteInput();
assert(managerRuntimeBudget("initial_build").builds === 4 && managerRuntimeBudget("initial_build").inspections === 4, "initial manager budget drifted from four matched cycles");
assert(managerRuntimeBudget("qa_repair").builds === 3 && managerRuntimeBudget("qa_repair").inspections === 3, "QA repair budget cannot support three matched build/inspection cycles");
assert(managerRuntimeBudget("focused_edit").builds === 3 && managerRuntimeBudget("focused_edit").inspections === 3, "focused edit budget drifted from three matched cycles");
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
    bodyHtml: `<main><h1 data-lodesta-fact-id="${businessName.id}">${businessName.value}</h1><a href="tel:${phone.value}" data-lodesta-fact-id="${phone.id}">${phone.value}</a><p>Collision Repair</p><section data-lodesta-map="location_primary"><address data-lodesta-fact-id="${address.id}">${address.value}</address><a href="https://www.google.com/maps/search/?api=1&amp;query=1200%20Main%20Street%2C%20Austin%2C%20TX%2C%2078701" data-lodesta-map-fallback>Directions</a></section><details data-lodesta-disclosure="disclosure-process"><summary>What happens next?</summary><p>We inspect the vehicle.</p></details><form data-lodesta-form-id="${buildInput.forms[0].id}"><label>Email<input name="email" type="email" required></label><button type="submit">Send</button><p data-lodesta-form-status></p></form></main>`
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

const normalizedSidecars = agentAuthoredArtifactSchema.parse(normalizeAgentAuthoredArtifact({
  ...safe,
  claims: [{ text: "Collision Repair", factIds: [offering.id] }],
  capabilityBindings: { form: { formId: buildInput.forms[0].id } }
}));
assert(normalizedSidecars.claims[0]?.route === "/" && normalizedSidecars.claims[0]?.kind === "free_text", "authored claim shorthand was not normalized");
assert(normalizedSidecars.capabilityBindings.some((binding) => binding.kind === "form" && binding.config.formId === buildInput.forms[0].id), "SDK form hook did not derive its capability binding");

const parityInput = sitePublicBuildInputV1Schema.parse({
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

const disabledCapabilityInput = sitePublicBuildInputV1Schema.parse({
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
assert(resolveProductionVerticalContext({ observedVertical: "auto_body", evidenceText: "Collision repair and paintless dent repair" })?.id === "auto_body", "model and evidence agreement did not resolve the production vertical");
assert(!resolveProductionVerticalContext({ observedVertical: "auto_body", evidenceText: "Landscape maintenance and lawn care" }), "model-only vertical label bypassed deterministic evidence");
assert(!resolveProductionVerticalContext({ observedVertical: "unsupported", evidenceText: "Landscape maintenance and lawn care" }), "unsupported vertical evidence was admitted into production");
let unsupported = false;
try { verticalContextFor("synthetic_test_vertical"); } catch { unsupported = true; }
assert(unsupported, "test-only vertical leaked into the production registry");
const syntheticState = businessStateV2Schema.parse({
  schemaVersion: "business-state-v2",
  businessId: buildInput.businessId,
  siteId: buildInput.siteId,
  revision: buildInput.businessStateRevision,
  stateHash: `sha256:${"6".repeat(64)}`,
  updatedAt: buildInput.createdAt,
  vertical: { id: syntheticVertical.id, moduleVersion: syntheticVertical.version, status: "reviewed" },
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
  verticalModule: syntheticVertical,
  sourceSnapshotIds: buildInput.sourceSnapshotIds,
  createdAt: buildInput.createdAt,
  runtimeSeriesId: buildInput.capabilityConfiguration.trustedRuntimeSeries
});
assert(syntheticProjection.verticalModule.id === syntheticVertical.id, "synthetic module did not pass through the shared public projection");
assert(!syntheticProjection.business.contacts.phone && syntheticProjection.business.locations.length === 0, "canonical fields without eligible source facts bypassed the public projection");

const ineligibleParallelFact = {
  id: "fact_phone_enrichment_only", kind: "phone" as const, label: "Unconfirmed enrichment phone", value: "512-555-9999", publicEligible: false,
  source: { factId: "fact_phone_enrichment_only", sourceSnapshotId: "source_places", observedAt: buildInput.createdAt, confidence: 0.72, ownerConfirmed: false }
};
const ineligibleParallelState = businessStateV2Schema.parse({
  ...syntheticState,
  contacts: { ...syntheticState.contacts, phone: ineligibleParallelFact.value },
  facts: [...syntheticState.facts, ineligibleParallelFact]
});
const ineligibleParallelProjection = createPublicBuildInput({
  id: "input_ineligible_parallel_projection", state: ineligibleParallelState, intent: buildInput.intent, forms: buildInput.forms,
  verticalModule: syntheticVertical, sourceSnapshotIds: buildInput.sourceSnapshotIds, createdAt: buildInput.createdAt
});
assert(!ineligibleParallelProjection.business.contacts.phone, "ineligible contact leaked through the canonical-state convenience field");
assert(!ineligibleParallelProjection.publicFacts.some((fact) => fact.id === ineligibleParallelFact.id), "ineligible enrichment fact leaked into the public fact list");

const observedProofFact = {
  id: "fact_proof_observed", kind: "proof" as const, label: "Observed testimonial", value: "They explained each repair clearly and kept us informed throughout the process.", publicEligible: false,
  source: { factId: "fact_proof_observed", sourceSnapshotId: "source_website", sourceBlockId: "source_block_testimonial", sourceUrl: "https://example.com/reviews", observedAt: buildInput.createdAt, confidence: 0.65, ownerConfirmed: false }
};
const observedProofState = businessStateV2Schema.parse({
  ...syntheticState,
  facts: [...syntheticState.facts, observedProofFact],
  proof: [{ id: "proof_observed", kind: "testimonial", status: "observed", publicText: observedProofFact.value, verbatim: true, sourceFactIds: [observedProofFact.id] }]
});
const observedProofProjection = createPublicBuildInput({
  id: "input_observed_proof_projection", state: observedProofState, intent: buildInput.intent, forms: buildInput.forms,
  verticalModule: syntheticVertical, sourceSnapshotIds: buildInput.sourceSnapshotIds, createdAt: buildInput.createdAt
});
assert(!observedProofProjection.publicFacts.some((fact) => fact.id === observedProofFact.id), "unconfirmed proof fact leaked into the public projection");
assert(observedProofProjection.business.proof.length === 0, "unconfirmed proof item leaked into the public projection");

const confirmedProofState = businessStateV2Schema.parse({
  ...observedProofState,
  facts: observedProofState.facts.map((fact) => fact.id === observedProofFact.id ? { ...fact, publicEligible: true, source: { ...fact.source, ownerConfirmed: true } } : fact),
  proof: observedProofState.proof.map((item) => ({ ...item, status: "confirmed" as const, confirmedAt: buildInput.createdAt }))
});
const confirmedProofProjection = createPublicBuildInput({
  id: "input_confirmed_proof_projection", state: confirmedProofState, intent: buildInput.intent, forms: buildInput.forms,
  verticalModule: syntheticVertical, sourceSnapshotIds: buildInput.sourceSnapshotIds, createdAt: buildInput.createdAt
});
assert(confirmedProofProjection.business.proof[0]?.publicText === observedProofFact.value, "confirmed verbatim proof did not enter the public projection");
let partialProofRejected = false;
try {
  createPublicBuildInput({
    id: "input_partial_proof_projection",
    state: businessStateV2Schema.parse({ ...confirmedProofState, proof: confirmedProofState.proof.map((item) => ({ ...item, publicText: "They explained each repair clearly." })) }),
    intent: buildInput.intent, forms: buildInput.forms, verticalModule: syntheticVertical,
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
  assert((await repository.listVerticalDemandEvents("open")).length === 1, "unsupported vertical demand was not retained independently of site state");
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
  const queuedRun = siteAgentRunV1Schema.parse({
    schemaVersion: "site-agent-run-v1", id: "run_atomic_claim", sessionId: "session_atomic_claim", siteId: site.id,
    publicBuildInputId: "input_atomic_claim", origin: "system", requestedBy: "verification", publishAfterSuccess: false,
    kind: "focused_edit", status: "queued", stage: "queued", exactParentRevisionId: revision.id,
    modelId: "verification", attempt: 0, skillVersions: {}, toolCalls: [], attempts: [],
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
  const destroyedSandboxIds: string[] = [];
  const workflow = new AgenticSiteWorkflowV1(repository, {} as never, { destroy: async (sandboxId: string) => { destroyedSandboxIds.push(sandboxId); } } as never, {} as never);
  const restartedRun = await workflow.recoverRunIfStale(queuedRun.id, -1);
  assert(restartedRun.status === "queued" && restartedRun.stage === "queued", "interrupted first attempt did not restart from the retained checkpoint");
  const secondClaim = await repository.claimAgentRun(queuedRun.id);
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
  const rightsState = businessStateV2Schema.parse({
    ...syntheticState,
    businessId: rightsBusinessId,
    siteId: rightsSiteId,
    vertical: { id: productionVertical.id, moduleVersion: productionVertical.version, status: "reviewed" },
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
  const rightsInput = sitePublicBuildInputV1Schema.parse({
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
  const experimentalState = businessStateV2Schema.parse({
    ...syntheticState,
    businessId: experimentalBusinessId,
    siteId: experimentalSiteId,
    facts: experimentalFacts,
    offerings: buildInput.business.offerings,
    contacts: buildInput.business.contacts,
    locations: buildInput.business.locations
  });
  const experimentalIntent = { ...buildInput.intent, id: "intent_experimental_test", siteId: experimentalSiteId };
  const experimentalInput = sitePublicBuildInputV1Schema.parse({
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
  await assertRejectsExperimental(() => repository.promoteSiteVersion(experimentalVersion.id, "operator_test"), "local repository");
  await assertRejectsExperimental(() => workflow.promoteVersion(experimentalVersion.id, "operator_test"), "workflow promotion");
  const automaticRun = siteAgentRunV1Schema.parse({
    schemaVersion: "site-agent-run-v1",
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
    toolCalls: [],
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
  const successorRun = siteAgentRunV1Schema.parse({
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
  ownerOfferingMutation: "pass", subjectiveFindingContinuity: "pass", sessionIsolation: "pass", redirects: "pass", runtimePromotion: "pass"
}));

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function assertRejectsExperimental(operation: () => Promise<unknown>, surface: string) {
  let rejected = false;
  try { await operation(); } catch (error) {
    rejected = error instanceof Error && error.message.includes("experimental_site_not_publishable");
  }
  assert(rejected, `${surface} accepted an experimental site promotion.`);
}
