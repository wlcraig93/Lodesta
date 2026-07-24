import assert from "node:assert/strict";
import sharp from "sharp";
import { summarizeCrawlHtml } from "../lib/crawler";
import { createImageBytes, managerToolArguments } from "../packages/site-agent";
import { assetRevisionSchema, type AssetRevisionRef } from "../packages/site-contracts";
import { WorkspaceManagerRuntime } from "../packages/site-platform/manager-runtime";
import { createMediaContactSheet } from "../packages/site-verification";

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
    { path: "src/site.tsx", content: "export const siteDefinition = {};" },
    { path: "src/styles.css", content: "body{}" }
  ],
  applyBuild: async () => ({ revision: `sandbox_${++builds + 1}`, buildDurationMs: 1, previewPath: "/preview" }),
  inspect: async () => ({
    passed: true,
    inspectionHash: `sha256:${"b".repeat(64)}`,
    modelSummary: {},
    diagnosticSummary: {},
    checkpoint: "verified"
  }),
  createImage: async () => ({
    modelOutput: JSON.stringify({ ok: true, assetId: "asset_generated" }),
    diagnosticOutput: { ok: true, assetId: "asset_generated" }
  })
});
await runtime.execute({ callId: "build", name: "build_preview", arguments: {} });
await runtime.execute({ callId: "image", name: "create_image", arguments: {} });
const staleFinish = await runtime.execute({ callId: "finish", name: "finish", arguments: { ownerMessage: "Done" } });
assert.equal(staleFinish.diagnosticOutput.ok, false);
assert.equal(staleFinish.diagnosticOutput.error, "finish_requires_current_successful_build");

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
  sourceSiteMediaCap: "pass",
  imageToolContract: "pass",
  gptImage2Request: "pass",
  generatedAssetInvalidatesBuild: "pass",
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
