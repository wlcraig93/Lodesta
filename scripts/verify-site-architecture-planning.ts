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
  siteAgentArchitectureSchema,
  siteArchitecturePlanSchema,
  type SourceSnapshotPage
} from "../packages/site-contracts";

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
assert.deepEqual(releasePlan.redirects, [{
  sourcePath: "/ants",
  destinationPath: "/ant-control",
  reason: "Approved architecture consolidation."
}]);
assert(releasePlan.browserRoutePaths.includes("/") && releasePlan.browserRoutePaths.includes("/ant-control"));

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
const allPageTypesReleasePlan = createArchitectureReleasePlan(surgeSizedPlan, { browserCoverage: "all-page-types" });
assert.equal(allPageTypesReleasePlan.browserRoutePaths.length, 13);
assert(allPageTypesReleasePlan.browserRoutePaths.every((path) => allPageTypesReleasePlan.routePaths.includes(path)));
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
const primaryHubCoverageReleasePlan = createArchitectureReleasePlan(primaryHubCoveragePlan, { browserCoverage: "all-page-types" });
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
const authorDigestEvidence = createArchitectureEvidenceFiles(pages, plan, { retainedContentMode: "indexed-pull-preview-author-digest" });
assert.deepEqual(authorDigestEvidence.map((file) => file.path), ["src/approved-architecture.ts", "src/approved-source-index.ts"]);
assert.match(authorDigestEvidence[1].content, /"evidencePreviews": \[/);
assert.match(authorDigestEvidence[1].content, /source-site\/.+\/pages\/.+\.md/);
assert.doesNotMatch(authorDigestEvidence[1].content, /"headings": \[/);
assert.doesNotMatch(authorDigestEvidence[1].content, /"wordCount":/);
assert.match(authorDigestEvidence[1].content, /mission to provide relationship-based pest control/i);
assert.doesNotMatch(authorDigestEvidence[1].content, /charms? of pleasure|my husband/i);
assert(authorDigestEvidence[1].content.length < readableIndexedPullPreviewEvidence[1].content.length);
assert.match(initialArchitectureAuthoringInstruction("commercial-core-pull"), /retained mirror remains searchable through source-site\/ and the source tools/i);
assert.match(initialArchitectureAuthoringInstruction("commercial-core-pull"), /never map raw extracted paragraphs into pages, cards, or metadata/i);
assert.doesNotMatch(initialArchitectureAuthoringInstruction("commercial-core-pull"), /purpose as its compact message and conversion target/i);
assert.match(initialArchitectureAuthoringInstruction("commercial-core-message-target"), /purpose as its compact message and conversion target/i);
assert.match(initialArchitectureAuthoringInstruction("commercial-core-message-target"), /exact first-party qualitative positioning/i);
assert.match(initialArchitectureAuthoringInstruction("commercial-core-message-target"), /specific safety, toxicity, chemical-use, certification, guarantee, price, availability, or outcome claims still require exact publicFacts support/i);
assert.match(initialArchitectureAuthoringInstruction("commercial-core-message-target"), /release service already owns and applies its exhaustive redirect and retirement ledger/i);
assert.match(initialArchitectureAuthoringInstruction("commercial-core-message-target"), /approved-source-index\.ts as the complete author-facing route manifest/i);
assert.match(initialArchitectureAuthoringInstruction("commercial-core-message-target"), /Do not load src\/approved-architecture\.ts merely to repeat migration data/i);
assert.equal(siteArchitectureSystemPromptFor(), siteArchitectureSystemPrompt);
assert.equal(siteArchitecturePromptIdentityFor(), siteArchitecturePromptIdentity);
assert.notEqual(siteArchitectureSystemPromptFor("commercial-core-pull"), siteArchitectureSystemPrompt);
assert.notEqual(siteArchitecturePromptIdentityFor("commercial-core-pull"), siteArchitecturePromptIdentity);
assert.match(siteArchitectureSystemPromptFor("commercial-core-pull"), /smallest coherent live site/i);
assert.match(siteArchitectureSystemPromptFor("commercial-core-pull"), /sourceDispositions ledger remains mechanically exhaustive/i);
assert.match(siteArchitectureSystemPromptFor("commercial-core-pull"), /live route path already exists in the source inventory.*must be preserved to itself/i);
assert.match(siteArchitectureSystemPromptFor("commercial-core-pull"), /transactional systems as capability boundaries/i);
assert.match(siteArchitectureSystemPromptFor("commercial-core-pull"), /does not rebuild commerce catalogs, carts, checkout, appointment inventory, or provider embeds/i);
assert.match(siteArchitectureSystemPromptFor("commercial-core-pull"), /redirect or retire item-detail, cart, checkout, and other transaction-only paths/i);
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
const commercialCore = await agent.architect({ inventory, architectureMode: "commercial-core-pull" });
assert.equal(commercialCore.promptIdentity, siteArchitecturePromptIdentityFor("commercial-core-pull"));
assert.equal((request as unknown as Record<string, unknown> | undefined)?.instructions, siteArchitectureSystemPromptFor("commercial-core-pull"));

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

function page(id: string, path: string, title: string, extractedText: string): SourceSnapshotPage {
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
    headings: [title],
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
