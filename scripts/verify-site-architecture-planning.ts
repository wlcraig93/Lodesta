import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  WebsiteManagerAgent,
  buildSiteArchitectureInventory,
  createArchitectureEvidenceFiles,
  createArchitectureReleasePlan,
  initialArchitectureAuthoringInstruction,
  mergeArchitectureEvidenceFiles,
  normalizeSiteArchitecturePlan,
  parseApprovedArchitectureModule,
  siteArchitectureInventoryHash,
  siteArchitectureModelId,
  siteArchitectureOutputJsonSchema,
  siteArchitecturePromptIdentity,
  siteArchitecturePromptIdentityFor,
  siteArchitectureSystemPrompt,
  siteArchitectureSystemPromptFor,
  validateSiteArchitecturePlan,
  type RawSiteArchitecturePlan
} from "../packages/site-agent";
import {
  isStaticSiteRoutePath,
  siteAgentArchitectureSchema,
  siteArchitecturePlanSchema,
  type SourceSnapshotPage
} from "../packages/site-contracts";

assert.equal(isStaticSiteRoutePath("/store/p/-plated-daily-serum"), true);
assert.equal(isStaticSiteRoutePath("/store/---"), false);

const pages = [
  page("page_home", "/", "Home", [
    "Nothing prevents our being able to do what we like best every pleasures is too be avoided circumstances obligations.",
    "Isaiah was great and patient. My husband forgot to bring the dog inside and he waited before beginning the service.",
    "Surge Pest Control started with a mission to provide relationship-based pest control to homeowners in the Austin area. If pests return, we guarantee a free treatment."
  ].join("\n")),
  page("page_ant", "/ant-control", "Ant Control", "Ant trails often return when the colony and the conditions supporting it are not addressed together through focused identification and treatment.\nOur services are safe and eco-friendly.\nRoutine service visits occur every 2 months."),
  page("page_ant_query", "/ant-control?campaign=legacy", "Ant Control", "Ant trails often return when the colony and the conditions supporting it are not addressed together through focused identification and treatment."),
  page("page_ants", "/ants", "Ant Guide", "Homeowners can compare trails, nesting locations, moisture, and seasonal activity to identify the most useful next step for common ants.")
];
const inventory = buildSiteArchitectureInventory(pages);
assert.deepEqual(inventory.map((item) => item.path), ["/", "/ant-control", "/ants"]);
assert.equal(inventory.find((item) => item.path === "/ant-control")?.requestedVariants, 2);
assert.match(inventory.find((item) => item.path === "/")?.evidencePreview ?? "", /mission to provide relationship-based pest control/i);
assert.match(inventory.find((item) => item.path === "/ant-control")?.evidencePreview ?? "", /focused identification and treatment/i);
const inventoryHash = siteArchitectureInventoryHash(inventory);

const rawPlan: RawSiteArchitecturePlan = {
  strategy: "Keep the core service route and consolidate the overlapping ant guide into its complete answer.",
  primaryNavigation: [{ label: "Home", path: "/" }, { label: "Ant Control", path: "/ant-control" }],
  routes: [
    { path: "/", label: "Home", purpose: "Introduce the business and guide visitors to the right pest-control help.", pageType: "home", parentPath: null, navigation: "primary" },
    { path: "/ant-control", label: "Ant Control", purpose: "Explain ant identification, treatment, and prevention for prospective customers.", pageType: "service", parentPath: null, navigation: "primary" }
  ],
  sourceDispositions: {
    "/": { disposition: "preserved", targetPath: "/" },
    "/ant-control": { disposition: "preserved", targetPath: "/ant-control" },
    "/ants": { disposition: "redirected", targetPath: "/ant-control" }
  },
  authoringGuidance: ["Carry the practical ant-identification detail into the service route."]
};
const plan = normalizeSiteArchitecturePlan(rawPlan, inventory);
const validation = validateSiteArchitecturePlan(inventory, plan);
assert.equal(validation.complete, true);
assert.deepEqual(plan.routes.find((route) => route.path === "/ant-control")?.sourcePaths, ["/ant-control", "/ants"]);

const redundantNullPreservedTargetPlan = normalizeSiteArchitecturePlan({
  ...rawPlan,
  sourceDispositions: {
    ...rawPlan.sourceDispositions,
    "/": { disposition: "preserved", targetPath: null },
    "/ant-control": { disposition: "preserved", targetPath: null }
  }
}, inventory);
assert.equal(validateSiteArchitecturePlan(inventory, redundantNullPreservedTargetPlan).complete, true);
assert.equal(redundantNullPreservedTargetPlan.sourceDispositions.find((item) => item.sourcePath === "/")?.targetPath, "/");
assert.equal(redundantNullPreservedTargetPlan.sourceDispositions.find((item) => item.sourcePath === "/ant-control")?.targetPath, "/ant-control");

const implicitDestinationPlan = normalizeSiteArchitecturePlan({
  ...rawPlan,
  routes: [rawPlan.routes[0]],
  sourceDispositions: {
    "/": { disposition: "preserved", targetPath: "/" },
    "/ant-control": { disposition: "redirected", targetPath: "/" },
    "/ants": { disposition: "redirected", targetPath: "/ant-control" }
  }
}, inventory);
assert.equal(validateSiteArchitecturePlan(inventory, implicitDestinationPlan).complete, true);
assert.equal(implicitDestinationPlan.sourceDispositions.find((item) => item.sourcePath === "/ant-control")?.disposition, "preserved");
assert(implicitDestinationPlan.routes.some((route) => route.path === "/ant-control"));

const releasePlan = createArchitectureReleasePlan(plan);
assert.deepEqual(releasePlan.routePaths, ["/", "/ant-control"]);
assert.deepEqual(releasePlan.visualReviewRoutePaths, ["/", "/ant-control"]);
assert.deepEqual(releasePlan.redirects, [{
  sourcePath: "/ants",
  destinationPath: "/ant-control",
  reason: "Approved architecture consolidation."
}]);
assert(releasePlan.browserRoutePaths.includes("/") && releasePlan.browserRoutePaths.includes("/ant-control"));

const retainedHtmlPlan = normalizeSiteArchitecturePlan({
  ...rawPlan,
  primaryNavigation: [{ label: "Home", path: "/" }, { label: "Ant Control", path: "/ant-control.html" }],
  routes: [
    rawPlan.routes[0]!,
    { ...rawPlan.routes[1]!, path: "/ant-control.html" }
  ],
  sourceDispositions: {
    "/": { disposition: "preserved", targetPath: "/" },
    "/ant-control": { disposition: "redirected", targetPath: "/ant-control.html" },
    "/ants": { disposition: "redirected", targetPath: "/ant-control.html" }
  }
}, inventory);
assert.equal(validateSiteArchitecturePlan(inventory, retainedHtmlPlan).complete, true);
assert.deepEqual(createArchitectureReleasePlan(retainedHtmlPlan).routePaths, ["/", "/ant-control.html"]);
assert.throws(
  () => siteArchitecturePlanSchema.parse({
    ...retainedHtmlPlan,
    routes: retainedHtmlPlan.routes.map((route) => route.path === "/ant-control.html"
      ? { ...route, path: "/ant-control.exe" }
      : route)
  }),
  /lowercase static slug/i,
  "An executable-looking file extension escaped the canonical live-route contract."
);

const unsafeLegacyRedirectPlan = siteArchitecturePlanSchema.parse({
  ...plan,
  sourceDispositions: [
    ...plan.sourceDispositions,
    {
      sourcePath: "/ph1Pest%20Control%20|%20Eco-Friendly%20&",
      disposition: "redirected",
      targetPath: "/ant-control"
    }
  ]
});
const safeLegacyReleasePlan = createArchitectureReleasePlan(unsafeLegacyRedirectPlan);
assert(!safeLegacyReleasePlan.redirects.some((redirect) => redirect.sourcePath.includes("|")));
assert(safeLegacyReleasePlan.retiredSourcePaths.some((entry) => entry.sourcePath.includes("|")));

const surgeSizedPlan = siteArchitecturePlanSchema.parse({
  ...plan,
  primaryNavigation: [{ label: "Home", path: "/" }],
  routes: Array.from({ length: 13 }, (_, index) => {
    const path = index === 0 ? "/" : `/service-${index}`;
    return {
      path,
      label: index === 0 ? "Home" : `Service ${index}`,
      purpose: index === 0 ? "Introduce the business and its complete service offering." : `Explain service ${index} with retained source detail.`,
      pageType: index === 0 ? "home" : `service-${index}`,
      parentPath: null,
      navigation: index === 0 ? "primary" : "none",
      sourcePaths: [path]
    };
  }),
  sourceDispositions: Array.from({ length: 13 }, (_, index) => {
    const path = index === 0 ? "/" : `/service-${index}`;
    return { sourcePath: path, disposition: "preserved", targetPath: path };
  })
});
const surgeSizedReleasePlan = createArchitectureReleasePlan(surgeSizedPlan);
assert.equal(surgeSizedReleasePlan.routePaths.length, 13);
assert.equal(surgeSizedReleasePlan.browserRoutePaths.length, 7);
assert(surgeSizedReleasePlan.browserRoutePaths.every((path) => surgeSizedReleasePlan.routePaths.includes(path)));
const allRoutesReleasePlan = createArchitectureReleasePlan(surgeSizedPlan, { browserCoverage: "all-routes" });
assert.equal(allRoutesReleasePlan.browserRoutePaths.length, 13);
assert.deepEqual(allRoutesReleasePlan.browserRoutePaths, allRoutesReleasePlan.routePaths);
const primaryHubCoveragePlan = siteArchitecturePlanSchema.parse({
  ...surgeSizedPlan,
  primaryNavigation: [
    { label: "Home", path: "/" },
    { label: "Services", path: "/service-1" },
    { label: "Guides", path: "/service-2" }
  ],
  routes: surgeSizedPlan.routes.map((route, index) => index === 1 || index === 2
    ? { ...route, pageType: "hub", navigation: "primary" as const }
    : route)
});
const primaryHubCoverageReleasePlan = createArchitectureReleasePlan(primaryHubCoveragePlan, { browserCoverage: "all-routes" });
assert(primaryHubCoverageReleasePlan.browserRoutePaths.includes("/service-1"));
assert(primaryHubCoverageReleasePlan.browserRoutePaths.includes("/service-2"));
const contactCoveredPlan = siteArchitecturePlanSchema.parse({
  ...surgeSizedPlan,
  routes: [...surgeSizedPlan.routes, {
    path: "/contact",
    label: "Contact",
    purpose: "Give customers a direct path to ask a question or request service.",
    pageType: "contact",
    parentPath: null,
    navigation: "primary",
    sourcePaths: ["/contact"]
  }],
  sourceDispositions: [...surgeSizedPlan.sourceDispositions, {
    sourcePath: "/contact",
    disposition: "preserved",
    targetPath: "/contact"
  }]
});
const contactCoveredReleasePlan = createArchitectureReleasePlan(contactCoveredPlan);
assert.equal(contactCoveredReleasePlan.browserRoutePaths.length, 7);
assert(contactCoveredReleasePlan.browserRoutePaths.includes("/contact"));

const siblingReviewPlan = siteArchitecturePlanSchema.parse({
  ...contactCoveredPlan,
  routes: [
    contactCoveredPlan.routes[0]!,
    {
      path: "/services",
      label: "Services",
      purpose: "Help customers choose the appropriate service for their situation.",
      pageType: "service-hub",
      parentPath: null,
      navigation: "primary",
      sourcePaths: ["/services"]
    },
    ...["ants", "rodents", "termites"].map((slug) => ({
      path: `/services/${slug}`,
      label: `${slug} service`,
      purpose: `Help customers understand ${slug} service and request assistance.`,
      pageType: "service-detail",
      parentPath: "/services",
      navigation: "contextual" as const,
      sourcePaths: [`/services/${slug}`]
    })),
    {
      path: "/areas",
      label: "Service areas",
      purpose: "Help customers determine whether their location is served.",
      pageType: "location-hub",
      parentPath: "/",
      navigation: "primary",
      sourcePaths: ["/areas"]
    },
    {
      path: "/about",
      label: "About",
      purpose: "Help customers understand the business and its local role.",
      pageType: "about",
      parentPath: "/",
      navigation: "primary",
      sourcePaths: ["/about"]
    },
    { ...contactCoveredPlan.routes.at(-1)!, parentPath: "/" },
    {
      path: "/image-credit",
      label: "Image credit",
      purpose: "Record source-sensitive image attribution for the website.",
      pageType: "utility",
      parentPath: "/",
      navigation: "footer",
      sourcePaths: ["/image-credit"]
    }
  ],
  sourceDispositions: [
    { sourcePath: "/", disposition: "preserved", targetPath: "/" },
    { sourcePath: "/services", disposition: "preserved", targetPath: "/services" },
    ...["ants", "rodents", "termites"].map((slug) => ({
      sourcePath: `/services/${slug}`,
      disposition: "preserved" as const,
      targetPath: `/services/${slug}`
    })),
    ...["areas", "about", "contact", "image-credit"].map((slug) => ({
      sourcePath: `/${slug}`,
      disposition: "preserved" as const,
      targetPath: `/${slug}`
    }))
  ]
});
assert.deepEqual(
  createArchitectureReleasePlan(siblingReviewPlan).visualReviewRoutePaths,
  ["/", "/services", "/services/ants", "/services/rodents", "/contact"],
  "The author-facing review did not preserve a hub and two sibling detail routes."
);

const evidence = createArchitectureEvidenceFiles(pages, plan);
assert(evidence.some((file) => file.path === "src/approved-architecture.ts" && file.content.includes("ant-control")));
const architectureModule = evidence.find((file) => file.path === "src/approved-architecture.ts");
assert(architectureModule);
assert.deepEqual(parseApprovedArchitectureModule(architectureModule.content), plan);
assert.equal(parseApprovedArchitectureModule(`${architectureModule.content}export const extra = true;\n`), undefined);
assert.equal(parseApprovedArchitectureModule("export const approvedArchitecture = notJson as const;\n"), undefined);
assert(evidence.some((file) => file.path === "src/retained-source-content-001.ts" && file.content.includes("focused identification and treatment")));
const merged = mergeArchitectureEvidenceFiles([
  { path: "src/site.tsx", content: "export const siteDefinition = {};" },
  { path: "src/styles.css", content: "body{}" },
  { path: "src/approved-architecture.ts", content: "stale" }
], evidence);
assert(merged.some((file) => file.path === "src/site.tsx"));
assert.notEqual(merged.find((file) => file.path === "src/approved-architecture.ts")?.content, "stale");
const pullEvidence = createArchitectureEvidenceFiles(pages, plan, { retainedContentMode: "pull" });
assert.deepEqual(pullEvidence.map((file) => file.path), ["src/approved-architecture.ts"]);
const indexedPullEvidence = createArchitectureEvidenceFiles(pages, plan, { retainedContentMode: "indexed-pull" });
assert.deepEqual(indexedPullEvidence.map((file) => file.path), ["src/approved-architecture.ts", "src/approved-source-index.ts"]);
assert.match(indexedPullEvidence[1].content, /source-site\/.+\/pages\/.+\.md/);
assert.match(indexedPullEvidence[1].content, /ant-control/i);
assert.doesNotMatch(indexedPullEvidence[1].content, /evidencePreviews/);
const indexedPullPreviewEvidence = createArchitectureEvidenceFiles(pages, plan, { retainedContentMode: "indexed-pull-preview" });
assert.deepEqual(indexedPullPreviewEvidence.map((file) => file.path), ["src/approved-architecture.ts", "src/approved-source-index.ts"]);
assert.match(indexedPullPreviewEvidence[1].content, /evidencePreviews/);
assert.match(indexedPullPreviewEvidence[1].content, /Ant trails often return/);
assert.doesNotMatch(indexedPullPreviewEvidence[1].content, /safe and eco-friendly/i);
assert.doesNotMatch(indexedPullPreviewEvidence[1].content, /every 2 months/i);
assert(indexedPullPreviewEvidence[1].content.length > indexedPullEvidence[1].content.length);
const readableIndexedPullPreviewEvidence = createArchitectureEvidenceFiles(pages, plan, { retainedContentMode: "indexed-pull-preview-readable" });
assert.deepEqual(readableIndexedPullPreviewEvidence.map((file) => file.path), ["src/approved-architecture.ts", "src/approved-source-index.ts"]);
assert.match(readableIndexedPullPreviewEvidence[1].content, /\n  \{\n    "routePath": "\/"/);
assert.match(readableIndexedPullPreviewEvidence[1].content, /"evidencePreviews": \[/);
assert(readableIndexedPullPreviewEvidence[1].content.length > indexedPullPreviewEvidence[1].content.length);
const deepEvidenceText = [
  "Begin with the visible condition and explain why it matters to the property owner before discussing the service.",
  "Describe the first decision in concrete language so a reader can understand what information will help the estimate.",
  "Use one section for observable signs and another for the surrounding property context that changes the recommendation.",
  "Explain how access, nearby structures, and the condition of the site can shape the practical next step for the customer.",
  "Carry a specific preparation detail into the page instead of substituting a generic promise about professional service.",
  "This later source detail gives the retained route a complete middle argument that the short routing sample cannot carry.",
  "Close with a route-specific action that tells the customer what to share without inventing a response time or outcome."
].join("\n");
const deepEvidencePage = page("page_deep_service", "/deep-service", "Deep Service", deepEvidenceText);
const deepEvidencePlan = siteArchitecturePlanSchema.parse({
  strategy: "Preserve the source-rich service as a distinct customer answer.",
  primaryNavigation: [{ label: "Deep Service", path: "/deep-service" }],
  routes: [{
    path: "/deep-service",
    label: "Deep Service",
    purpose: "Help customers understand the condition, decision, and next step.",
    pageType: "service",
    parentPath: null,
    navigation: "primary",
    sourcePaths: ["/deep-service"]
  }],
  sourceDispositions: [{ sourcePath: "/deep-service", disposition: "preserved", targetPath: "/deep-service" }],
  authoringGuidance: []
});
const boundedDeepEvidence = createArchitectureEvidenceFiles([deepEvidencePage], deepEvidencePlan, { retainedContentMode: "indexed-pull-preview" });
const readableDeepEvidence = createArchitectureEvidenceFiles([deepEvidencePage], deepEvidencePlan, { retainedContentMode: "indexed-pull-preview-readable" });
assert.doesNotMatch(boundedDeepEvidence[1].content, /later source detail gives the retained route/i);
assert.match(readableDeepEvidence[1].content, /later source detail gives the retained route/i);
assert.doesNotMatch(readableDeepEvidence[1].content, /short routing sample cannot carr[^y]/i, "Readable preview ended in a partial word.");
const authorDigestEvidence = createArchitectureEvidenceFiles(pages, plan, { retainedContentMode: "indexed-pull-preview-author-digest" });
assert.deepEqual(authorDigestEvidence.map((file) => file.path), ["src/approved-architecture.ts", "src/approved-source-index.ts"]);
assert.match(authorDigestEvidence[1].content, /"evidencePreviews": \[/);
assert.match(authorDigestEvidence[1].content, /source-site\/.+\/pages\/.+\.md/);
assert.doesNotMatch(authorDigestEvidence[1].content, /"headings": \[/);
assert.doesNotMatch(authorDigestEvidence[1].content, /"wordCount":/);
assert.match(authorDigestEvidence[1].content, /mission to provide relationship-based pest control/i);
assert.doesNotMatch(authorDigestEvidence[1].content, /charms? of pleasure|my husband/i);
assert(authorDigestEvidence[1].content.length < readableIndexedPullPreviewEvidence[1].content.length);
const customerProofText = "“Kevin arrived when expected, listened carefully, and treated our home with patience,” my husband said after the service visit.";
const proofPages = [
  ...pages,
  page("page_reviews", "/reviews", "Customer Reviews", customerProofText),
  page("page_service_with_shared_review_heading", "/service-with-shared-review-heading", "Pest Service", "Useful service-specific guidance for the customer.", ["Pest Service", "Proven Results. Real Reviews."]),
  page("page_site_map", "/site-map", "Site Map", "This oversized utility index lists every archive, category, service, article, and mechanical destination on the legacy website for navigation purposes.")
];
const proofPlan = siteArchitecturePlanSchema.parse({
  ...plan,
  routes: plan.routes.map((route) => route.path === "/"
    ? { ...route, sourcePaths: ["/", "/reviews", "/service-with-shared-review-heading", "/site-map"] }
    : route),
  sourceDispositions: [
    ...plan.sourceDispositions,
    { sourcePath: "/reviews", disposition: "redirected" as const, targetPath: "/" },
    { sourcePath: "/service-with-shared-review-heading", disposition: "redirected" as const, targetPath: "/" },
    { sourcePath: "/site-map", disposition: "redirected" as const, targetPath: "/" }
  ]
});
const proofDigestEvidence = createArchitectureEvidenceFiles(proofPages, proofPlan, { retainedContentMode: "indexed-pull-preview-author-digest" });
assert.match(proofDigestEvidence[1].content, /Kevin arrived when expected.*my husband said after the service visit/i);
assert.doesNotMatch(proofDigestEvidence[1].content, /oversized utility index/i);
assert.doesNotMatch(proofDigestEvidence[1].content, /service-specific guidance/i);
assert.match(initialArchitectureAuthoringInstruction("commercial-core-pull"), /retained mirror remains searchable through source-site\/ and the source tools/i);
assert.match(initialArchitectureAuthoringInstruction("commercial-core-pull"), /never map raw extracted paragraphs into pages, cards, or metadata/i);
assert.doesNotMatch(initialArchitectureAuthoringInstruction("commercial-core-pull"), /purpose as its compact message and conversion target/i);
assert.match(initialArchitectureAuthoringInstruction("commercial-core-message-target"), /purpose as its compact message and conversion target/i);
assert.match(initialArchitectureAuthoringInstruction("commercial-core-message-target"), /exact first-party qualitative positioning/i);
assert.match(initialArchitectureAuthoringInstruction("commercial-core-message-target"), /specific safety, toxicity, chemical-use, certification, guarantee, price, availability, or outcome claims still require exact publicFacts support/i);
assert.match(initialArchitectureAuthoringInstruction("commercial-core-message-target"), /release service already owns and applies its exhaustive redirect and retirement ledger/i);
assert.match(initialArchitectureAuthoringInstruction("commercial-core-message-target"), /approved-source-index\.ts as the complete author-facing route manifest/i);
assert.match(initialArchitectureAuthoringInstruction("commercial-core-message-target"), /Do not load src\/approved-architecture\.ts merely to repeat migration data/i);
assert.match(initialArchitectureAuthoringInstruction("commercial-core-message-target"), /evidencePreview is a routing sample, not a content budget/i);
assert.match(initialArchitectureAuthoringInstruction("commercial-core-message-target"), /use its mapped contentFiles whenever the preview does not carry the complete page argument/i);
assert.equal(siteArchitectureSystemPromptFor(), siteArchitectureSystemPrompt);
assert.equal(siteArchitecturePromptIdentityFor(), siteArchitecturePromptIdentity);
assert.notEqual(siteArchitectureSystemPromptFor("commercial-core-pull"), siteArchitectureSystemPrompt);
assert.notEqual(siteArchitecturePromptIdentityFor("commercial-core-pull"), siteArchitecturePromptIdentity);
assert.match(siteArchitectureSystemPromptFor("commercial-core-pull"), /smallest coherent live site/i);
assert.match(siteArchitectureSystemPromptFor("commercial-core-pull"), /evidencePreview is a bounded source sample.*not draft copy/i);
assert.match(siteArchitectureSystemPromptFor("commercial-core-pull"), /different service or pest label does not by itself justify a separate live route/i);
assert.match(siteArchitectureSystemPromptFor("commercial-core-pull"), /copied location lists, noun-swapped prose, topic leakage.*thin even when.*large word count/i);
assert.match(siteArchitectureSystemPromptFor("commercial-core-pull"), /sourceDispositions ledger remains mechanically exhaustive/i);
assert.match(siteArchitectureSystemPromptFor("commercial-core-pull"), /live route path already exists in the source inventory.*must be preserved to itself/i);
assert.match(siteArchitectureSystemPromptFor("commercial-core-pull"), /transactional systems as capability boundaries/i);
assert.match(siteArchitectureSystemPromptFor("commercial-core-pull"), /does not rebuild commerce catalogs, carts, checkout, appointment inventory, provider embeds, or third-party review submission/i);
assert.match(siteArchitectureSystemPromptFor("commercial-core-pull"), /redirect or retire item-detail, cart, checkout, review-submission, and other transaction-only paths/i);
assert.match(siteArchitectureSystemPromptFor("commercial-core-pull"), /leave-a-review route is transaction-only.*never preserve it as a live authored route.*promises a destination.*cannot establish/i);
assert.match(siteArchitectureSystemPromptFor("commercial-core-pull"), /owner-approved external review destination is materialized separately for the author/i);
assert.match(siteArchitectureSystemPromptFor("commercial-core-pull"), /does not provide authored-site search/i);
assert.match(siteArchitectureSystemPromptFor("commercial-core-pull"), /legacy utility URL is not by itself a customer job/i);
assert.match(siteArchitectureSystemPromptFor("commercial-core-pull"), /distinct article title or search question is not enough/i);
assert.match(siteArchitectureSystemPromptFor("commercial-core-pull"), /smaller complete editorial collection.*shallow pages/i);
assert.match(siteArchitectureSystemPromptFor("commercial-core-pull"), /project or gallery route needs identifiable work, places, imagery, or outcomes/i);
assert.match(siteArchitectureSystemPromptFor("commercial-core-pull"), /reviews route needs attributable customer feedback/i);
assert.match(siteArchitectureSystemPromptFor("commercial-core-pull"), /Do not create a dedicated service-area route from one broad region or state label alone/i);
assert.doesNotMatch(siteArchitectureSystemPromptFor("commercial-core-pull"), /purpose field as a compact authoring brief/i);
assert.match(siteArchitectureSystemPromptFor("commercial-core-message-target"), /purpose field as a compact authoring brief/i);
assert.match(siteArchitectureSystemPromptFor("commercial-core-message-target"), /concrete customer decision or question/i);
assert.match(siteArchitectureSystemPromptFor("commercial-core-message-target"), /Do not draft slogans, headlines, or prose/i);
assert.match(siteArchitectureSystemPromptFor("commercial-core-message-target"), /safe bee removal/i);
assert.match(siteArchitectureSystemPromptFor("commercial-core-message-target"), /authoringGuidance limited to route ownership, consolidation, reachability.*never prescribe factual page content, service methods, proof, timing, safety, or outcomes/i);
assert.notEqual(siteArchitecturePromptIdentityFor("commercial-core-message-target"), siteArchitecturePromptIdentityFor("commercial-core-pull"));
const reconstructionSource = await readFile("scripts/reconstruct-site-agent-workspace.ts", "utf8");
const reconstructionRendererSource = await readFile("scripts/render-reconstructed-site-agent-workspace.ts", "utf8");
assert(
  reconstructionSource.includes("retainedContentModeForAuthoringProfile(authoringProfile)"),
  "Retained full-site runs cannot reconstruct the evidence mode selected by their authoring profile."
);
assert(
  reconstructionSource.includes('sourceProvenance: "retained_candidate_sidecar"')
    || reconstructionSource.includes('"retained_candidate_sidecar" | "replayed_mutations"')
);
assert(!reconstructionSource.includes("components/mobile-navigation.tsx")
  && !reconstructionSource.includes("components/managed-lead-form.tsx"),
"Initial reconstruction must not restore retired visual recipes.");
assert(reconstructionSource.includes('files.set("src/required-destinations.tsx", requiredDestinationsSource(buildInput))'),
  "Initial reconstruction must restore materialized owner-authoritative destinations.");
assert(
  reconstructionRendererSource.includes("readReconstructedSourceFiles(sourceDirectory)"),
  "Failed full-site reconstructions do not render all reconstructed source modules."
);
assert(
  reconstructionRendererSource.includes("LODESTA_RECONSTRUCT_INSPECTION_COUNT")
    && reconstructionRendererSource.includes("effectiveBuildInput.capabilityConfiguration.trustedRuntimeSeries"),
  "The retained-source renderer must reproduce repeated inspections with the candidate's actual runtime series."
);

const invalidPlan = {
  ...plan,
  sourceDispositions: plan.sourceDispositions.map((item) => item.sourcePath === "/ants"
    ? { ...item, targetPath: "/missing" }
    : item)
};
assert.equal(validateSiteArchitecturePlan(inventory, invalidPlan).complete, false);

const schema = siteArchitectureOutputJsonSchema(inventory);
assert.deepEqual(schema.properties.sourceDispositions.required, ["/", "/ant-control", "/ants"]);

const legalInventory = buildSiteArchitectureInventory([
  ...pages,
  page(
    "page_privacy",
    "/privacy",
    "Privacy Policy",
    "This privacy policy explains what contact information is collected, how it is used to respond to service requests, when service providers may process it, how long records are retained, and how customers may ask questions or request corrections."
  )
]);
const legalSchema = siteArchitectureOutputJsonSchema(legalInventory);
const privacyDispositionSchema = legalSchema.properties.sourceDispositions.properties["/privacy"];
assert.deepEqual(privacyDispositionSchema.properties.disposition.enum, ["preserved"]);
assert.equal(privacyDispositionSchema.properties.targetPath.const, "/privacy");
const unsafeLegalPlan = normalizeSiteArchitecturePlan({
  ...rawPlan,
  sourceDispositions: {
    ...rawPlan.sourceDispositions,
    "/privacy": { disposition: "retired", targetPath: null }
  }
}, legalInventory);
assert.equal(validateSiteArchitecturePlan(legalInventory, unsafeLegalPlan).complete, false);
assert.deepEqual(validateSiteArchitecturePlan(legalInventory, unsafeLegalPlan).unsafeLegalDispositions, [{
  sourcePath: "/privacy",
  disposition: "retired",
  targetPath: null
}]);

let request: Record<string, unknown> | undefined;
const agent = new WebsiteManagerAgent({
  create: async (params) => {
    request = params as unknown as Record<string, unknown>;
    return {
      id: "response_architecture",
      model: siteArchitectureModelId,
      output: [],
      output_text: JSON.stringify(rawPlan),
      status: "completed",
      error: null,
      incomplete_details: null,
      usage: {
        input_tokens: 1_000,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
        output_tokens: 500,
        output_tokens_details: { reasoning_tokens: 100 },
        total_tokens: 1_500
      }
    };
  }
});
const generated = await agent.architect({ inventory });
assert.equal(generated.modelId, siteArchitectureModelId);
assert.equal(generated.validation.complete, true);
assert.equal(request?.model, siteArchitectureModelId);
assert.deepEqual(request?.reasoning, { effort: "high" });
assert.equal((request?.text as { format?: { name?: string } })?.format?.name, "exhaustive_site_architecture");

request = undefined;
const commercialCore = await agent.architect({
  inventory,
  authorityContext: {
    businessName: "Surge Pest Control",
    description: "Residential pest control for Austin-area homeowners.",
    locations: [{ label: "Austin office", city: "Austin", region: "TX", country: "US" }],
    serviceAreas: ["Austin metro"],
    offerings: ["Pest control"]
  },
  architectureMode: "commercial-core-pull"
});
assert.equal(commercialCore.promptIdentity, siteArchitecturePromptIdentityFor("commercial-core-pull"));
assert.equal((request as unknown as Record<string, unknown> | undefined)?.instructions, siteArchitectureSystemPromptFor("commercial-core-pull"));
assert.match(JSON.stringify((request as unknown as Record<string, unknown> | undefined)?.input), /Owner authority/);
assert.match(JSON.stringify((request as unknown as Record<string, unknown> | undefined)?.input), /Austin metro/);

assert.doesNotThrow(() => siteAgentArchitectureSchema.parse({
  schemaVersion: 1,
  producer: "site-architecture@test",
  modelId: siteArchitectureModelId,
  reasoningEffort: "high",
  publicBuildInputId: "input_test",
  sourceInventoryHash: inventoryHash,
  planHash: `sha256:${"a".repeat(64)}`,
  generatedAt: "2026-08-03T00:00:00.000Z",
  plan,
  usage: {
    inputTokens: generated.usage.inputTokens,
    cachedInputTokens: generated.usage.cachedInputTokens,
    reasoningTokens: generated.usage.reasoningTokens,
    outputTokens: generated.usage.outputTokens,
    costUsd: generated.usage.costUsd,
    costSource: generated.usage.costSource,
    upstreamInferenceCostUsd: generated.usage.upstreamInferenceCostUsd,
    durationMs: generated.usage.durationMs
  }
}));

process.stdout.write(`${JSON.stringify({
  ok: true,
  canonicalInventoryPaths: inventory.length,
  plannedRoutes: plan.routes.length,
  exhaustiveDispositions: plan.sourceDispositions.length,
  model: generated.modelId,
  singleArchitectureRequest: true
})}\n`);

function page(id: string, path: string, title: string, extractedText: string, headings: string[] = [title]): SourceSnapshotPage {
  return {
    schemaVersion: 1,
    id,
    sourceSnapshotId: "source_test",
    resourceId: `resource_${id}`,
    requestedUrl: `https://example.com${path}`,
    finalUrl: `https://example.com${path}`,
    path,
    outcome: "fetched",
    status: 200,
    contentType: "text/html",
    indexability: "indexable",
    title,
    headings,
    wordCount: extractedText.split(/\s+/).length,
    internalLinks: [],
    externalLinks: [],
    rawContentHash: `sha256:${"b".repeat(64)}`,
    templateSignature: `sha256:${"c".repeat(64)}`,
    linkProminence: path === "/" ? 10 : 2,
    extractedText,
    textContentHash: `sha256:${"d".repeat(64)}`,
    producer: "test",
    inputHash: `sha256:${"e".repeat(64)}`,
    createdAt: "2026-08-03T00:00:00.000Z"
  };
}
