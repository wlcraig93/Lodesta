import assert from "node:assert/strict";
import { sitePublicBuildInputSchema, sourceSnapshotSchema, type SitePublicBuildInput } from "../packages/site-contracts";
import {
  agentAuthoredArtifactSchema,
  normalizeAgentAuthoredArtifact,
  prepareSiteArtifact,
  sanitizeAgentCss
} from "../packages/site-verification";
import { expectedSiteSandboxManifest } from "../packages/site-contracts/platform-manifest";
import {
  createAuthoringContextPacket,
  SiteAuthoringTerminalError,
  validateWorkspaceSourcePolicy
} from "../packages/site-agent";
import { buildSyntheticSiteInput } from "./support/synthetic-site-input";

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
const contextPacket = createAuthoringContextPacket({ buildInput: input, snapshots: [websiteSnapshot] });
assert(contextPacket.truncated, "optional authoring blocks did not truncate at the packet boundary");
assert.equal(contextPacket.crawl.blocks.length, 1, "authoring packet truncated inside or after the wrong block");
assert(!JSON.stringify(contextPacket).includes("canonicalTokens"), "authoring packet retained token-offset arrays");
assert.throws(
  () => createAuthoringContextPacket({
    buildInput: {
      ...input,
      intent: { ...input.intent, positioning: "x".repeat(170_000) }
    } as SitePublicBuildInput,
    snapshots: []
  }),
  (error) => error instanceof SiteAuthoringTerminalError && error.code === "input_budget_exhausted"
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
