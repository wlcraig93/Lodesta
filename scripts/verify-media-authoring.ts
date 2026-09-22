import assert from "node:assert/strict";
import sharp from "sharp";
import { summarizeCrawlHtml } from "../lib/crawler";
import { sha256 } from "../packages/business-data";
import { createImageBytes, imageCreationModel, managerToolArguments, websiteManagerTools } from "../packages/site-agent";
import { assetRevisionSchema, type AssetRevisionRef } from "../packages/site-contracts";
import { WorkspaceManagerRuntime } from "../packages/site-platform/manager-runtime";
import { reusableActiveSourceAssetIdentityRef, reusableActiveSourceAssetRef } from "../packages/site-platform/workflow";
import { prepareSourcePhoto, sourcePhotoWebRecipeVersion } from "../packages/site-platform/source-photo-preparation";
import { createMediaContactSheet } from "../packages/site-verification";
import { buildSyntheticSiteInput } from "./support/synthetic-site-input";

const validSiteSource = 'export const siteDefinition = { routes: [{ path: "/", element: <main><h1>Home</h1></main> }] };';

const largeSourcePhoto = await sharp({
  create: { width: 3_000, height: 2_000, channels: 3, background: "#8b4134" }
}).jpeg({ quality: 92 }).toBuffer();
const retainedLargeSourcePhoto = Buffer.from(largeSourcePhoto);
const largePreparedPhoto = await prepareSourcePhoto({
  bytes: largeSourcePhoto, mimeType: "image/jpeg", sourceContentHash: sha256(largeSourcePhoto)
});
assert.equal(largePreparedPhoto.changed, true);
assert.equal(largePreparedPhoto.mimeType, "image/webp");
assert.equal(Math.max(largePreparedPhoto.width, largePreparedPhoto.height), 2_560);
assert(largePreparedPhoto.bytes.length < largeSourcePhoto.length);
assert.deepEqual(largePreparedPhoto.preparation?.operations, ["resize_inside", "encode_webp"]);
assert.equal(largePreparedPhoto.preparation?.recipeVersion, sourcePhotoWebRecipeVersion);
assert.deepEqual(largeSourcePhoto, retainedLargeSourcePhoto, "Preparation mutated the retained source bytes.");

const efficientPixels = Buffer.alloc(320 * 200 * 3);
for (let index = 0; index < efficientPixels.length; index++) efficientPixels[index] = (index * 31) % 256;
const efficientSmallPhoto = await sharp(efficientPixels, { raw: { width: 320, height: 200, channels: 3 } })
  .jpeg({ quality: 20 }).toBuffer();
const unchangedSmallPhoto = await prepareSourcePhoto({
  bytes: efficientSmallPhoto, mimeType: "image/jpeg", sourceContentHash: sha256(efficientSmallPhoto)
});
assert.equal(unchangedSmallPhoto.changed, false, "An efficient small source photo grew into a delivery derivative.");
assert.equal(unchangedSmallPhoto.bytes, efficientSmallPhoto);
assert.equal(unchangedSmallPhoto.contentHash, sha256(efficientSmallPhoto));
assert.equal(unchangedSmallPhoto.preparation, undefined);
await assert.rejects(() => prepareSourcePhoto({
  bytes: efficientSmallPhoto, mimeType: "image/png", sourceContentHash: sha256(efficientSmallPhoto)
}), /source_photo_mime_mismatch/);

const animatedWebpFrames = await Promise.all(["#8b4134", "#304b62"].map(background =>
  sharp({ create: { width: 16, height: 16, channels: 3, background } }).png().toBuffer()));
const animatedWebp = await sharp(animatedWebpFrames, { join: { animated: true } })
  .webp({ loop: 0, delay: [100, 100] }).toBuffer();
await assert.rejects(() => prepareSourcePhoto({
  bytes: animatedWebp, mimeType: "image/webp", sourceContentHash: sha256(animatedWebp)
}), /source_photo_animation_unsupported/);
const unsupportedTiff = await sharp({ create: { width: 16, height: 16, channels: 3, background: "#315a46" } })
  .tiff().toBuffer();
await assert.rejects(() => prepareSourcePhoto({
  bytes: unsupportedTiff, mimeType: "image/png", sourceContentHash: sha256(unsupportedTiff)
}), /source_photo_decode_format_unsupported/);

const orientedPhoto = await sharp({ create: { width: 40, height: 80, channels: 3, background: "#304b62" } })
  .jpeg().withMetadata({ orientation: 6 }).toBuffer();
const orientedPrepared = await prepareSourcePhoto({
  bytes: orientedPhoto, mimeType: "image/jpeg", sourceContentHash: sha256(orientedPhoto)
});
assert.equal(orientedPrepared.changed, true);
assert.deepEqual([orientedPrepared.width, orientedPrepared.height], [80, 40]);
assert(orientedPrepared.preparation?.operations.includes("auto_orient"));
await assert.rejects(() => prepareSourcePhoto({
  bytes: Buffer.from("not an image"), mimeType: "image/jpeg", sourceContentHash: sha256("not an image")
}), /source_photo_decode_failed/);
await assert.rejects(() => prepareSourcePhoto({
  bytes: orientedPhoto, mimeType: "image/jpeg", sourceContentHash: `sha256:${"0".repeat(64)}`
}), /source_photo_content_hash_mismatch/);
const oversizedPhoto = await sharp({
  create: { width: 9_000, height: 9_000, channels: 3, background: "#444444" }
}).png({ compressionLevel: 9 }).toBuffer();
await assert.rejects(() => prepareSourcePhoto({
  bytes: oversizedPhoto, mimeType: "image/png", sourceContentHash: sha256(oversizedPhoto)
}), /source_photo_pixel_limit_exceeded/);
const truncatedPhoto = largeSourcePhoto.subarray(0, Math.floor(largeSourcePhoto.length / 2));
await assert.rejects(() => prepareSourcePhoto({
  bytes: truncatedPhoto, mimeType: "image/jpeg", sourceContentHash: sha256(truncatedPhoto)
}), /source_photo_(decode|preparation)_failed/);

const strictPreparedPhotoRevision = {
  schemaVersion: 1, id: "asset_revision_prepared_photo", assetId: "asset_prepared_photo", businessId: "business_test",
  contentHash: sha256("prepared-photo"), storageKey: "site-assets/business_test/prepared-photo",
  mimeType: "image/webp", bytes: 1_024, width: 2_560, height: 1_706, origin: "source_website",
  provenance: { origin: "source_website", sourceUrl: "https://example.com/photo.jpg",
    sourcePageUrl: "https://example.com/", sourceSnapshotId: "snapshot_test", sourceResourceId: "resource_photo",
    preparation: { processor: "sharp", recipe: "source-photo-web", recipeVersion: 1,
      sourceContentHash: sha256("source-photo"), sourceMimeType: "image/jpeg", sourceWidth: 3_000,
      sourceHeight: 2_000, maxEdge: 2_560, outputFormat: "webp", quality: 90, effort: 4,
      operations: ["resize_inside", "encode_webp"] } }, createdAt: "2026-09-17T00:00:00.000Z"
} as const;
assert.doesNotThrow(() => assetRevisionSchema.parse(strictPreparedPhotoRevision));
const strictPhotoPreparation = strictPreparedPhotoRevision.provenance.preparation;
for (const invalidPreparation of [
  { ...strictPhotoPreparation, recipe: "unknown-photo-recipe" },
  { ...strictPhotoPreparation, recipeVersion: 2 },
  { ...strictPhotoPreparation, maxEdge: 2_048 },
  { ...strictPhotoPreparation, unrecognizedSetting: true }
]) {
  assert.throws(() => assetRevisionSchema.parse({
    ...strictPreparedPhotoRevision,
    provenance: { ...strictPreparedPhotoRevision.provenance, preparation: invalidPreparation }
  }));
}
assert.throws(() => assetRevisionSchema.parse({
  ...strictPreparedPhotoRevision,
  provenance: { ...strictPreparedPhotoRevision.provenance, unrecognizedProvenanceField: true }
}));

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
assert.throws(() => managerToolArguments.create_image.parse({
  action: "generate",
  purpose: "logo",
  prompt: "A business logo.",
  sourceAssetIds: [],
  size: "1024x1024",
  alt: "Business logo"
}), "New generated images must not claim a logo purpose.");
assert.equal(imageCreationModel.id, "gpt-image-2.5-flare");
const imageTool = websiteManagerTools.find((tool): tool is Extract<typeof tool, { type: "function" }> => tool.type === "function" && tool.name === "create_image");
if (!imageTool || typeof imageTool.description !== "string") throw new Error("The create_image tool was not registered.");
assert.match(imageTool.description, new RegExp(imageCreationModel.label));
assert.equal((((imageTool.parameters as { properties: { purpose: { enum: readonly string[] } } }).properties.purpose.enum)).includes("logo"), false);

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
assert.equal(generatedRequest?.model, imageCreationModel.id);
assert.equal(generatedRequest?.quality, "high");
assert.equal(generatedRequest?.output_format, "webp");
assert.equal(generatedRequest?.moderation, "auto");
assert.equal(generated.width, 1024);
assert.equal(generated.usage.costSource, "catalog_estimate");
assert.equal(generated.usage.costUsd, 0.2106);

const generatedAssetBase = {
  schemaVersion: 1,
  id: "asset_revision_generated",
  assetId: "asset_generated",
  businessId: "business_test",
  contentHash: `sha256:${"a".repeat(64)}`,
  storageKey: "site-assets/business_test/generated.webp",
  mimeType: "image/webp",
  bytes: generatedWebp.length,
  width: 1024,
  height: 1024,
  origin: "platform_generated" as const,
  provenance: {
    origin: "platform_generated" as const,
    provider: "openai" as const,
    model: imageCreationModel.id,
    action: "generate" as const,
    purpose: "background" as const,
    prompt: "A subtle, text-free background texture.",
    sourceAssetRevisionIds: []
  },
  createdAt: "2026-09-10T00:00:00.000Z"
};
assert.doesNotThrow(() => assetRevisionSchema.parse(generatedAssetBase));
assert.doesNotThrow(() => assetRevisionSchema.parse({
  ...generatedAssetBase,
  id: "asset_revision_historical_image2",
  provenance: { ...generatedAssetBase.provenance, model: "gpt-image-2" }
}), "Historical GPT Image 2 provenance must remain readable.");
assert.doesNotThrow(() => assetRevisionSchema.parse({
  ...generatedAssetBase,
  id: "asset_revision_historical_image2_logo",
  provenance: { ...generatedAssetBase.provenance, model: "gpt-image-2", purpose: "logo" }
}), "Historical generated-logo provenance must remain readable.");
assert.throws(() => assetRevisionSchema.parse({
  ...generatedAssetBase,
  id: "asset_revision_unselected_image_model",
  provenance: { ...generatedAssetBase.provenance, model: "gpt-image-2.5-sunburst" }
}), "Generated provenance must reject unselected image models.");

let editedRequest: Record<string, unknown> | undefined;
const edited = await createImageBytes({
  action: "edit",
  purpose: "gallery",
  prompt: "Retain the scene while improving the crop.",
  sourceAssetIds: ["asset_source"],
  size: "1024x1024",
  alt: "Improved gallery image"
}, [{
  revisionId: "asset_revision_source",
  mimeType: "image/webp",
  bytes: generatedWebp
}], {
  client: {
    images: {
      edit: async (request: Record<string, unknown>) => {
        editedRequest = request;
        return {
          data: [{ b64_json: generatedWebp.toString("base64") }],
          usage: {
            input_tokens: 620,
            input_tokens_details: { text_tokens: 120, image_tokens: 500 },
            output_tokens: 7_000,
            total_tokens: 7_620
          }
        };
      }
    }
  } as never
});
assert.equal(editedRequest?.model, imageCreationModel.id);
assert.equal(editedRequest?.quality, "high");
assert.equal(editedRequest?.output_format, "webp");
assert.equal(Object.hasOwn(editedRequest ?? {}, "input_fidelity"), false, "Image edits must omit unsupported input_fidelity.");
assert.equal((editedRequest?.image as unknown[])?.length, 1);
assert.deepEqual(edited.sourceAssetRevisionIds, ["asset_revision_source"]);
assert.equal(edited.usage.costSource, "catalog_estimate");

let builds = 0;
let runtimeImageCreatorCalls = 0;
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
  createImage: async () => {
    runtimeImageCreatorCalls += 1;
    return {
      modelOutput: JSON.stringify({ ok: true, assetId: "asset_generated" }),
      diagnosticOutput: { ok: true, assetId: "asset_generated" }
    };
  }
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
await assert.rejects(() => runtime.execute({
  callId: "image-logo",
  name: "create_image",
  arguments: { action: "generate", purpose: "logo", prompt: "A business logo.", sourceAssetIds: [], size: "1024x1024", alt: "Business logo" }
}));
assert.equal(runtimeImageCreatorCalls, 0, "An invalid logo-purpose call reached the image handler.");
await runtime.execute({
  callId: "image",
  name: "create_image",
  arguments: { action: "generate", purpose: "background", prompt: "A restrained, text-free background.", sourceAssetIds: [], size: "1024x1024", alt: "Abstract background" }
});
assert.equal(runtimeImageCreatorCalls, 1);
assert.throws(() => managerToolArguments.finish.parse({
  ownerMessage: "Done",
  redirects: [{ sourcePath: "/?p=8024", destinationPath: "/", reason: "Invalid query route." }]
}), /unrecognized key/i, "The model-facing finish contract still accepted release-ledger authority.");
const rebuiltFinish = await runtime.execute({ callId: "finish", name: "finish", arguments: { ownerMessage: "Done" } });
assert.equal(rebuiltFinish.diagnosticOutput.ok, true, JSON.stringify(rebuiltFinish.diagnosticOutput));
assert.equal(rebuiltFinish.diagnosticOutput.buildPerformed, true);
assert.equal(builds, 2, "Finish did not rebuild after generated media changed the workspace.");
const cachedBuild = await runtime.execute({ callId: "build-cached", name: "build_preview", arguments: {} });
assert.equal(cachedBuild.diagnosticOutput.cached, true);
const freshPlacementFinish = await runtime.execute({ callId: "finish-fresh-placement", name: "finish", arguments: { ownerMessage: "Done" } });
assert.equal(freshPlacementFinish.diagnosticOutput.ok, true);
assert.equal(freshPlacementFinish.diagnosticOutput.buildPerformed, false);
assert.equal(builds, 2, "Finish rebuilt a workspace that already had a successful build for the same source hash.");

let visualBuilds = 0;
let visualInspections = 0;
let visualMechanicalInspections = 0;
let visualReleaseVerifications = 0;
let inspectedTarget: { route?: string; selector?: string; label?: string; authorScreenshot?: "none" | "desktop-top" | "focus" } | undefined;
const visualRuntime = new WorkspaceManagerRuntime<string>({
  kind: "edit",
  visualInspectionFeedback: "component-diagnostic-route-family-quality-led",
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
    const images = target.authorScreenshot === "none"
      ? undefined
      : [
          { type: "input_image" as const, image_url: "data:image/png;base64,AA==", detail: "high" as const },
          ...(target.authorScreenshot === "desktop-top"
            ? []
            : [{ type: "input_image" as const, image_url: "data:image/png;base64,AQ==", detail: "high" as const }])
        ];
    return {
      inspectionHash: `sha256:${"c".repeat(64)}`,
      modelSummary: {
        requestedRoute: target.route,
        requestedSelector: target.selector,
        selectionLabel: target.label,
        authorScreenshot: target.authorScreenshot,
        routes: ["/", "/services"],
        visualEvidenceRoutes: images?.length ? ["/"] : [],
        visualEvidenceFrames: images?.length
          ? [
              {
                imageIndex: 1,
                route: "/",
                viewport: target.authorScreenshot === "focus" ? "desktop" : "desktop",
                frame: target.authorScreenshot === "focus" ? "focus" : "top",
                width: 1280,
                height: 900
              }
            ]
          : []
      },
      diagnosticSummary: {},
      images
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
assert.equal(typeof selectedInspection.modelOutput, "string", "route null must return measured text without screenshots.");
const nativeSummary = JSON.parse(String(selectedInspection.modelOutput));
assert.match(nativeSummary.feedbackGuidance, /Finish\. Do not inspect more routes to review composition, copy, photo choice, or advisories that were not returned/);
assert.match(nativeSummary.feedbackGuidance, /Full release verification still runs at finish/);
assert.doesNotMatch(nativeSummary.feedbackGuidance, /whole-site approval|Compare the inspected routes/);
assert.deepEqual(nativeSummary.findings ?? [], []);
assert.deepEqual(nativeSummary.visualEvidenceFrames, []);
assert.equal(selectedInspection.diagnosticOutput.buildPerformed, true);
assert.deepEqual(inspectedTarget, {
  route: "/",
  selector: undefined,
  label: "Hero heading",
  authorScreenshot: "none"
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
  arguments: { ownerMessage: "Done" }
});
assert.equal(cachedInspectionFinish.diagnosticOutput.ok, true);
assert.equal(cachedInspectionFinish.diagnosticOutput.buildPerformed, false);
assert.equal(visualBuilds, 2, "Finish rebuilt a workspace whose exact hash already had a valid preview build.");
assert.equal(visualMechanicalInspections, 2, "Finish repeated the mechanical sweep for an unchanged workspace hash.");
assert.equal(visualReleaseVerifications, 1, "Finish did not run the exhaustive release verification after a mechanical inspection.");
let initialBuildTarget: { route?: string; selector?: string; label?: string; authorScreenshot?: "none" | "desktop-top" | "focus" } | undefined;
let initialVisualCalls = 0;
let initialBuildCalls = 0;
let initialMechanicalCalls = 0;
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
  applyBuild: async () => {
    initialBuildCalls += 1;
    return { revision: "sandbox_initial_visual_2", buildDurationMs: 1, previewPath: "/preview" };
  },
  inspectVisual: async (_files, _sandboxRevision, target) => {
    initialVisualCalls += 1;
    initialBuildTarget = target;
    return {
      inspectionHash: `sha256:${"f".repeat(64)}`,
      modelSummary: {
        requestedRoute: target.route,
        requestedSelector: target.selector,
        authorScreenshot: target.authorScreenshot,
        routes: ["/", "/services", "/contact"]
      },
      diagnosticSummary: {}
    };
  },
  inspect: async () => {
    initialMechanicalCalls += 1;
    return {
      passed: true,
      inspectionHash: `sha256:${"d".repeat(64)}`,
      modelSummary: {},
      diagnosticSummary: {},
      checkpoint: "verified"
    };
  }
});
const missingFocusRoute = await initialBuildVisualRuntime.execute({
  callId: "inspect-selector-without-route", name: "inspect_site", arguments: { route: null, selector: "form" }
});
assert.equal(missingFocusRoute.diagnosticOutput.error, "inspection_selector_requires_route");
assert.equal(missingFocusRoute.diagnosticOutput.ok, false);
assert.equal(initialBuildCalls, 0, "An ambiguous focus target triggered a build.");
assert.equal(initialVisualCalls, 0);
assert.equal(initialMechanicalCalls, 0);
const initialBuildInspection = await initialBuildVisualRuntime.execute({
  callId: "inspect-initial-representative",
  name: "inspect_site",
  arguments: { route: null }
});
assert.equal(initialBuildInspection.diagnosticOutput.ok, true);
assert.deepEqual(initialBuildTarget, {
  route: undefined,
  selector: undefined,
  label: undefined,
  authorScreenshot: "none"
}, "An initial-build inspection was incorrectly narrowed to the editor's homepage selection.");
const initialFilesBeforeFocus = initialBuildVisualRuntime.currentFiles();
const focusCall = { callId: "inspect-author-form", name: "inspect_site" as const, arguments: { route: "/contact", selector: "form" } };
const authorFocus = await initialBuildVisualRuntime.execute(focusCall);
assert.equal(authorFocus.diagnosticOutput.ok, true);
assert.deepEqual(initialBuildTarget, { route: "/contact", selector: "form", label: undefined, authorScreenshot: "focus" });
assert.equal(initialVisualCalls, 2);
const cachedAuthorFocus = await initialBuildVisualRuntime.execute({ ...focusCall, callId: "inspect-author-form-cached" });
assert.equal(cachedAuthorFocus.diagnosticOutput.cached, true);
assert.equal(initialVisualCalls, 2);
await initialBuildVisualRuntime.execute({ ...focusCall, callId: "inspect-author-submit", arguments: { route: "/contact", selector: "form button" } });
assert.equal(initialVisualCalls, 3, "Changing the focus selector reused stale visual evidence.");
await initialBuildVisualRuntime.execute({ ...focusCall, callId: "inspect-author-route", arguments: { route: "/contact", selector: null } });
assert.equal(initialVisualCalls, 4, "A focused capture was reused as whole-route evidence.");
assert.deepEqual(initialBuildTarget, { route: "/contact", selector: undefined, label: undefined, authorScreenshot: "desktop-top" });
assert.equal(initialBuildCalls, 1, "Changing only the focus target rebuilt unchanged source.");
assert.equal(initialMechanicalCalls, 1, "Changing only the focus target repeated the mechanical pass.");
assert.deepEqual(initialBuildVisualRuntime.currentFiles(), initialFilesBeforeFocus);
assert.throws(() => managerToolArguments.inspect_site.parse({ route: "/contact", selector: "  " }));
assert.throws(() => managerToolArguments.inspect_site.parse({ route: "/contact", selector: "x".repeat(501) }));
await visualRuntime.execute({ callId: "inspect-override-owner-selection", name: "inspect_site", arguments: { route: "/", selector: "form" } });
assert.deepEqual(inspectedTarget, { route: "/", selector: "form", label: undefined, authorScreenshot: "focus" }, "An explicit focus target inherited the unrelated owner selection label.");
await visualRuntime.execute({ callId: "inspect-return-owner-selection", name: "inspect_site", arguments: { route: null, selector: null } });
assert.deepEqual(inspectedTarget, { route: "/", selector: undefined, label: "Hero heading", authorScreenshot: "none" });
const beforeSameSelectorOverride = visualInspections;
const sameSelectorOverride = await visualRuntime.execute({ callId: "inspect-same-owner-selector-explicit", name: "inspect_site", arguments: { route: "/", selector: "section.hero > h1" } });
assert.equal(sameSelectorOverride.diagnosticOutput.cached, false);
assert.equal(visualInspections, beforeSameSelectorOverride + 1);
assert.deepEqual(inspectedTarget, { route: "/", selector: "section.hero > h1", label: undefined, authorScreenshot: "focus" });
await visualRuntime.execute({ callId: "inspect-same-selector-owner-again", name: "inspect_site", arguments: { route: null, selector: null } });
assert.equal(visualInspections, beforeSameSelectorOverride + 2);
assert.deepEqual(inspectedTarget, { route: "/", selector: undefined, label: "Hero heading", authorScreenshot: "none" });
const routeDesktopTop = await visualRuntime.execute({ callId: "inspect-route-desktop-top", name: "inspect_site", arguments: { route: "/", selector: null } });
assert.equal(typeof routeDesktopTop.modelOutput === "object" && Array.isArray(routeDesktopTop.modelOutput), true);
assert.deepEqual(inspectedTarget, { route: "/", selector: undefined, label: undefined, authorScreenshot: "desktop-top" });
const routeDesktopOutput = routeDesktopTop.modelOutput as Array<Record<string, unknown>>;
assert.deepEqual(routeDesktopOutput.slice(1).map((item) => item.image_url), ["data:image/png;base64,AA=="]);
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
  selection: {
    route: "/services/",
    selector: "main",
    label: "Services"
  },
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
  arguments: { ownerMessage: "Done" }
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
  arguments: { ownerMessage: "Done" }
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
  arguments: { ownerMessage: "Done" }
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
assert.equal(reusableActiveSourceAssetIdentityRef({ buildInput: buildInputWithExistingSourceAsset,
  assetId: existingSourceAsset.assetId, kind: "photo" }), existingSourceAsset,
  "An already-active legacy source photo was not reused before future-only preparation.");
assert.throws(() => reusableActiveSourceAssetIdentityRef({
  buildInput: { ...buildInputWithExistingSourceAsset, business: { ...buildInputWithExistingSourceAsset.business,
    assets: [{ ...existingSourceAsset, origin: "owner_upload" }] } },
  assetId: existingSourceAsset.assetId, kind: "photo"
}), /source_asset_active_identity_mismatch/);
assert.throws(() => reusableActiveSourceAssetIdentityRef({
  buildInput: { ...buildInputWithExistingSourceAsset, business: { ...buildInputWithExistingSourceAsset.business,
    assets: [existingSourceAsset, { ...existingSourceAsset, revisionId: "asset_revision_duplicate" }] } },
  assetId: existingSourceAsset.assetId, kind: "photo"
}), /source_asset_active_identity_conflict/);
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
  imageModelRequest: "pass",
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
