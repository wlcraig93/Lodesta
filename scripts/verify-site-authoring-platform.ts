import assert from "node:assert/strict";
import { isContinuousAvailabilityValue as controllerAvailability } from "../packages/business-data/availability";
import { sitePublicBuildInputSchema, sourceSnapshotSchema, type SitePublicBuildInput } from "../packages/site-contracts";
import { continuousAvailabilityConformanceVectors } from "../packages/site-contracts/availability-conformance";
import {
  agentAuthoredArtifactSchema,
  normalizeAgentAuthoredArtifact,
  prepareSiteArtifact,
  sanitizeAgentCss,
  sanitizeAgentHtml
} from "../packages/site-verification";
import { expectedSiteSandboxManifest } from "../packages/site-contracts/platform-manifest";
import {
  classifySiteAuthoringFailure,
  createSiteAuthoringBrief,
  authoringBriefCharacters,
  targetAuthoringBriefCharacters,
  SiteAuthoringTerminalError,
  validateWorkspaceSourcePolicy
} from "../packages/site-agent";
import { buildSyntheticSiteInput } from "./support/synthetic-site-input";
import { isContinuousAvailabilityValue as sandboxAvailability } from "../workers/site-sandbox/scaffold/platform/presentation";

for (const vector of continuousAvailabilityConformanceVectors) {
  assert.equal(controllerAvailability(vector.value), vector.continuous, `Controller availability parser drifted for ${vector.value}.`);
  assert.equal(sandboxAvailability(vector.value), vector.continuous, `Sandbox availability parser drifted for ${vector.value}.`);
}

const input = buildSyntheticSiteInput();
const name = input.publicFacts.find((fact) => fact.kind === "business_name")!;
const phone = input.publicFacts.find((fact) => fact.kind === "phone")!;
const address = input.publicFacts.find((fact) => fact.kind === "address")!;
const hours = input.publicFacts.find((fact) => fact.kind === "hours")!;
const offering = input.publicFacts.find((fact) => fact.kind === "offering")!;

const validBody = `<header><strong data-lodesta-business-name data-lodesta-identity-status="verified" data-lodesta-fact-id="${name.id}">${name.value}</strong></header>
<main>
  <h1>Clear collision repair</h1>
  <p data-lodesta-fact-id="${offering.id}">${offering.value}</p>
  <a href="tel:${phone.value}" data-lodesta-fact-id="${phone.id}">(512) 555-0142</a>
  <section data-lodesta-map="location_primary">
    <address data-lodesta-fact-id="${address.id}">${address.value}</address>
    <div data-lodesta-fact-id="${hours.id}">Monday 8:00 AM-5:30 PM Tuesday 8:00 AM-5:30 PM Wednesday 8:00 AM-5:30 PM Thursday 8:00 AM-5:30 PM Friday 8:00 AM-5:30 PM Saturday Closed Sunday Closed</div>
    <a href="https://www.google.com/maps/search/?api=1&amp;query=1200%20Main%20Street%2C%20Austin%2C%20TX%2C%2078701" data-lodesta-map-fallback>Directions</a>
  </section>
  <form data-lodesta-form-id="form_estimate">
    <label for="field-name">Name</label><input id="field-name" data-lodesta-field-id="name" name="name" type="text" required>
    <label for="field-phone">Phone</label><input id="field-phone" data-lodesta-field-id="phone" name="phone" type="tel" required>
    <label for="field-message">What happened?</label><textarea id="field-message" data-lodesta-field-id="message" name="message"></textarea>
    <button type="submit" data-lodesta-form-submit>Request an estimate</button>
    <p data-lodesta-form-status aria-live="polite">Thanks. The shop will follow up.</p>
  </form>
</main>`;

const valid = artifact(validBody);
assert.deepEqual(Object.keys(valid).sort(), [
  "capabilityBindings",
  "compilerManifest",
  "kind",
  "routes",
  "sharedCss",
  "siteName"
]);
assert.throws(() => agentAuthoredArtifactSchema.parse({ ...valid, claims: [] }), /unrecognized/i);
assert.throws(() => agentAuthoredArtifactSchema.parse({ ...valid, factDeclarations: [] }), /unrecognized/i);

const prepared = prepareSiteArtifact({
  authoredArtifact: valid,
  buildInput: input,
  runtimeSeriesId: "site-runtime-v1"
});
assert.equal(errors(prepared).length, 0, JSON.stringify(errors(prepared)));
assert(prepared.factBindings.some((binding) => binding.sourceFactIds.includes(phone.id) && binding.span));
assert(prepared.factBindings.some((binding) => binding.origin === "structured_data" && !binding.span));
assert(prepared.capabilityBindings.some((binding) => binding.kind === "form"));
assert(prepared.capabilityBindings.some((binding) => binding.kind === "map"));

const compactPresentation = prepareSiteArtifact({
  authoredArtifact: artifact(`<header><strong data-lodesta-business-name data-lodesta-identity-status="verified" data-lodesta-fact-id="${name.id}">${name.value}</strong></header><main><h1>Visit the Austin shop</h1><span data-lodesta-business-hours data-lodesta-hours-variant="summary" data-lodesta-fact-id="${hours.id}">Monday–Friday: 8:00 AM-5:30 PM; Saturday–Sunday: Closed</span><address data-lodesta-business-address data-lodesta-address-variant="local" data-lodesta-fact-id="${address.id}">1200 Main Street, Austin, TX 78701</address></main>`),
  buildInput: input,
  runtimeSeriesId: "site-runtime-v1"
});
assert(
  !errors(compactPresentation).some((finding) => finding.id === "fact.sdk_value_mismatch"),
  "Canonical compact hours or local address presentation lost its source fact binding."
);

const serviceRouteInput = {
  ...input,
  intent: {
    ...input.intent,
    pageRequirements: [
      ...input.intent.pageRequirements,
      { id: "page_collision", purpose: "service" as const, slug: "collision-repair", title: "Collision Repair", required: true },
      { id: "page_campaign", purpose: "custom" as const, slug: "campaign", title: "Campaign", required: false }
    ]
  }
};
const serviceRouteArtifact = prepareSiteArtifact({
  authoredArtifact: agentAuthoredArtifactSchema.parse({
    kind: "agent-authored-artifact",
    compilerManifest: expectedSiteSandboxManifest,
    siteName: input.business.name,
    sharedCss: "body{font:16px Arial,sans-serif}",
    routes: [
      {
        path: "/",
        title: "Northstar Collision Repair in Austin",
        description: "Austin collision repair services, contact information, and next steps from Northstar Collision Repair.",
        bodyHtml: `<header><strong data-lodesta-business-name data-lodesta-identity-status="verified" data-lodesta-fact-id="${name.id}">${name.value}</strong><nav><a href="/collision-repair">Collision repair</a></nav></header><main><h1>Collision repair in Austin</h1></main>`
      },
      {
        path: "/collision-repair",
        title: "Collision Repair | Northstar Collision Repair",
        description: "Learn about collision repair from Northstar Collision Repair and request help from the Austin shop.",
        bodyHtml: `<header><strong data-lodesta-business-name data-lodesta-identity-status="verified" data-lodesta-fact-id="${name.id}">${name.value}</strong></header><main><h1 data-lodesta-fact-id="${offering.id}">${offering.value}</h1><p>Help with repair needs.</p></main>`
      },
      {
        path: "/campaign",
        title: "Campaign | Northstar Collision Repair",
        description: "A standalone campaign route for Northstar Collision Repair with a direct contact action.",
        bodyHtml: `<header><strong data-lodesta-business-name data-lodesta-identity-status="verified" data-lodesta-fact-id="${name.id}">${name.value}</strong></header><main><h1>Campaign</h1><a href="tel:${phone.value}" data-lodesta-fact-id="${phone.id}">Call the shop</a></main>`
      }
    ],
    capabilityBindings: []
  }),
  buildInput: serviceRouteInput,
  runtimeSeriesId: "site-runtime-v1"
});
assert(
  serviceRouteArtifact.findings.some((finding) => finding.id === "route.thin_service_content" && finding.route === "/collision-repair" && finding.severity === "warning"),
  "A dedicated service route below the substantive-content floor was not reported."
);
assert(
  serviceRouteArtifact.findings.some((finding) => finding.id === "route.orphan" && finding.route === "/campaign" && finding.severity === "warning"),
  "A declared orphan route did not produce an IA advisory."
);
assert(
  !serviceRouteArtifact.findings.some((finding) => finding.id === "route.orphan" && finding.severity === "error"),
  "An orphan route was incorrectly promoted to an unconditional release blocker."
);

const provisionalInput = sitePublicBuildInputSchema.parse({
  ...input,
  publicFacts: input.publicFacts.filter((fact) => fact.kind !== "business_name"),
  business: { ...input.business, identityStatus: "provisional" }
});
const provisional = prepareSiteArtifact({
  authoredArtifact: artifact(`<header><strong data-lodesta-business-name data-lodesta-identity-status="provisional">${input.business.name}</strong></header><main><h1>Welcome</h1></main>`),
  buildInput: provisionalInput,
  runtimeSeriesId: "site-runtime-v1"
});
assert(!provisional.factBindings.some((binding) => binding.sourceFactIds.includes(name.id)));
assert(!errors(provisional).some((finding) => finding.id === "fact.sdk_unavailable"));

const mismatchedIdentity = prepareSiteArtifact({
  authoredArtifact: artifact(`<header><strong data-lodesta-business-name data-lodesta-identity-status="verified" data-lodesta-fact-id="${name.id}">Different Company</strong></header><main><h1>Welcome</h1></main>`),
  buildInput: input,
  runtimeSeriesId: "site-runtime-v1"
});
assert(mismatchedIdentity.findings.some((finding) => finding.id === "identity.rendered_mismatch" && finding.severity === "warning"));

const proofFact = {
  id: "fact_warranty_10_year",
  kind: "proof" as const,
  label: "Confirmed warranty",
  value: "10-year warranty",
  source: {
    factId: "fact_warranty_10_year",
    sourceSnapshotId: "source_owner",
    observedAt: "2026-07-20T00:00:00.000Z",
    confidence: 1,
    ownerConfirmed: true
  },
  publicEligible: true as const
};
const proofInput = sitePublicBuildInputSchema.parse({
  ...input,
  publicFacts: [...input.publicFacts, proofFact],
  business: {
    ...input.business,
    proof: [{
      id: "proof_warranty",
      kind: "warranty",
      status: "confirmed",
      publicText: "10-year warranty",
      verbatim: true,
      sourceFactIds: [proofFact.id],
      confirmedAt: "2026-07-20T00:00:00.000Z"
    }]
  }
});

const supportedProof = prepareSiteArtifact({
  authoredArtifact: artifact(`<header><strong data-lodesta-business-name data-lodesta-identity-status="verified" data-lodesta-fact-id="${name.id}">${name.value}</strong></header><main><p data-lodesta-fact-id="${proofFact.id}">10-year warranty</p></main>`, {
    title: "10-year warranty | Northstar",
    description: "See the 10-year warranty."
  }),
  buildInput: proofInput,
  runtimeSeriesId: "site-runtime-v1"
});
assert(!errors(supportedProof).some((finding) => finding.id === "fact.sensitive_unsupported" || finding.id === "fact.metadata_unsupported"));

const duplicateProof = prepareSiteArtifact({
  authoredArtifact: artifact(`<header><strong data-lodesta-business-name data-lodesta-identity-status="verified" data-lodesta-fact-id="${name.id}">${name.value}</strong></header><main><p data-lodesta-fact-id="${proofFact.id}">10-year warranty</p><p>10-year warranty</p></main>`),
  buildInput: proofInput,
  runtimeSeriesId: "site-runtime-v1"
});
assert(errors(duplicateProof).some((finding) => finding.id === "fact.sensitive_unsupported"), "an unbound duplicate occurrence was authorized by text search");

const metadataOnly = prepareSiteArtifact({
  authoredArtifact: artifact(`<header><strong data-lodesta-business-name data-lodesta-identity-status="verified" data-lodesta-fact-id="${name.id}">${name.value}</strong></header><main><p>Quality work.</p></main>`, {
    title: "10-year warranty | Northstar",
    description: "Quality collision repair."
  }),
  buildInput: proofInput,
  runtimeSeriesId: "site-runtime-v1"
});
assert(errors(metadataOnly).some((finding) => finding.id === "fact.metadata_unsupported"), "metadata-only sensitive copy passed");

const malformedForm = prepareSiteArtifact({
  authoredArtifact: artifact(`<main><form data-lodesta-form-id="form_estimate"><input data-lodesta-field-id="name"><button data-lodesta-form-submit>Send</button></form></main>`),
  buildInput: input,
  runtimeSeriesId: "site-runtime-v1"
});
assert(errors(malformedForm).some((finding) => finding.id.startsWith("capability.form_")));

const asset = {
  assetId: "asset_background",
  revisionId: "asset_revision_background",
  kind: "photo" as const,
  contentHash: `sha256:${"a".repeat(64)}`,
  storageKey: "site-assets/test/background.webp",
  publicUrl: "https://assets.example/background.webp",
  mimeType: "image/webp" as const,
  alt: "Workshop",
  origin: "owner_upload" as const,
  sourceFactIds: [name.id],
  activeForFutureBuilds: true
};
assert.equal(sanitizeAgentCss(`.hero{background-image:url("asset://${asset.assetId}")}`, [asset]).findings.length, 0);
assert(sanitizeAgentCss(`.hero{background-image:u\\72l("https://evil.example/x")}`, [asset]).findings.some((finding) => finding.severity === "error"));
assert(sanitizeAgentCss(`.hero{background-image:url("asset://unknown")}`, [asset]).findings.some((finding) => finding.severity === "error"));
const prioritizedAsset = sanitizeAgentHtml({
  route: "/",
  bodyHtml: `<img src="asset://${asset.assetId}" alt="Workshop exterior" loading="eager" fetchpriority="high">`,
  declaredRoutes: new Set(["/"]),
  assets: [asset],
  allowedFormIds: new Set(),
  allowedExternalHrefs: new Set(),
  allowedPhoneNumbers: new Set(),
  allowedEmailAddresses: new Set()
});
assert.equal(prioritizedAsset.findings.length, 0, "Explicit image loading hints were rejected by the public artifact sanitizer.");
assert(prioritizedAsset.html.includes('loading="eager"') && prioritizedAsset.html.includes('fetchpriority="high"'), "The sanitizer dropped explicitly allowlisted image loading hints.");

const ordinaryReact = validateWorkspaceSourcePolicy([
  {
    path: "src/site.tsx",
    content: `import React from "react"; const items=["a","b"]; export const view=<main><p>Repair &amp; service</p>{items.map((item)=><section key={item}>{item}</section>)}</main>;`
  },
  { path: "src/styles.css", content: `html{scroll-behavior:smooth}.grid{display:grid}` }
]);
assert.deepEqual(ordinaryReact, []);
assert(validateWorkspaceSourcePolicy([
  { path: "src/site.tsx", content: `export const view = <main />;` },
  { path: "src/styles.css", content: `.unsafe-fixture{behavior:url("asset://unsafe")}` }
]).some((finding) => finding.id === "source.css_executable"));
const computedPropertyFinding = validateWorkspaceSourcePolicy([
  { path: "src/site.tsx", content: `const key = getKey(); export const value = globalThis[key];` },
  { path: "src/styles.css", content: `.x{color:red}` }
]).find((finding) => finding.id === "source.computed_property");
assert(computedPropertyFinding);
assert.match(computedPropertyFinding.message, /1:\d+ \(globalThis\[key\]\)/);
assert(validateWorkspaceSourcePolicy([
  { path: "src/site.tsx", content: `export const value = fetch("https://example.com");` },
  { path: "src/styles.css", content: `.x{color:red}` }
]).some((finding) => finding.id === "source.network"));

const websiteSnapshot = sourceSnapshotSchema.parse({
  schemaVersion: 1,
  id: "source_context_fixture",
  businessId: input.businessId,
  sourceType: "website",
  sourceUrl: "https://northstar.example/",
  contentHash: `sha256:${"7".repeat(64)}`,
  capturedAt: "2026-07-20T00:00:00.000Z",
  payload: {
    ingestion: {
      coverage: "bounded",
      modelBlocks: [
        { id: "block_1", sourceUrl: "https://northstar.example/", displayText: "A".repeat(80_000), evidenceClass: "first_party" },
        { id: "block_2", sourceUrl: "https://northstar.example/services", displayText: "B".repeat(80_000), evidenceClass: "first_party" }
      ]
    }
  }
});
const structuredContextSnapshot = sourceSnapshotSchema.parse({
  ...websiteSnapshot,
  id: "source_context_structured_fixture",
  contentHash: `sha256:${"8".repeat(64)}`,
  payload: {
    ingestion: {
      coverage: "complete",
      modelBlocks: [
        { id: "service_block_1", sourceUrl: "https://northstar.example/collision-repair", displayText: "Collision Repair includes documented body and paint damage repair.", evidenceClass: "first_party" },
        { id: "service_block_2", sourceUrl: "https://northstar.example/collision-repair", displayText: "Collision Repair scope and timing depend on the vehicle damage and parts.", evidenceClass: "first_party" },
        { id: "home_block_1", sourceUrl: "https://northstar.example/", displayText: "Northstar Collision Repair serves Austin.", evidenceClass: "first_party" }
      ],
      pages: [{
        url: "https://northstar.example/collision-repair",
        evidenceClass: "first_party",
        summary: {
          url: "https://northstar.example/collision-repair",
          purposeTags: ["service_detail"]
        }
      }]
    }
  }
});
const structuredContext = createSiteAuthoringBrief({ buildInput: input, snapshots: [structuredContextSnapshot] });
assert.equal(structuredContext.services[0]?.name, "Collision Repair");
assert.deepEqual(structuredContext.services[0]?.sourceWording, ["Collision Repair"]);
assert.deepEqual(structuredContext.services[0]?.evidence.map((block) => block.id).sort(), ["service_block_1", "service_block_2"]);
assert(!structuredContext.evidenceGaps.missing.includes("service_detail"), "Two source-backed service blocks were still reported as a service-detail evidence gap.");
assert(structuredContext.evidence.supplementalBlocks.some((block) => block.id === "home_block_1"), "General first-party context disappeared when service briefs were structured.");
const contextPacket = createSiteAuthoringBrief({ buildInput: input, snapshots: [websiteSnapshot] });
assert(authoringBriefCharacters(contextPacket) <= targetAuthoringBriefCharacters, "authoring brief exceeded its normal prompt target");
assert(!JSON.stringify(contextPacket).includes("A".repeat(10_000)), "authoring brief retained an unbounded source block");
assert(!JSON.stringify(contextPacket).includes("canonicalTokens"), "authoring brief retained token-offset arrays");
assert.throws(
  () => createSiteAuthoringBrief({
    buildInput: {
      ...input,
      intent: { ...input.intent, positioning: "x".repeat(170_000) }
    } as SitePublicBuildInput,
    snapshots: []
  }),
  (error) => error instanceof SiteAuthoringTerminalError && error.code === "artifact_contract_invalid"
);
assert.deepEqual(
  classifySiteAuthoringFailure(new Error("browser_verification_unavailable:axe-core")),
  {
    code: "browser_verification_unavailable",
    category: "platform",
    retryableByOwner: true,
    message: "browser_verification_unavailable:axe-core"
  },
  "Canonical browser instrumentation failures are not owner-retryable."
);

process.stdout.write(`${JSON.stringify({
  ok: true,
  artifactContract: "canonical",
  bindings: prepared.factBindings.length,
  capabilities: prepared.capabilityBindings.length,
  verification: "span-aware",
  cssAssets: "tokenized",
  sourcePolicy: "ast"
}, null, 2)}\n`);

function artifact(bodyHtml: string, metadata?: { title?: string; description?: string }) {
  return agentAuthoredArtifactSchema.parse(normalizeAgentAuthoredArtifact({
    kind: "agent-authored-artifact",
    compilerManifest: expectedSiteSandboxManifest,
    siteName: input.business.name,
    sharedCss: "html{font-family:Arial,sans-serif} body{margin:0}",
    routes: [{
      path: "/",
      title: metadata?.title ?? input.business.name,
      description: metadata?.description ?? "Collision repair in Austin.",
      bodyHtml
    }]
  }));
}

function errors(preparedArtifact: ReturnType<typeof prepareSiteArtifact>) {
  return preparedArtifact.findings.filter((finding) => finding.severity === "error");
}
