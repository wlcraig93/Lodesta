import assert from "node:assert/strict";
import { isContinuousAvailabilityValue as controllerAvailability } from "../packages/business-data/availability";
import { sitePublicBuildInputSchema, sourceSnapshotPageSchema, sourceSnapshotSchema, type SitePublicBuildInput } from "../packages/site-contracts";
import { continuousAvailabilityConformanceVectors } from "../packages/site-contracts/availability-conformance";
import {
  agentAuthoredArtifactSchema,
  finalizePreparedArtifact,
  normalizeAgentAuthoredArtifact,
  prepareSiteArtifact,
  representativeRoutePaths,
  sanitizeAgentCss,
  sanitizeAgentHtml
} from "../packages/site-verification";
import { expectedSiteSandboxManifest } from "../packages/site-contracts/platform-manifest";
import {
  classifySiteAuthoringFailure,
  createSiteAuthoringContext,
  validateWorkspaceSourcePolicy
} from "../packages/site-agent";
import { buildSyntheticSiteInput } from "./support/synthetic-site-input";
import { isContinuousAvailabilityValue as sandboxAvailability } from "../workers/site-sandbox/scaffold/platform/presentation";
import { sitemapXmlForSite } from "../packages/site-platform/public-site";
import { retainedVisualInspectionRoutePaths, scopedVisualInspectionRoutePaths } from "../packages/site-platform/visual-inspection-scope";

assert.deepEqual(
  retainedVisualInspectionRoutePaths(
    [{ path: "/" }, { path: "/services" }, { path: "/contact" }],
    ["/services/", "/", "/services", "/missing"]
  ),
  ["/services", "/"],
  "A bounded route-family inspection did not preserve its requested available route scope."
);
assert.deepEqual(
  retainedVisualInspectionRoutePaths([{ path: "/" }]),
  [],
  "The production visual-inspection fallback changed when no bounded route scope was supplied."
);
assert.deepEqual(
  scopedVisualInspectionRoutePaths({
    availableRoutes: [{ path: "/" }, { path: "/services" }, { path: "/contact" }],
    requestedRoute: "/",
    inspectAllBuiltRoutes: true
  }),
  ["/", "/services", "/contact"],
  "A habitual homepage request narrowed a bounded route-family inspection."
);
assert.deepEqual(
  scopedVisualInspectionRoutePaths({
    availableRoutes: [{ path: "/" }, { path: "/services" }, { path: "/contact" }],
    requestedRoute: "/contact",
    inspectAllBuiltRoutes: true
  }),
  ["/contact"],
  "A concrete non-home route reinspection lost its targeted scope."
);
assert.deepEqual(
  scopedVisualInspectionRoutePaths({
    availableRoutes: [{ path: "/" }, { path: "/services" }],
    requestedRoute: "/",
    inspectAllBuiltRoutes: false
  }),
  ["/"],
  "A homepage-only inspection unexpectedly expanded outside a route-family profile."
);
assert.deepEqual(
  scopedVisualInspectionRoutePaths({
    availableRoutes: [{ path: "/" }, { path: "/contact" }, { path: "/services" }, { path: "/about" }],
    preferredRoutePaths: ["/", "/contact", "/services", "/about"],
    preferredRouteLimit: 1
  }),
  ["/"],
  "The authoring browser loop exceeded its representative route limit."
);
assert.deepEqual(
  scopedVisualInspectionRoutePaths({
    availableRoutes: [{ path: "/" }, { path: "/contact" }, { path: "/services" }, { path: "/about" }],
    preferredRoutePaths: ["/", "/contact", "/services", "/about"],
    preferredRouteLimit: undefined
  }),
  ["/", "/contact", "/services", "/about"],
  "An all-representative authoring inspection silently narrowed its route coverage."
);

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
    <a href="https://www.google.com/maps/dir/?api=1&amp;destination=1200%20Main%20Street%2C%20Austin%2C%20TX%2C%2078701%2C%20US" data-lodesta-directions>Directions</a>
  </section>
  <form data-lodesta-form-id="form_estimate" data-lodesta-form-key="estimate_request" data-lodesta-form-revision="1" data-lodesta-form-destination="lead_inbox">
    <label for="field-name">Name</label><input id="field-name" data-lodesta-field-id="name" name="name" type="text" required>
    <label for="field-phone">Phone</label><input id="field-phone" data-lodesta-field-id="phone" name="phone" type="tel" required>
    <label for="field-message">What happened?</label><textarea id="field-message" data-lodesta-field-id="message" name="message"></textarea>
    <button type="submit" data-lodesta-form-submit>Request an estimate</button>
    <p data-lodesta-form-status aria-live="polite" aria-atomic="true">Thanks. The shop will follow up.</p>
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
const trustedSiteCss = prepared.files.find((file) => file.path === "site.css")?.bytes.toString("utf8") ?? "";
assert(trustedSiteCss.includes('font-family: "Lodesta Inter"'), "Finalized site CSS omitted the trusted self-hosted font library.");
assert(trustedSiteCss.includes('url("/_lodesta/fonts/inter-latin-variable.woff2")'), "Trusted font CSS did not use the platform-owned font route.");
assert(prepared.factBindings.some((binding) => binding.sourceFactIds.includes(phone.id) && binding.span));
assert(prepared.factBindings.some((binding) => binding.origin === "structured_data" && !binding.span));
assert(prepared.capabilityBindings.some((binding) => binding.kind === "form"));
assert(prepared.capabilityBindings.some((binding) => binding.kind === "map"));
const baselineStructuredData = structuredDataFrom(prepared.routes[0]!.html);
assert.deepEqual(
  baselineStructuredData.openingHours,
  ["Mo 08:00-17:30", "Tu 08:00-17:30", "We 08:00-17:30", "Th 08:00-17:30", "Fr 08:00-17:30"],
  "Verified natural-language canonical hours were not normalized into structured opening hours."
);
assert.equal("areaServed" in baselineStructuredData, false, "Structured data invented a service area.");
assert.equal("geo" in baselineStructuredData, false, "Structured data invented coordinates.");

const serviceAreaFact = {
  ...phone,
  id: "fact_service_area_round_rock",
  kind: "service_area" as const,
  label: "Service area",
  value: "Round Rock",
  source: { ...phone.source, factId: "fact_service_area_round_rock" }
};
const enrichedStructuredInput = sitePublicBuildInputSchema.parse({
  ...input,
  business: {
    ...input.business,
    locations: input.business.locations.map((location) => ({
      ...location,
      latitude: 30.2672,
      longitude: -97.7431
    })),
    serviceAreas: [{
      id: "service_area_round_rock",
      label: "Round Rock",
      sourceFactIds: [serviceAreaFact.id]
    }]
  },
  publicFacts: [...input.publicFacts, serviceAreaFact]
});
const enrichedPrepared = prepareSiteArtifact({
  authoredArtifact: valid,
  buildInput: enrichedStructuredInput,
  runtimeSeriesId: "site-runtime-v1"
});
const enrichedStructuredData = structuredDataFrom(enrichedPrepared.routes[0]!.html);
assert.deepEqual(enrichedStructuredData.areaServed, ["Round Rock"], "Verified service areas did not reach structured data.");
assert.deepEqual(enrichedStructuredData.geo, {
  "@type": "GeoCoordinates",
  latitude: 30.2672,
  longitude: -97.7431
}, "Sourced coordinates did not reach structured data.");
assert(enrichedPrepared.factBindings.some((binding) => binding.id.startsWith("jsonld:area-served:") && binding.sourceFactIds.includes(serviceAreaFact.id)));
assert(enrichedPrepared.factBindings.some((binding) => binding.id === "jsonld:geo:latitude" && binding.sourceFactIds.includes(address.id)));

const compactPresentation = prepareSiteArtifact({
  authoredArtifact: artifact(`<header><strong data-lodesta-business-name data-lodesta-identity-status="verified" data-lodesta-fact-id="${name.id}">${name.value}</strong></header><main><h1>Visit the Austin shop</h1><span data-lodesta-business-hours data-lodesta-hours-variant="summary" data-lodesta-fact-id="${hours.id}">Monday–Friday: 8:00 AM-5:30 PM; Saturday–Sunday: Closed</span><address data-lodesta-business-address data-lodesta-address-variant="local" data-lodesta-location-id="location_primary" data-lodesta-fact-id="${address.id}">1200 Main Street, Austin, TX 78701</address></main>`),
  buildInput: input,
  runtimeSeriesId: "site-runtime-v1"
});
assert(
  !errors(compactPresentation).some((finding) => finding.id === "fact.sdk_value_mismatch"),
  "Canonical compact hours or local address presentation lost its source fact binding."
);

const forgedLocalAddress = prepareSiteArtifact({
  authoredArtifact: artifact(`<main><address data-lodesta-business-address data-lodesta-address-variant="local" data-lodesta-location-id="location_primary" data-lodesta-fact-id="${address.id}">999 Forged Road, Austin, TX 78701</address></main>`),
  buildInput: input,
  runtimeSeriesId: "site-runtime-v1"
});
const forgedFinding = errors(forgedLocalAddress).find((finding) => finding.id === "fact.sdk_value_mismatch");
assert(forgedFinding, "Forged BusinessAddress binding attributes authorized incorrect rendered text.");
assert.match(forgedFinding.message, /rendered=.*expected=.*factId=.*locationId=.*variant=.*affectedRoutes=/);

const wrongLocationAddress = prepareSiteArtifact({
  authoredArtifact: artifact(`<main><address data-lodesta-business-address data-lodesta-address-variant="local" data-lodesta-location-id="location_missing" data-lodesta-fact-id="${address.id}">1200 Main Street, Austin, TX 78701</address></main>`),
  buildInput: input,
  runtimeSeriesId: "site-runtime-v1"
});
assert(errors(wrongLocationAddress).some((finding) => finding.id === "fact.sdk_value_mismatch"), "A BusinessAddress binding to the wrong location passed.");

const genericAddressExemption = prepareSiteArtifact({
  authoredArtifact: artifact(`<main><address data-lodesta-fact-id="${address.id}">1200 Main Street, Austin, TX</address></main>`),
  buildInput: input,
  runtimeSeriesId: "site-runtime-v1"
});
assert(errors(genericAddressExemption).some((finding) => finding.id === "fact.sdk_value_mismatch"), "Generic address Fact received the local-presentation exemption.");

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
  serviceRouteArtifact.findings.some((finding) => finding.id === "route.orphan" && finding.route === "/campaign" && finding.severity === "warning"),
  "A declared orphan route did not produce an IA advisory."
);
assert(
  !serviceRouteArtifact.findings.some((finding) => finding.id === "route.orphan" && finding.severity === "error"),
  "An orphan route was incorrectly promoted to an unconditional release blocker."
);
const missingRequiredRoute = prepareSiteArtifact({
  authoredArtifact: valid,
  buildInput: serviceRouteInput,
  runtimeSeriesId: "site-runtime-v1"
});
assert(
  !missingRequiredRoute.findings.some((finding) => finding.id === "route.required"),
  "A legacy intent route still became a mandatory authoring route."
);
assert.equal(
  finalizeForTest(missingRequiredRoute, serviceRouteInput).qa.hardGate,
  "passed",
  "A subjective route-plan mismatch still blocked candidate integrity."
);

const scalePaths = ["/", ...Array.from({ length: 249 }, (_, index) => `/services/route-${String(index + 1).padStart(3, "0")}`)];
const scaleLinks = scalePaths.slice(1).map((path) => `<a href="${path}">${path}</a>`).join("");
const scaleAuthored = agentAuthoredArtifactSchema.parse(normalizeAgentAuthoredArtifact({
  kind: "agent-authored-artifact",
  compilerManifest: expectedSiteSandboxManifest,
  siteName: input.business.name,
  sharedCss: "body{font:16px Arial,sans-serif}",
  routes: scalePaths.map((path, index) => ({
    path,
    title: `${index === 0 ? "Complete service guide" : `Service route ${index}`} | ${input.business.name}`,
    description: `Substantive customer information for ${index === 0 ? "the complete service guide" : `service route ${index}`} from ${input.business.name}.`,
    bodyHtml: `<header><strong data-lodesta-business-name data-lodesta-identity-status="verified" data-lodesta-fact-id="${name.id}">${name.value}</strong></header><main><h1>${index === 0 ? "Complete service guide" : `Service route ${index}`}</h1><p>This route provides distinct customer guidance for scenario ${index}, supporting details, preparation steps, and a clear next action.</p>${index === 0 ? scaleLinks : '<a href="/">Back to the service guide</a>'}</main>`
  }))
}));
const scalePrepared = prepareSiteArtifact({ authoredArtifact: scaleAuthored, buildInput: input, runtimeSeriesId: "site-runtime-v1" });
assert.equal(scalePrepared.routes.length, 250, "The static authoring boundary capped a 250-route site.");
const scaleRepresentatives = representativeRoutePaths(scalePrepared, input, ["/services/route-249"]);
assert(scaleRepresentatives.has("/") && scaleRepresentatives.has("/services/route-249"));
assert(scaleRepresentatives.size < 20, `Representative browser selection expanded to ${scaleRepresentatives.size} routes.`);
const scaleFinal = finalizeForTest(scalePrepared, input, [], scaleRepresentatives.size);
assert.equal(scaleFinal.routes.length, 250, "Finalization dropped routes from the scale fixture.");
assert.equal(scaleFinal.qa.routesChecked, scaleRepresentatives.size, "Finalization did not retain representative browser coverage.");
const scaleSitemap = sitemapXmlForSite({ origin: "https://example.test", basePath: "/sites/northstar", routes: scaleFinal.routes.map((route) => route.path), lastModified: "2026-07-31T00:00:00.000Z" });
assert.equal((scaleSitemap.match(/<url>/g) ?? []).length, 250, "Sitemap generation omitted routes from the scale fixture.");

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

const officialLogoIdentityInput = sitePublicBuildInputSchema.parse({
  ...input,
  business: {
    ...input.business,
    assets: [{
      assetId: "asset_official_logo_identity",
      revisionId: "asset_revision_official_logo_identity",
      kind: "logo",
      contentHash: `sha256:${"a".repeat(64)}`,
      storageKey: "verification/assets/official-logo-identity.png",
      mimeType: "image/png",
      alt: `${input.business.name} logo`,
      width: 300,
      height: 160,
      origin: "source_website",
      sourceFactIds: [],
      activeForFutureBuilds: true
    }]
  },
  assetRevisionIds: ["asset_revision_official_logo_identity"]
});
const officialLogoOnlyIdentity = prepareSiteArtifact({
  authoredArtifact: artifact(`<header><img src="asset://asset_revision_official_logo_identity" alt="${input.business.name} logo"></header><main><h1>Welcome</h1></main>`),
  buildInput: officialLogoIdentityInput,
  runtimeSeriesId: "site-runtime-v1"
});
const officialLogoIdentityFinding = officialLogoOnlyIdentity.findings.find((finding) => finding.id === "identity.rendered_mismatch");
assert(
  officialLogoIdentityFinding?.severity === "info" && /official logo is available/.test(officialLogoIdentityFinding.message),
  "An exact official-logo identity incorrectly produced an actionable missing-BusinessName warning."
);

const naturallyRenderedCanonicalPhone = prepareSiteArtifact({
  authoredArtifact: artifact(`<main><h1>Call us</h1><a href="tel:${phone.value}">(512) 555-0142</a></main>`, {
    description: `Call (512) 555-0142 for service.`
  }),
  buildInput: input,
  runtimeSeriesId: "site-runtime-v1"
});
assert(
  !errors(naturallyRenderedCanonicalPhone).some((finding) => finding.id === "fact.undeclared_marker" || finding.id === "fact.metadata_unsupported"),
  "An exact canonical phone number required JSX fact-binding ceremony."
);
const unsupportedNaturalPhone = prepareSiteArtifact({
  authoredArtifact: artifact(`<main><h1>Call us</h1><a href="tel:+15125550199">(512) 555-0199</a></main>`),
  buildInput: input,
  runtimeSeriesId: "site-runtime-v1"
});
assert(
  errors(unsupportedNaturalPhone).some((finding) => finding.id === "fact.undeclared_marker"),
  "An unsupported phone number passed merely because it resembled a phone number."
);
const unsupportedCoordinate = prepareSiteArtifact({
  authoredArtifact: artifact("<main><h1>Raleigh service</h1><p>35°46′N</p></main>"),
  buildInput: input,
  runtimeSeriesId: "site-runtime-v1"
});
assert(
  errors(unsupportedCoordinate).some((finding) => finding.id === "fact.undeclared_marker"),
  "An unsupported geographic coordinate escaped the factual gate as decorative locality copy."
);
const unsupportedLocationRole = prepareSiteArtifact({
  authoredArtifact: artifact("<main><h1>Service areas</h1><p>Main shop</p><address>1200 Main Street, Austin, TX 78701</address></main>"),
  buildInput: input,
  runtimeSeriesId: "site-runtime-v1"
});
assert(
  errors(unsupportedLocationRole).some((finding) => finding.id === "fact.undeclared_marker"),
  "An unsupported address-role characterization escaped the factual gate."
);
const locationRoleFact = {
  id: "fact_location_role",
  kind: "description" as const,
  label: "Location role",
  value: "Main shop",
  source: {
    factId: "fact_location_role",
    sourceSnapshotId: "source_owner",
    observedAt: "2026-07-20T00:00:00.000Z",
    confidence: 1,
    ownerConfirmed: true
  },
  publicEligible: true as const
};
const supportedLocationRoleInput = sitePublicBuildInputSchema.parse({
  ...input,
  publicFacts: [...input.publicFacts, locationRoleFact]
});
const supportedLocationRole = prepareSiteArtifact({
  authoredArtifact: artifact(`<main><h1>Service areas</h1><p data-lodesta-fact-id="${locationRoleFact.id}">Main shop</p></main>`),
  buildInput: supportedLocationRoleInput,
  runtimeSeriesId: "site-runtime-v1"
});
assert(
  !errors(supportedLocationRole).some((finding) => finding.id === "fact.undeclared_marker"),
  "An exact canonical address-role fact was rejected."
);

const sensitiveName = "#1 Coby's Tentless Termite and Pest Control";
const sensitiveNameInput = sitePublicBuildInputSchema.parse({
  ...input,
  business: { ...input.business, name: sensitiveName },
  publicFacts: input.publicFacts.map((fact) => fact.id === name.id ? { ...fact, value: sensitiveName } : fact)
});
const supportedSensitiveName = prepareSiteArtifact({
  authoredArtifact: artifact(`<header><strong data-lodesta-business-name data-lodesta-identity-status="verified" data-lodesta-fact-id="${name.id}">${sensitiveName}</strong></header><main><h1>Termite and pest control</h1></main>`, {
    title: sensitiveName,
    description: `${sensitiveName} provides termite and pest control.`
  }),
  buildInput: sensitiveNameInput,
  runtimeSeriesId: "site-runtime-v1"
});
assert(
  !errors(supportedSensitiveName).some((finding) => finding.id === "fact.sensitive_unsupported" || finding.id === "fact.metadata_unsupported"),
  `An exact compiler-bound canonical business name was misclassified as an invented #1 claim: ${JSON.stringify(errors(supportedSensitiveName))}`
);
const unboundSensitiveName = prepareSiteArtifact({
  authoredArtifact: artifact(`<main><h1>${sensitiveName}</h1></main>`),
  buildInput: sensitiveNameInput,
  runtimeSeriesId: "site-runtime-v1"
});
assert(
  errors(unboundSensitiveName).some((finding) => finding.id === "fact.sensitive_unsupported"),
  "An unbound #1 claim received the canonical business-name exemption."
);

const ordinaryBestFitCopy = prepareSiteArtifact({
  authoredArtifact: artifact("<main><h1>Pest control</h1><p>Start with the service that best fits your question.</p></main>"),
  buildInput: input,
  runtimeSeriesId: "site-runtime-v1"
});
assert(
  !errors(ordinaryBestFitCopy).some((finding) => finding.id === "fact.sensitive_unsupported"),
  "Ordinary best-fit guidance was misclassified as an unsupported superiority claim."
);
const unsupportedBestCompanyCopy = prepareSiteArtifact({
  authoredArtifact: artifact("<main><h1>Pest control</h1><p>We are the best pest control company in town.</p></main>"),
  buildInput: input,
  runtimeSeriesId: "site-runtime-v1"
});
assert(
  errors(unsupportedBestCompanyCopy).some((finding) => finding.id === "fact.sensitive_unsupported"),
  "A genuine unsupported best-company claim escaped the fact gate."
);

const emergencyDescriptionFact = {
  id: "fact_emergency_description",
  kind: "description" as const,
  label: "Source description",
  value: "Residential and commercial pest control. Emergency services available.",
  source: {
    factId: "fact_emergency_description",
    sourceSnapshotId: "source_first_party",
    observedAt: "2026-07-20T00:00:00.000Z",
    confidence: 1,
    ownerConfirmed: false
  },
  publicEligible: true as const
};
const emergencyInput = sitePublicBuildInputSchema.parse({
  ...input,
  publicFacts: [...input.publicFacts, emergencyDescriptionFact]
});
const naturallySupportedEmergency = prepareSiteArtifact({
  authoredArtifact: artifact(`<main><h1>Fast help</h1><p>Emergency services available.</p></main>`),
  buildInput: emergencyInput,
  runtimeSeriesId: "site-runtime-v1"
});
assert(
  !errors(naturallySupportedEmergency).some((finding) => finding.id === "fact.sensitive_unsupported"),
  "An exact low-risk claim retained in canonical first-party description evidence required JSX fact-binding ceremony."
);
const unsupportedEmergency = prepareSiteArtifact({
  authoredArtifact: artifact(`<main><h1>Fast help</h1><p>Same day service available.</p></main>`),
  buildInput: input,
  runtimeSeriesId: "site-runtime-v1"
});
assert(
  errors(unsupportedEmergency).some((finding) => finding.id === "fact.sensitive_unsupported"),
  "An unsupported emergency-availability claim passed without canonical evidence."
);

const unsupportedSafetyPositioning = prepareSiteArtifact({
  authoredArtifact: artifact("<main><h1>Pest control</h1><p>Eco-friendly products that are safe for people, pets, and the environment.</p></main>"),
  buildInput: input,
  runtimeSeriesId: "site-runtime-v1"
});
assert(
  errors(unsupportedSafetyPositioning).some((finding) => finding.id === "fact.sensitive_unsupported"),
  "An unsupported safety and environmental promise passed without canonical evidence."
);
const unsupportedSafeRemoval = prepareSiteArtifact({
  authoredArtifact: artifact("<main><h1>Bee removal</h1><p>We locate the hive and remove or relocate it safely.</p></main>"),
  buildInput: input,
  runtimeSeriesId: "site-runtime-v1"
});
assert(
  errors(unsupportedSafeRemoval).some((finding) => finding.id === "fact.sensitive_unsupported"),
  "An unsupported safe service-performance claim passed without canonical evidence."
);
const unsupportedServiceCadence = prepareSiteArtifact({
  authoredArtifact: artifact("<main><h1>Pest control</h1><p>Routine service visits are offered every 2 months.</p></main>"),
  buildInput: input,
  runtimeSeriesId: "site-runtime-v1"
});
assert(
  errors(unsupportedServiceCadence).some((finding) => finding.id === "fact.sensitive_unsupported"),
  "An unsupported recurring-service cadence passed without canonical evidence."
);
const ordinaryCalendarGuidance = prepareSiteArtifact({
  authoredArtifact: artifact("<main><h1>Seasonal pest guide</h1><p>Inspect stored decorations every two months for signs of activity.</p></main>"),
  buildInput: input,
  runtimeSeriesId: "site-runtime-v1"
});
assert(
  !errors(ordinaryCalendarGuidance).some((finding) => finding.id === "fact.sensitive_unsupported"),
  "Ordinary homeowner inspection guidance was misclassified as a business service cadence."
);

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
const blockedFactArtifact = finalizeForTest(duplicateProof, proofInput);
assert.equal(blockedFactArtifact.qa.hardGate, "failed", "an unsupported factual claim did not block the candidate");
assert(
  blockedFactArtifact.qa.findings.some((finding) => finding.id === "fact.sensitive_unsupported" && finding.severity === "error"),
  "the unsupported factual claim was downgraded instead of remaining a blocker"
);
const unboundReturnServicePromise = prepareSiteArtifact({
  authoredArtifact: artifact("<main><h1>Service that stands behind the work</h1><p>If pests return within your service coverage period, we will come back and re-treat your home at no additional cost.</p></main>"),
  buildInput: proofInput,
  runtimeSeriesId: "site-runtime-v1"
});
assert(
  errors(unboundReturnServicePromise).some((finding) => finding.id === "fact.sensitive_unsupported"),
  "An unbound return-service promise escaped proof enforcement by omitting the word guarantee."
);
const unreadableVisualArtifact = finalizeForTest(supportedProof, proofInput, [{
  id: "render.contrast",
  severity: "error",
  area: "accessibility",
  message: "Synthetic contrast diagnostic.",
  route: "/"
}]);
assert.equal(unreadableVisualArtifact.qa.hardGate, "failed", "deterministic unreadable contrast did not block the candidate");
assert(
  unreadableVisualArtifact.qa.findings.some((finding) => finding.id === "render.contrast" && finding.severity === "error"),
  "deterministic unreadable contrast was downgraded instead of remaining a blocker"
);

const metadataOnly = prepareSiteArtifact({
  authoredArtifact: artifact(`<header><strong data-lodesta-business-name data-lodesta-identity-status="verified" data-lodesta-fact-id="${name.id}">${name.value}</strong></header><main><p>Quality work.</p></main>`, {
    title: "10-year warranty | Northstar",
    description: "Quality collision repair."
  }),
  buildInput: proofInput,
  runtimeSeriesId: "site-runtime-v1"
});
assert(errors(metadataOnly).some((finding) => finding.id === "fact.metadata_unsupported"), "metadata-only sensitive copy passed");

const mismatchedContact = prepareSiteArtifact({
  authoredArtifact: artifact(`<main><h1>${input.business.name}</h1><a href="tel:+1-555-555-5555">Call us</a></main>`),
  buildInput: input,
  runtimeSeriesId: "site-runtime-v1"
});
assert(errors(mismatchedContact).some((finding) => finding.id === "fact.link_mismatch"));
const blockedContactArtifact = finalizeForTest(mismatchedContact, input);
assert.equal(blockedContactArtifact.qa.hardGate, "failed", "a contact-fact mismatch did not block the candidate");
assert(
  blockedContactArtifact.qa.findings.some((finding) => finding.id === "fact.link_mismatch" && finding.severity === "error"),
  "the contact-fact mismatch was downgraded instead of remaining a blocker"
);

const malformedForm = prepareSiteArtifact({
  authoredArtifact: artifact(`<main><form data-lodesta-form-id="form_estimate"><input data-lodesta-field-id="name"><button data-lodesta-form-submit>Send</button></form></main>`),
  buildInput: input,
  runtimeSeriesId: "site-runtime-v1"
});
assert(errors(malformedForm).some((finding) => finding.id.startsWith("capability.form_")));
assert.equal(finalizeForTest(malformedForm, input).qa.hardGate, "failed", "a malformed managed capability passed the technical gate");

const sanitizedUnsafeMarkup = prepareSiteArtifact({
  authoredArtifact: artifact(`<main style="color:red"><h1>Repair</h1><script>bad()</script><a href="javascript:bad()">Click</a></main>`),
  buildInput: input,
  runtimeSeriesId: "site-runtime-v1"
});
assert(sanitizedUnsafeMarkup.findings.some((finding) => finding.id === "html.agent_executable"));
assert(!sanitizedUnsafeMarkup.routes[0]?.html.includes("bad()"), "unsafe markup survived deterministic sanitization");
assert(!sanitizedUnsafeMarkup.routes[0]?.html.includes("javascript:"), "unsafe link survived deterministic sanitization");
assert.equal(finalizeForTest(sanitizedUnsafeMarkup, input).qa.hardGate, "passed", "successfully sanitized markup still forced an authoring retry");

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

const nativeResponsiveMarkup = sanitizeAgentHtml({
  route: "/",
  bodyHtml: `<header><button type="button" popovertarget="site-navigation" popovertargetaction="toggle">Menu</button><nav id="site-navigation" popover="auto"><a href="/">Home</a></nav></header><main><picture><source media="(max-width: 40rem)" sizes="100vw" srcset="asset://${asset.assetId} 480w, asset://${asset.assetId} 960w"><img src="asset://${asset.assetId}" srcset="asset://${asset.assetId} 1x, asset://${asset.assetId} 2x" sizes="(max-width: 40rem) 100vw, 50vw" alt="Workshop"></picture><dialog open>Native semantics</dialog></main>`,
  declaredRoutes: new Set(["/"]),
  assets: [asset],
  allowedFormIds: new Set(),
  allowedExternalHrefs: new Set(),
  allowedPhoneNumbers: new Set(),
  allowedEmailAddresses: new Set()
});
assert.equal(nativeResponsiveMarkup.findings.length, 0, JSON.stringify(nativeResponsiveMarkup.findings));
assert(nativeResponsiveMarkup.html.includes('popovertarget="site-navigation"') && nativeResponsiveMarkup.html.includes('popover="auto"'), "Declarative Popover attributes did not survive sanitization.");
assert(nativeResponsiveMarkup.html.includes(`srcset="/_lodesta/assets/${asset.revisionId} 480w, /_lodesta/assets/${asset.revisionId} 960w"`), "Responsive width candidates were not bound to immutable assets.");
assert(nativeResponsiveMarkup.html.includes('sizes="(max-width: 40rem) 100vw, 50vw"') && nativeResponsiveMarkup.html.includes('media="(max-width: 40rem)"'), "Valid responsive media expressions did not survive sanitization.");

const unsafeResponsiveMarkup = sanitizeAgentHtml({
  route: "/",
  bodyHtml: `<main><picture><source media="screen; url(https://evil.example)" sizes="(max-width: 40rem)" srcset="https://evil.example/image.webp 480w, asset://${asset.assetId} 2x"><img src="asset://${asset.assetId}"></picture></main>`,
  declaredRoutes: new Set(["/"]),
  assets: [asset],
  allowedFormIds: new Set(),
  allowedExternalHrefs: new Set(),
  allowedPhoneNumbers: new Set(),
  allowedEmailAddresses: new Set()
});
assert(unsafeResponsiveMarkup.findings.some((finding) => finding.id === "asset.srcset_invalid"), "An external or mixed-descriptor srcset escaped sanitization.");
assert(unsafeResponsiveMarkup.findings.some((finding) => finding.id === "asset.sizes_invalid"), "A sizes entry without a terminal source size escaped sanitization.");
assert(unsafeResponsiveMarkup.findings.some((finding) => finding.id === "asset.media_invalid"), "An unsafe media expression escaped sanitization.");

const invalidPopover = sanitizeAgentHtml({
  route: "/",
  bodyHtml: '<header><button type="button" popovertarget="missing">Menu</button></header>',
  declaredRoutes: new Set(["/"]),
  assets: [],
  allowedFormIds: new Set(),
  allowedExternalHrefs: new Set(),
  allowedPhoneNumbers: new Set(),
  allowedEmailAddresses: new Set()
});
assert(invalidPopover.findings.some((finding) => finding.id === "html.popover_target"), "A missing Popover target escaped sanitization.");

const closedNavigation = sanitizeAgentHtml({
  route: "/",
  bodyHtml: '<header><div data-lodesta-navigation-disclosure="primary-navigation" data-lodesta-navigation-behavior="modal"><button data-lodesta-menu-toggle aria-controls="primary-navigation" aria-expanded="false" aria-haspopup="dialog">Menu</button><div id="primary-navigation" data-lodesta-navigation-panel role="dialog" aria-modal="true" tabindex="-1"><nav><a href="/">Home</a></nav></div></div></header><main>Homepage</main>',
  declaredRoutes: new Set(["/"]),
  assets: [],
  allowedFormIds: new Set(),
  allowedExternalHrefs: new Set(),
  allowedPhoneNumbers: new Set(),
  allowedEmailAddresses: new Set()
});
assert.equal(closedNavigation.findings.length, 0, "Safe native navigation attributes were rejected by the public artifact sanitizer.");
assert.match(closedNavigation.html, /id="primary-navigation"[^>]*\shidden(?:="")?/i, "A closed managed navigation panel was not hidden in finalized HTML.");
assert(closedNavigation.html.includes('aria-modal="true"') && closedNavigation.html.includes('tabindex="-1"'), "Safe navigation accessibility attributes were removed.");
assert(closedNavigation.html.includes('aria-haspopup="dialog"'), "The sanitizer removed the SDK navigation trigger's valid popup semantics.");

const openNavigation = sanitizeAgentHtml({
  route: "/",
  bodyHtml: '<header><button data-lodesta-menu-toggle aria-controls="primary-navigation" aria-expanded="true">Menu</button><div id="primary-navigation" data-lodesta-navigation-panel hidden><nav><a href="/">Home</a></nav></div></header><main>Homepage</main>',
  declaredRoutes: new Set(["/"]),
  assets: [],
  allowedFormIds: new Set(),
  allowedExternalHrefs: new Set(),
  allowedPhoneNumbers: new Set(),
  allowedEmailAddresses: new Set()
});
assert.doesNotMatch(openNavigation.html, /id="primary-navigation"[^>]*\shidden(?:="")?/i, "An explicitly open managed navigation panel remained hidden.");

const ordinaryReact = validateWorkspaceSourcePolicy([
  {
    path: "src/site.tsx",
    content: `import React from "react"; const items=["a","b"]; export const view=<main><p>Repair &amp; service</p>{items.map((item)=><section key={item}>{item}</section>)}</main>;`
  },
  { path: "src/styles.css", content: `html{scroll-behavior:smooth}.grid{display:grid}` }
]);
assert.deepEqual(ordinaryReact, []);
assert.deepEqual(validateWorkspaceSourcePolicy([
  {
    path: "src/site.tsx",
    content: `import React from "react"; function Link(props:{href:string;children:React.ReactNode}){return <a href={props.href}>{props.children}</a>} export const view=<Link href="/">Home</Link>;`
  },
  { path: "src/styles.css", content: `.link{display:inline-flex}` }
]), [], "An uppercase React Link component was mistaken for forbidden intrinsic <link> metadata.");
assert(
  validateWorkspaceSourcePolicy([
    { path: "src/site.tsx", content: `export const view=<link rel="stylesheet" href="https://example.com/site.css"/>;` },
    { path: "src/styles.css", content: `.safe{display:block}` }
  ]).some((finding) => finding.id === "source.executable_markup"),
  "Lowercase intrinsic <link> metadata escaped source validation."
);
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
assert.doesNotMatch(computedPropertyFinding.message, /Replace|Map\.get|switch|explicit conditional/);
assert.deepEqual(validateWorkspaceSourcePolicy([
  { path: "src/site.tsx", content: `const key = "home"; const copy = new Map([["home", "Welcome"]]); export const view = <main>{copy.get(key)}</main>;` },
  { path: "src/styles.css", content: `.x{color:red}` }
]), [], "The recommended Map.get keyed-content pattern was rejected by source policy.");
assert(validateWorkspaceSourcePolicy([
  { path: "src/site.tsx", content: `export const value = fetch("https://example.com");` },
  { path: "src/styles.css", content: `.x{color:red}` }
]).some((finding) => finding.id === "source.network"));
for (const content of [
  `export const view=<address data-lodesta-fact-id="fact_address">Forged</address>;`,
  `export const view=<address {...{"data-lodesta-address-variant":"local"}}>Forged</address>;`,
  `const props={"data-lodesta-location-id":"location_primary"}; export const view=<address {...props}>Forged</address>;`,
  `import React from "react"; export const view=React.createElement("address", {"data-lodesta-fact-id":"fact_address"}, "Forged");`,
  `import React from "react"; const props={"data-lodesta-fact-id":"fact_address"}; export const view=React.createElement("address", props, "Forged");`,
  `function Wrapper(props:Record<string,string>){return <address {...props}/>}; export const view=<Wrapper data-lodesta-fact-id="fact_address"/>;`
]) {
  assert(
    validateWorkspaceSourcePolicy([
      { path: "src/site.tsx", content },
      { path: "src/styles.css", content: `[data-lodesta-fact-id]{display:block}` }
    ]).some((finding) => finding.id === "source.reserved_kernel_attribute"),
    `A reserved kernel binding escaped source validation: ${content}`
  );
}
assert.deepEqual(validateWorkspaceSourcePolicy([
  { path: "src/site.tsx", content: `export const view=<a href="/contact" data-lodesta-conversion="primary">Contact</a>;` },
  { path: "src/styles.css", content: `.action{display:inline-flex}` }
]), [], "An approved analytics annotation was rejected by source policy.");
assert(
  validateWorkspaceSourcePolicy([
    {
      path: "src/site.tsx",
      content: `export const view=<div dangerouslySetInnerHTML={{__html:'<script>bad()</script>'}}/>;`
    },
    { path: "src/styles.css", content: `.safe{display:block}` }
  ]).some((finding) => finding.id === "source.executable_markup"),
  "Dangerous HTML injection passed source validation"
);
assert.deepEqual(validateWorkspaceSourcePolicy([
  { path: "src/site.tsx", content: `import { BusinessAddress } from "#lodesta-sdk"; export const view=<BusinessAddress locationId="location_primary"/>;` },
  { path: "src/styles.css", content: `[data-lodesta-business-address]{font-style:normal}` }
]), []);
assert.deepEqual(validateWorkspaceSourcePolicy([
  { path: "src/site.tsx", content: `import { SafeLink } from "#lodesta-sdk"; export const view=<SafeLink id="portal" className="portal-link"><span>Customer portal</span></SafeLink>;` },
  { path: "src/styles.css", content: `.portal-link{display:inline-flex}` }
]), [], "A directly styled SafeLink was rejected by source policy.");
const nestedSafeLinkFinding = validateWorkspaceSourcePolicy([
  { path: "src/site.tsx", content: `import { SafeLink } from "#lodesta-sdk"; export const view=<a className="portal-link"><span><SafeLink id="portal">Customer portal</SafeLink></span></a>;` },
  { path: "src/styles.css", content: `.portal-link{display:inline-flex}` }
]).find((finding) => finding.id === "source.safelink_anchor_nesting");
assert(
  nestedSafeLinkFinding && /already renders an anchor/i.test(nestedSafeLinkFinding.message),
  "A SafeLink nested inside an intrinsic anchor escaped source validation."
);
const groupedAuthoringPreflight = validateWorkspaceSourcePolicy([
  {
    path: "src/site.tsx",
    content: `import "./styles.css";
function HomePage(){return <main><SafeLink id="link_existing">Existing website</SafeLink><LeadForm id="form_contact"><LeadSubmit>Send</LeadSubmit></LeadForm></main>}
export const siteDefinition={homepage:<HomePage/>,routes:[{path:"/contact",component:HomePage}]};`
  },
  { path: "src/styles.css", content: `.safe{display:block}` }
]);
assert(
  groupedAuthoringPreflight.some((finding) => finding.id === "source.import_syntax" && /automatically includes every CSS file/.test(finding.message)),
  "The grouped authoring preflight missed a prohibited CSS import."
);
const missingSdkImportFinding = groupedAuthoringPreflight.find((finding) => finding.id === "source.sdk_import_missing");
assert(
  missingSdkImportFinding
    && /LeadForm, LeadSubmit, SafeLink/.test(missingSdkImportFinding.message),
  `The grouped authoring preflight did not report every missing SDK import together: ${JSON.stringify(groupedAuthoringPreflight)}`
);
assert(
  groupedAuthoringPreflight.some((finding) => finding.id === "source.homepage_route_missing"),
  "The grouped authoring preflight missed a siteDefinition without a / route."
);
assert(
  groupedAuthoringPreflight.some((finding) => finding.id === "source.route_element" && /component instead of element/.test(finding.message)),
  "The grouped authoring preflight missed a component-reference route."
);
assert.deepEqual(validateWorkspaceSourcePolicy([
  {
    path: "src/site.tsx",
    content: `import { missingView } from "./missing"; export const siteDefinition={routes:[{path:"/",element:<main>{missingView}</main>}]};`
  },
  { path: "src/styles.css", content: `.safe{display:block}` }
]), [], "A valid homepage with an unresolved local module must reach the repairable compiler failure boundary.");
assert.deepEqual(validateWorkspaceSourcePolicy([
  {
    path: "src/site.tsx",
    content: `const homeRoute={path:"/",element:<main>Home</main>}; const routes=[homeRoute]; export const siteDefinition={routes};`
  },
  { path: "src/styles.css", content: `.safe{display:block}` }
]), [], "A statically declared homepage route was incorrectly rejected by source validation.");
assert.deepEqual(validateWorkspaceSourcePolicy([
  {
    path: "src/site.tsx",
    content: `function route(path:string,element:React.ReactNode){return {path,element}}; const routes=[route("/",<main>Home</main>)]; export const siteDefinition={routes};`
  },
  { path: "src/styles.css", content: `.safe{display:block}` }
]), [], "A helper-composed homepage route was incorrectly rejected before the compiler and artifact route contract could validate it.");
assert(
  validateWorkspaceSourcePolicy([
    {
      path: "src/site.tsx",
      content: `const routes=[{path:"/contact",element:<main>Contact</main>}]; export const siteDefinition={routes};`
    },
    { path: "src/styles.css", content: `.safe{display:block}` }
  ]).some((finding) => finding.id === "source.homepage_route_missing"),
  "A fully static route array without a homepage escaped source validation."
);
const syntaxPreflight = validateWorkspaceSourcePolicy([
  {
    path: "src/site.tsx",
    content: `export const siteDefinition={routes:[{path:"/",element:<main>Home</main>}]};}`
  },
  { path: "src/styles.css", content: `.safe{display:block}` }
]);
assert(
  syntaxPreflight.some((finding) => finding.id === "source.syntax" && /syntax error at 1:77/i.test(finding.message)),
  `The grouped authoring preflight missed a TypeScript syntax error: ${JSON.stringify(syntaxPreflight)}`
);

const websiteSnapshot = sourceSnapshotSchema.parse({
  schemaVersion: 1,
  id: "source_context_fixture",
  businessId: input.businessId,
  sourceType: "website",
  sourceUrl: "https://northstar.example/",
  contentHash: `sha256:${"7".repeat(64)}`,
  capturedAt: "2026-07-20T00:00:00.000Z",
  payload: { fixture: "large source context", content: "A".repeat(160_000) }
});
const structuredContextSnapshot = sourceSnapshotSchema.parse({
  ...websiteSnapshot,
  id: "source_context_structured_fixture",
  contentHash: `sha256:${"8".repeat(64)}`,
  payload: {
    schemaVersion: 1,
    kind: "website-mirror",
    sourceUrl: "https://northstar.example/",
    coverage: "complete",
    completionReason: "queue_exhausted",
    manifestHash: `sha256:${"6".repeat(64)}`,
    counts: { documentsDiscovered: 3, documentsEligible: 3, documentsFetched: 3, documentsExcluded: 0, documentsFailed: 0, documentsUnfinished: 0, resourcesDiscovered: 0, resourcesFetched: 0, resourcesExcluded: 0, resourcesFailed: 0, resourcesUnfinished: 0, browserRendered: 0, uniqueBlobs: 3, rawBytes: 3000, storedBytes: 1200 },
    stages: { discoveryMs: 1, documentFetchMs: 1, dependencyFetchMs: 1, browserFallbackMs: 0, blobPersistenceMs: 1, pageIndexMs: 1, factExtractionMs: 1, finalizationMs: 1 },
    startedAt: "2026-07-20T00:00:00.000Z",
    completedAt: "2026-07-20T00:00:01.000Z",
    elapsedMs: 1000
  }
});
const researchSnapshot = sourceSnapshotSchema.parse({
  schemaVersion: 1,
  id: "source_web_research_fixture",
  businessId: input.businessId,
  sourceType: "web_research",
  sourceUrl: "https://northstar.example/",
  contentHash: `sha256:${"9".repeat(64)}`,
  capturedAt: new Date().toISOString(),
  payload: {
    report: "A relevant local directory confirms the business category (https://directory.example/northstar).",
    sources: [
      "https://directory.example/northstar",
      "https://irrelevant.example/unrelated-paper"
    ],
    coverage: "researched"
  }
});
const researchedContext = createSiteAuthoringContext({
  buildInput: input,
  snapshots: [structuredContextSnapshot, researchSnapshot],
  pages: [
    sourcePage("source_page_home", "/", "Northstar Collision Repair", 550),
    sourcePage("source_page_collision", "/collision-repair", "Collision Repair", 900),
    sourcePage("source_page_about", "/about", "About Northstar Collision Repair", 800)
  ]
});
assert.equal(researchedContext.publishableBusiness.contacts.phone, input.business.contacts.phone);
assert(researchedContext.ownerAuthority.ownerConfirmedFacts.every((fact) => fact.source.ownerConfirmed));
assert.equal(researchedContext.ownerAuthority.ownerOperationalRevision, input.ownerOperationalRevision);
assert.equal(researchedContext.ownerAuthority.ownerIntentRevision, input.ownerIntentRevision);
assert.equal(researchedContext.provisionalSources.length, 2);
assert(JSON.stringify(researchedContext.provisionalSources).includes("directory.example"), "Raw provisional research was not made available to the authoring agent.");
assert.equal(researchedContext.provisionalSources[0]?.websiteInventory?.pages.length, 3, "The complete compact page inventory was not included in authoring context.");
assert(researchedContext.provisionalSources[0]?.websiteInventory?.groupings.linkCommunities.length, "Neutral link-community groupings were not included in authoring context.");
assert.deepEqual(researchedContext.managedCapabilities.forms, input.forms);
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
assert.equal(
  classifySiteAuthoringFailure(new Error("The operation was aborted due to timeout")).code,
  "unknown_internal_failure",
  "A component timeout was mislabeled as exhaustion of the run's overall deadline."
);
assert.equal(
  classifySiteAuthoringFailure(new Error("workflow_deadline_exhausted")).code,
  "deadline_exhausted",
  "The explicit workflow deadline no longer maps to the deadline failure contract."
);
assert.deepEqual(
  classifySiteAuthoringFailure(new Error("Development sandbox receipt has a stale manifest. Run npm run deploy:site-sandbox:dev.")),
  {
    code: "platform_version_mismatch",
    category: "platform",
    retryableByOwner: false,
    message: "Development sandbox receipt has a stale manifest. Run npm run deploy:site-sandbox:dev."
  },
  "A stale sandbox deployment is not classified as a platform-version mismatch."
);
assert.deepEqual(
  classifySiteAuthoringFailure(new Error("Development sandbox credentials are missing. Run npm run dev to configure them.")),
  {
    code: "sandbox_unavailable",
    category: "platform",
    retryableByOwner: false,
    message: "Development sandbox credentials are missing. Run npm run dev to configure them."
  },
  "Missing sandbox credentials are not classified as sandbox unavailability."
);
assert.deepEqual(
  classifySiteAuthoringFailure(new Error("sandbox_destroy_retry_required")),
  {
    code: "sandbox_unavailable",
    category: "platform",
    retryableByOwner: true,
    message: "sandbox_destroy_retry_required"
  },
  "A checkpointed sandbox cleanup race does not offer the owner a fresh explicit retry."
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

function sourcePage(id: string, path: string, title: string, wordCount: number) {
  return sourceSnapshotPageSchema.parse({
    schemaVersion: 1,
    id,
    sourceSnapshotId: "source_context_structured_fixture",
    resourceId: `source_resource_${id}`,
    requestedUrl: `https://northstar.example${path}`,
    finalUrl: `https://northstar.example${path}`,
    path,
    status: 200,
    outcome: "fetched" as const,
    contentType: "text/html",
    indexability: "indexable" as const,
    sitemap: { url: "https://northstar.example/sitemap.xml", lastModified: "2026-07-19T00:00:00.000Z" },
    title,
    headings: [title],
    wordCount,
    internalLinks: ["https://northstar.example/"],
    externalLinks: [],
    rawContentHash: `sha256:${"c".repeat(64)}`,
    templateSignature: `sha256:${"a".repeat(64)}`,
    linkProminence: path === "/" ? 3 : 1,
    extractedText: `${title} retained source content`,
    textContentHash: `sha256:${"d".repeat(64)}`,
    producer: "test",
    inputHash: `sha256:${"c".repeat(64)}`,
    createdAt: "2026-07-20T00:00:00.000Z"
  });
}

function structuredDataFrom(html: string) {
  const source = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  assert(source, "Prepared route omitted LocalBusiness JSON-LD.");
  return JSON.parse(source) as Record<string, unknown>;
}

function finalizeForTest(
  preparedArtifact: ReturnType<typeof prepareSiteArtifact>,
  buildInput: SitePublicBuildInput,
  browserFindings: Array<{
    id: string;
    severity: "error" | "warning" | "info";
    area: "html" | "css" | "route" | "link" | "asset" | "claim" | "capability" | "metadata" | "accessibility" | "render";
    message: string;
    route?: string;
  }> = [],
  routesChecked = preparedArtifact.routes.length
) {
  return finalizePreparedArtifact({
    prepared: preparedArtifact,
    buildInput,
    artifactId: `artifact_test_${buildInput.id}`,
    workspaceRevisionId: "workspace_revision_test",
    runtimeSeriesId: "site-runtime-v1",
    runtimePatchId: "runtime_patch_test",
    storagePrefix: "artifacts/test",
    toolchainVersion: "test-toolchain",
    sandboxImageDigest: `sha256:${"b".repeat(64)}`,
    browserGate: {
      findings: browserFindings,
      screenshotKeys: [],
      routesChecked,
      linksChecked: 0
    },
    createdAt: "2026-07-27T00:00:00.000Z"
  }).artifact;
}
