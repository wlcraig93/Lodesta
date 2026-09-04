import assert from "node:assert/strict";
import sharp from "sharp";
import { summarizeCrawlHtml } from "../lib/crawler";
import { sha256 } from "../packages/business-data";
import { createImageBytes, managerToolArguments } from "../packages/site-agent";
import { assetRevisionSchema, type AssetRevisionRef } from "../packages/site-contracts";
import { WorkspaceManagerRuntime } from "../packages/site-platform/manager-runtime";
import { reusableActiveSourceAssetRef } from "../packages/site-platform/workflow";
import { createMediaContactSheet } from "../packages/site-verification";
import { buildSyntheticSiteInput } from "./support/synthetic-site-input";

const validSiteSource = 'export const siteDefinition = { routes: [{ path: "/", element: <main><h1>Home</h1></main> }] };';

const image = await sharp({
  create: { width: 320, height: 180, channels: 3, background: "#b84f34" }
}).webp().toBuffer();
const crawlSummary = summarizeCrawlHtml(`
  <html><head>
    ${Array.from({ length: 8 }, (_, index) => `<link rel="icon" href="https://cdn.example.com/icon-${index}.png">`).join("")}
  </head><body>
    ${Array.from({ length: 15 }, (_, index) => `<img src="https://cdn.example.com/photo-${index}.webp" alt="Shop photo ${index}">`).join("")}
  </body></html>
`, "https://business.example/gallery");
assert.equal(crawlSummary.assetReferences.filter((item) => item.kind === "icon").length, 6);
assert.equal(crawlSummary.assetReferences.filter((item) => item.kind === "image").length, 12);
assert(crawlSummary.assetReferences.every((item) => item.sourcePageUrl === "https://business.example/gallery"));
const assets: AssetRevisionRef[] = [
  mediaRef("asset_logo", "logo", "source_website"),
  mediaRef("asset_shop", "photo", "owner_upload")
];
const sheet = await createMediaContactSheet([
  { asset: assets[0], bytes: image, sourcePageUrl: "https://example.com/about" },
  { asset: assets[1], bytes: image }
]);
assert(sheet, "media contact sheet was not created");
const sheetMetadata = await sharp(sheet).metadata();
assert.equal(sheetMetadata.width, 1200);
assert((sheetMetadata.height ?? 0) > 300);
assert.equal(sheetMetadata.format, "webp");

assert.doesNotThrow(() => managerToolArguments.create_image.parse({
  action: "generate",
  purpose: "hero",
  prompt: "A restrained, text-free abstract background with room for a heading.",
  sourceAssetIds: [],
  size: "1536x1024",
  alt: "Warm abstract background"
}));
assert.throws(() => managerToolArguments.create_image.parse({
  action: "edit",
  purpose: "hero",
  prompt: "Improve the crop.",
  sourceAssetIds: [],
  size: "1536x1024",
  alt: "Workshop"
}));

const generatedWebp = await sharp({
  create: { width: 1024, height: 1024, channels: 3, background: "#24463e" }
}).webp().toBuffer();
let generatedRequest: Record<string, unknown> | undefined;
const generated = await createImageBytes({
  action: "generate",
  purpose: "background",
  prompt: "A subtle, text-free background texture.",
  sourceAssetIds: [],
  size: "1024x1024",
  alt: "Subtle green texture"
}, [], {
  client: {
    images: {
      generate: async (request: Record<string, unknown>) => {
        generatedRequest = request;
        return {
          data: [{ b64_json: generatedWebp.toString("base64") }],
          usage: {
            input_tokens: 120,
            input_tokens_details: { text_tokens: 120, image_tokens: 0 },
            output_tokens: 7_000,
            total_tokens: 7_120
          }
        };
      }
    }
  } as never
});
assert.equal(generatedRequest?.model, "gpt-image-2");
assert.equal(generatedRequest?.quality, "high");
assert.equal(generatedRequest?.output_format, "webp");
assert.equal(generatedRequest?.moderation, "auto");
assert.equal(generated.width, 1024);
assert.equal(generated.usage.costSource, "catalog_estimate");
assert.equal(generated.usage.costUsd, 0.2106);

let builds = 0;
const runtime = new WorkspaceManagerRuntime<string>({
  kind: "edit",
  publicBuildInputId: "input_media",
  toolchainVersion: "toolchain-test",
  sandboxImageDigest: `sha256:${"a".repeat(64)}`,
  initialSandboxRevision: "sandbox_1",
  initialFiles: [
    { path: "src/site.tsx", content: validSiteSource },
    { path: "src/styles.css", content: "body{}" }
  ],
  referenceFiles: [{
    path: "source-site/source_test/pages/source_page_home.md",
    content: "---\nreadOnly: true\n---\nRetained termite treatment details."
  }],
  applyBuild: async () => ({ revision: `sandbox_${++builds + 1}`, buildDurationMs: 1, previewPath: "/preview" }),
  inspect: async () => ({
    passed: true,
    inspectionHash: `sha256:${"b".repeat(64)}`,
    modelSummary: { routes: ["/"] },
    diagnosticSummary: {},
    checkpoint: "verified"
  }),
  createImage: async () => ({
    modelOutput: JSON.stringify({ ok: true, assetId: "asset_generated" }),
    diagnosticOutput: { ok: true, assetId: "asset_generated" }
  })
});
const listedWorkspace = await runtime.execute({ callId: "list", name: "list_files", arguments: {} });
assert.equal((listedWorkspace.diagnosticOutput.files as Array<{ path: string; readOnly: boolean }>).find((file) => file.path.startsWith("source-site/"))?.readOnly, true);
const searchedReferences = await runtime.execute({
  callId: "search-reference",
  name: "search_files",
  arguments: { query: "termite treatment", paths: [], caseSensitive: false }
});
assert.equal((searchedReferences.diagnosticOutput.matches as Array<{ path: string }>)[0]?.path, "source-site/source_test/pages/source_page_home.md");
const readReference = await runtime.execute({
  callId: "read-reference",
  name: "read_files",
  arguments: { files: [{ path: "source-site/source_test/pages/source_page_home.md", startLine: null, endLine: null }] }
});
assert.match(readReference.modelOutput as string, /Retained termite treatment details/);
await assert.rejects(() => runtime.execute({
  callId: "write-reference",
  name: "write_file",
  arguments: { path: "source-site/source_test/pages/source_page_home.md", content: "overwrite" }
}));
await runtime.execute({ callId: "build", name: "build_preview", arguments: {} });
await runtime.execute({ callId: "image", name: "create_image", arguments: {} });
const invalidRedirectFinish = await runtime.execute({
  callId: "finish-invalid-redirect",
  name: "finish",
  arguments: {
    ownerMessage: "Done",
    focusRoute: "/",
    changedRoutes: ["/"],
    redirects: [{ sourcePath: "/?p=8024", destinationPath: "/", reason: "Invalid query route." }],
    retiredSourcePaths: []
  }
});
assert.equal(invalidRedirectFinish.diagnosticOutput.ok, false);
assert.equal(invalidRedirectFinish.diagnosticOutput.error, "finish_source_disposition_invalid");
assert.match(String(invalidRedirectFinish.diagnosticOutput.guidance), /Omit query-string/i);
const rebuiltFinish = await runtime.execute({ callId: "finish", name: "finish", arguments: { ownerMessage: "Done", focusRoute: "/", changedRoutes: ["/"] } });
assert.equal(rebuiltFinish.diagnosticOutput.ok, true, JSON.stringify(rebuiltFinish.diagnosticOutput));
assert.equal(rebuiltFinish.diagnosticOutput.buildPerformed, true);
assert.equal(builds, 2, "Finish did not rebuild after generated media changed the workspace.");
const cachedBuild = await runtime.execute({ callId: "build-cached", name: "build_preview", arguments: {} });
assert.equal(cachedBuild.diagnosticOutput.cached, true);
const freshPlacementFinish = await runtime.execute({ callId: "finish-fresh-placement", name: "finish", arguments: { ownerMessage: "Done", focusRoute: "/", changedRoutes: ["/"] } });
assert.equal(freshPlacementFinish.diagnosticOutput.ok, true);
assert.equal(freshPlacementFinish.diagnosticOutput.buildPerformed, false);
assert.equal(builds, 2, "Finish rebuilt a workspace that already had a successful build for the same source hash.");

let visualBuilds = 0;
let visualInspections = 0;
let visualMechanicalInspections = 0;
let visualReleaseVerifications = 0;
let inspectedTarget: { route?: string; selector?: string; label?: string } | undefined;
const visualRuntime = new WorkspaceManagerRuntime<string>({
  kind: "edit",
  publicBuildInputId: "input_visual",
  toolchainVersion: "toolchain-test",
  sandboxImageDigest: `sha256:${"a".repeat(64)}`,
  initialSandboxRevision: "sandbox_visual_1",
  initialFiles: [
    { path: "src/site.tsx", content: validSiteSource },
    { path: "src/styles.css", content: "body{}" }
  ],
  selection: {
    route: "/",
    selector: "section.hero > h1",
    label: "Hero heading"
  },
  applyBuild: async () => ({ revision: `sandbox_visual_${++visualBuilds + 1}`, buildDurationMs: 1, previewPath: "/preview" }),
  inspectVisual: async (_files, _sandboxRevision, target) => {
    visualInspections += 1;
    inspectedTarget = target;
    return {
      inspectionHash: `sha256:${"c".repeat(64)}`,
      modelSummary: { requestedRoute: target.route, requestedSelector: target.selector, routes: ["/", "/services"] },
      diagnosticSummary: {},
      images: [{ type: "input_image", image_url: "data:image/png;base64,AA==", detail: "high" }]
    };
  },
  inspect: async () => {
    visualMechanicalInspections += 1;
    return {
      passed: true,
      inspectionHash: `sha256:${"d".repeat(64)}`,
      modelSummary: {
        advisories: [
          { code: "shared-spacing", severity: "warning", area: "css", route: "/", viewport: "desktop", selector: ".shared-card", message: "Shared card spacing is uneven on desktop." },
          { code: "shared-spacing", severity: "warning", area: "css", route: "/services", viewport: "mobile", selector: ".shared-card", message: "Shared card spacing is uneven on mobile." }
        ]
      },
      diagnosticSummary: {}
    };
  },
  verify: async () => {
    visualReleaseVerifications += 1;
    return {
      passed: true,
      inspectionHash: `sha256:${"e".repeat(64)}`,
      modelSummary: { routes: ["/", "/services"] },
      diagnosticSummary: {},
      checkpoint: "verified"
    };
  }
});
const selectedInspection = await visualRuntime.execute({
  callId: "inspect-selected",
  name: "inspect_site",
  arguments: { route: null }
});
assert.equal(selectedInspection.diagnosticOutput.ok, true);
assert.equal(selectedInspection.diagnosticOutput.buildPerformed, true);
assert.deepEqual(inspectedTarget, {
  route: "/",
  selector: "section.hero > h1",
  label: "Hero heading"
});
assert.equal(visualBuilds, 1, "Selection inspection did not build dirty source exactly once.");
assert.equal(visualInspections, 1, "Selection inspection did not capture visual evidence exactly once.");
assert.equal(visualMechanicalInspections, 1, "The first visual inspection did not run the all-route mechanical sweep exactly once.");
assert.equal((selectedInspection.diagnosticOutput.advisoryFindings as unknown[]).length, 1, "Repeated route and viewport advisories were not grouped by their shared source.");
assert.deepEqual(
  (selectedInspection.diagnosticOutput.advisoryFindings as Array<Record<string, unknown>>)[0]?.affectedRoutes,
  ["/", "/services"]
);
const cachedSelectedInspection = await visualRuntime.execute({
  callId: "inspect-selected-cached",
  name: "inspect_site",
  arguments: { route: null }
});
assert.equal(cachedSelectedInspection.diagnosticOutput.cached, true);
assert.equal(cachedSelectedInspection.diagnosticOutput.buildPerformed, false);
assert.equal(visualBuilds, 1);
assert.equal(visualInspections, 1);
assert.equal(visualMechanicalInspections, 1);
const secondRouteInspection = await visualRuntime.execute({
  callId: "inspect-second-route",
  name: "inspect_site",
  arguments: { route: "/services" }
});
assert.equal(secondRouteInspection.diagnosticOutput.ok, true);
assert.equal(secondRouteInspection.diagnosticOutput.mechanicalCached, true);
assert.equal(visualBuilds, 1);
assert.equal(visualInspections, 2, "A distinct targeted route did not produce distinct visual evidence.");
assert.equal(visualMechanicalInspections, 1, "A second route inspection repeated the all-route mechanical sweep for an unchanged workspace hash.");
const visualCss = visualRuntime.currentFiles().find((file) => file.path === "src/styles.css")?.content;
assert.equal(typeof visualCss, "string");
await visualRuntime.execute({
  callId: "mutate-before-reinspection",
  name: "edit_file",
  arguments: {
    path: "src/styles.css",
    expectedContentHash: sha256(visualCss as string),
    edits: [{ startLine: 1, endLine: 1, content: "body{color:#123}" }]
  }
});
const mutatedInspection = await visualRuntime.execute({
  callId: "inspect-after-mutation",
  name: "inspect_site",
  arguments: { route: "/services" }
});
assert.equal(mutatedInspection.diagnosticOutput.buildPerformed, true);
assert.equal(mutatedInspection.diagnosticOutput.mechanicalCached, false);
assert.equal(visualBuilds, 2, "A mutated workspace did not invalidate the build cache.");
assert.equal(visualInspections, 3, "A mutated workspace did not invalidate the targeted visual cache.");
assert.equal(visualMechanicalInspections, 2, "A mutated workspace did not invalidate the mechanical inspection cache.");
const cachedInspectionFinish = await visualRuntime.execute({
  callId: "finish-after-cached-inspection",
  name: "finish",
  arguments: { ownerMessage: "Done", focusRoute: "/", changedRoutes: ["/"] }
});
assert.equal(cachedInspectionFinish.diagnosticOutput.ok, true);
assert.equal(cachedInspectionFinish.diagnosticOutput.buildPerformed, false);
assert.equal(visualBuilds, 2, "Finish rebuilt a workspace whose exact hash already had a valid preview build.");
assert.equal(visualMechanicalInspections, 2, "Finish repeated the mechanical sweep for an unchanged workspace hash.");
assert.equal(visualReleaseVerifications, 1, "Finish did not run the exhaustive release verification after a mechanical inspection.");
let initialBuildTarget: { route?: string; selector?: string; label?: string } | undefined;
const initialBuildVisualRuntime = new WorkspaceManagerRuntime<string>({
  kind: "initial_build",
  publicBuildInputId: "input_initial_visual",
  toolchainVersion: "toolchain-test",
  sandboxImageDigest: `sha256:${"a".repeat(64)}`,
  initialSandboxRevision: "sandbox_initial_visual_1",
  initialFiles: [
    { path: "src/site.tsx", content: validSiteSource },
    { path: "src/styles.css", content: "body{}" }
  ],
  selection: {
    route: "/",
    selector: "section.hero > h1",
    label: "Hero heading"
  },
  applyBuild: async () => ({ revision: "sandbox_initial_visual_2", buildDurationMs: 1, previewPath: "/preview" }),
  inspectVisual: async (_files, _sandboxRevision, target) => {
    initialBuildTarget = target;
    return {
      inspectionHash: `sha256:${"f".repeat(64)}`,
      modelSummary: { requestedRoute: target.route, routes: ["/", "/services", "/contact"] },
      diagnosticSummary: {}
    };
  },
  inspect: async () => ({
    passed: true,
    inspectionHash: `sha256:${"d".repeat(64)}`,
    modelSummary: {},
    diagnosticSummary: {},
    checkpoint: "verified"
  })
});
const initialBuildInspection = await initialBuildVisualRuntime.execute({
  callId: "inspect-initial-representative",
  name: "inspect_site",
  arguments: { route: null }
});
assert.equal(initialBuildInspection.diagnosticOutput.ok, true);
assert.deepEqual(initialBuildTarget, {
  route: undefined,
  selector: undefined,
  label: undefined
}, "An initial-build inspection was incorrectly narrowed to the editor's homepage selection.");
const invalidVisualFinish = await visualRuntime.execute({
  callId: "finish-invalid-visual-route",
  name: "finish",
  arguments: { ownerMessage: "Done", focusRoute: "/missing", changedRoutes: ["/missing"] }
});
assert.equal(invalidVisualFinish.diagnosticOutput.error, "finish_route_not_found");
assert.equal(visualBuilds, 2, "Finish performed an expensive rebuild before rejecting an invalid route.");
const routeNormalizationRuntime = new WorkspaceManagerRuntime<string>({
  kind: "edit",
  publicBuildInputId: "input_route_normalization",
  toolchainVersion: "toolchain-test",
  sandboxImageDigest: `sha256:${"a".repeat(64)}`,
  initialSandboxRevision: "sandbox_route_normalization_1",
  initialFiles: [
    { path: "src/site.tsx", content: validSiteSource },
    { path: "src/styles.css", content: "body{}" }
  ],
  applyBuild: async () => ({ revision: "sandbox_route_normalization_2", buildDurationMs: 1, previewPath: "/preview" }),
  inspect: async () => ({
    passed: true,
    inspectionHash: `sha256:${"e".repeat(64)}`,
    modelSummary: { routes: ["/", "/services"] },
    diagnosticSummary: {},
    checkpoint: "verified"
  })
});
const trailingSlashVisualFinish = await routeNormalizationRuntime.execute({
  callId: "finish-normalized-visual-route",
  name: "finish",
  arguments: { ownerMessage: "Done", focusRoute: "/services/", changedRoutes: ["/", "/services/"] }
});
assert.equal(trailingSlashVisualFinish.diagnosticOutput.ok, true);
assert.equal(trailingSlashVisualFinish.completion?.focusRoute, "/services");
assert.deepEqual(trailingSlashVisualFinish.completion?.changedRoutes, ["/", "/services"]);

let releasePlanBuilds = 0;
let releasePlanInspections = 0;
let emittedRoutes = ["/", "/old-services"];
const releasePlanRuntime = new WorkspaceManagerRuntime<string>({
  kind: "initial_build",
  publicBuildInputId: "input_release_plan",
  toolchainVersion: "toolchain-test",
  sandboxImageDigest: `sha256:${"a".repeat(64)}`,
  initialSandboxRevision: "sandbox_release_plan_1",
  initialFiles: [
    { path: "src/site.tsx", content: validSiteSource },
    { path: "src/styles.css", content: "body{}" }
  ],
  releasePlan: {
    routePaths: ["/", "/services"],
    browserRoutePaths: ["/"],
    visualReviewRoutePaths: ["/", "/services"],
    redirects: [{ sourcePath: "/old-services", destinationPath: "/services", reason: "Approved consolidation." }],
    retiredSourcePaths: [{ sourcePath: "/old-author", reason: "Approved retirement." }]
  },
  applyBuild: async () => ({
    revision: `sandbox_release_plan_${++releasePlanBuilds + 1}`,
    buildDurationMs: 1,
    previewPath: "/preview"
  }),
  listBuiltRoutePaths: async () => emittedRoutes,
  inspect: async () => {
    releasePlanInspections += 1;
    return {
      passed: true,
      inspectionHash: `sha256:${"e".repeat(64)}`,
      modelSummary: { routes: emittedRoutes },
      diagnosticSummary: {},
      checkpoint: "verified"
    };
  }
});
const mismatchedRelease = await releasePlanRuntime.execute({
  callId: "finish-release-plan-mismatch",
  name: "finish",
  arguments: { ownerMessage: "Done", focusRoute: "/", changedRoutes: ["/"] }
});
assert.equal(mismatchedRelease.diagnosticOutput.error, "release_plan_route_mismatch");
assert.deepEqual(mismatchedRelease.diagnosticOutput.missingRoutes, ["/services"]);
assert.deepEqual(mismatchedRelease.diagnosticOutput.extraRoutes, ["/old-services"]);
assert.deepEqual(mismatchedRelease.diagnosticOutput.extraRouteRepairs, [{
  sourcePath: "/old-services",
  action: "remove_route_and_repoint_all_internal_links",
  destinationPath: "/services"
}]);
assert.match(String(mismatchedRelease.diagnosticOutput.guidance), /shared navigation, footers, hubs, breadcrumbs, sitemaps, related-content data, and route components/i);
assert.equal(releasePlanInspections, 0, "A route mismatch reached expensive browser verification.");
emittedRoutes = ["/", "/services"];
const plannedRelease = await releasePlanRuntime.execute({
  callId: "finish-release-plan-match",
  name: "finish",
  arguments: { ownerMessage: "Done", focusRoute: "/", changedRoutes: ["/"] }
});
assert.equal(plannedRelease.diagnosticOutput.ok, true);
assert.equal(plannedRelease.diagnosticOutput.releasePlanApplied, true);
assert.deepEqual(plannedRelease.completion?.redirects, [{
  sourcePath: "/old-services",
  destinationPath: "/services",
  reason: "Approved consolidation."
}]);
assert.deepEqual(plannedRelease.completion?.retiredSourcePaths, [{
  sourcePath: "/old-author",
  reason: "Approved retirement."
}]);
assert.equal(releasePlanInspections, 1);

const existingSourceAsset = mediaRef("asset_existing_source", "photo", "source_website");
const sourceAssetInput = buildSyntheticSiteInput();
const buildInputWithExistingSourceAsset = {
  ...sourceAssetInput,
  business: {
    ...sourceAssetInput.business,
    assets: [existingSourceAsset]
  },
  assetRevisionIds: [existingSourceAsset.revisionId]
};
assert.equal(reusableActiveSourceAssetRef({
  buildInput: buildInputWithExistingSourceAsset,
  revisionId: existingSourceAsset.revisionId,
  assetId: existingSourceAsset.assetId,
  contentHash: existingSourceAsset.contentHash as `sha256:${string}`,
  storageKey: existingSourceAsset.storageKey,
  mimeType: existingSourceAsset.mimeType
}), existingSourceAsset, "Repeated source-asset adoption did not reuse the active immutable revision.");
assert.equal(reusableActiveSourceAssetRef({
  buildInput: buildInputWithExistingSourceAsset,
  revisionId: "asset_revision_same_source_bytes",
  assetId: "asset_same_source_bytes",
  contentHash: existingSourceAsset.contentHash as `sha256:${string}`,
  storageKey: "site-assets/business_test/source/asset_revision_same_source_bytes",
  mimeType: existingSourceAsset.mimeType
}), existingSourceAsset, "Same-business source bytes did not reuse the active content-addressed revision.");
assert.throws(() => reusableActiveSourceAssetRef({
  buildInput: buildInputWithExistingSourceAsset,
  revisionId: existingSourceAsset.revisionId,
  assetId: existingSourceAsset.assetId,
  contentHash: `sha256:${"f".repeat(64)}`,
  storageKey: existingSourceAsset.storageKey,
  mimeType: existingSourceAsset.mimeType
}), /source_asset_retained_revision_mismatch/);

assert.throws(() => assetRevisionSchema.parse({
  schemaVersion: 1,
  id: "asset_revision_mismatch",
  assetId: "asset_mismatch",
  businessId: "business_test",
  contentHash: `sha256:${"c".repeat(64)}`,
  storageKey: "site-assets/business_test/mismatch",
  mimeType: "image/webp",
  bytes: 10,
  origin: "owner_upload",
  provenance: {
    origin: "source_website",
    sourceUrl: "https://example.com/image.webp",
    sourcePageUrl: "https://example.com/",
    sourceSnapshotId: "snapshot_test"
  },
  createdAt: "2026-07-23T00:00:00.000Z"
}));

process.stdout.write(`${JSON.stringify({
  ok: true,
  contactSheet: "pass",
  crawlSummaryMediaBounds: "pass",
  imageToolContract: "pass",
  gptImage2Request: "pass",
  generatedAssetInvalidatesBuild: "pass",
  selectionAwareVisualInspection: "pass",
  repeatedSourceAssetAdoption: "pass",
  typedOriginProvenance: "pass"
})}\n`);

function mediaRef(assetId: string, kind: AssetRevisionRef["kind"], origin: AssetRevisionRef["origin"]): AssetRevisionRef {
  return {
    assetId,
    revisionId: `${assetId}_revision`,
    kind,
    contentHash: `sha256:${assetId === "asset_logo" ? "d" : "e"}`.padEnd(71, assetId === "asset_logo" ? "d" : "e"),
    storageKey: `site-assets/business_test/${assetId}`,
    mimeType: "image/webp",
    alt: assetId.replaceAll("_", " "),
    width: 320,
    height: 180,
    origin,
    sourceFactIds: [],
    activeForFutureBuilds: true
  };
}
