import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import sharp, { type SharpOptions, type ResizeOptions, type WebpOptions } from "sharp";
import ts from "typescript";

// Execute the real sheet implementation with a transparent Sharp observer so
// labels are checked before rasterization, and verify final pixels as well.
const svgLabels: string[] = [];
const observedSharp = (...args: Parameters<typeof sharp>) => {
  const instance = sharp(...args);
  const composite = instance.composite.bind(instance);
  instance.composite = (images) => {
    for (const image of images) {
      if (Buffer.isBuffer(image.input) && image.input.toString("utf8", 0, 4) === "<svg") svgLabels.push(image.input.toString("utf8"));
    }
    return composite(images);
  };
  return instance;
};
const sheetSource = await readFile("packages/site-verification/media-contact-sheet.ts", "utf8");
const sheetModule = { exports: {} as Record<string, (...args: any[]) => Promise<Buffer>> };
const sheetCode = ts.transpileModule(sheetSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
new Function("require", "module", "exports", sheetCode)((name: string) => {
  assert.equal(name, "sharp"); return { __esModule: true, default: observedSharp };
}, sheetModule, sheetModule.exports);

const small = await sharp({ create: { width: 40, height: 20, channels: 3, background: "#ff0000" } }).png().toBuffer();
const rotated = await sharp({ create: { width: 60, height: 20, channels: 3, background: "#ff0000" } }).jpeg().withMetadata({ orientation: 6 }).toBuffer();
const large = await sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#ff0000" } }).png().toBuffer();

async function redBounds(sheet: Buffer) {
  const { data, info } = await sharp(sheet).extract({ left: 20, top: 88, width: 360, height: 220 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const points: Array<[number, number]> = [];
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const index = (y * info.width + x) * info.channels;
    if (data[index] > 200 && data[index + 1] < 60 && data[index + 2] < 60) points.push([x, y]);
  }
  assert(points.length);
  const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
  return { width: Math.max(...xs) - Math.min(...xs) + 1, height: Math.max(...ys) - Math.min(...ys) + 1 };
}
const sheet = await sheetModule.exports.createSourceMediaContactSheet([{ resourceId: "resource_small", likelyKind: "photo", bytes: small }]);
assert.deepEqual(await redBounds(sheet), { width: 40, height: 20 }, "Source contact sheet enlarged a small original.");
assert(svgLabels.some(label => label.includes("40×20")), "Source sheet did not label decoded original dimensions.");
svgLabels.length = 0;
const asset = { assetId: "asset_rotated", kind: "photo", width: 999, height: 888, origin: "source_website", alt: "DO_NOT_EXPOSE_ALT" };
const rotatedSheet = await sheetModule.exports.createMediaContactSheet([{ asset, bytes: rotated, sourcePageUrl: "https://private.invalid/context", sourceAssetUrl: "https://private.invalid/hidden.jpg" }], { neutralSemantics: true });
assert.deepEqual(await redBounds(rotatedSheet), { width: 20, height: 60 }, "Managed sheet ignored EXIF orientation or enlarged a small original.");
assert(svgLabels.some(label => label.includes("20×60")), "Managed sheet trusted stale asset dimensions instead of oriented decoded dimensions.");
assert(!svgLabels.some(label => /999×888|DO_NOT_EXPOSE_ALT|private\.invalid|hidden\.jpg/.test(label)), "Neutral sheet exposed stale dimensions or semantic cues.");
assert.deepEqual([asset.width, asset.height], [999, 888], "Sheet generation mutated retained metadata.");
const largeSheet = await sheetModule.exports.createSourceMediaContactSheet([{ resourceId: "resource_large", likelyKind: "photo", bytes: large }]);
assert.deepEqual(await redBounds(largeSheet), { width: 360, height: 180 }, "Large image no longer fits without cropping.");
assert(svgLabels.some(label => label.includes("2000×1000")), "Sheet labeled thumbnail size instead of original size.");

// Actual source-tool method; fake only its repository/blob inputs and ranking.
const workflowSource = await readFile("packages/site-platform/workflow.ts", "utf8");
const file = ts.createSourceFile("workflow.ts", workflowSource, ts.ScriptTarget.Latest, true);
const declaration = file.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "SiteAuthoringWorkflow") as ts.ClassDeclaration;
const method = declaration.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(file) === "executeAuthoringSourceTool");
assert(method);
const code = ts.transpileModule(`class Extracted { ${method.getText(file)} }; return new Extracted();`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const createWorkflow = (sharpImplementation: typeof sharp = sharp) => new Function("sharp", "sourceResourceIsAdoptableImage", "rankSourceAssetCandidates", "asContentHash", code)(sharpImplementation, () => true, ({ resources }: any) => [{ resource: resources[0], sourcePageId: "page_fixture", sourcePageUrl: "https://private.invalid/context", likelyKind: "photo", relevanceScore: 1, relevanceReasons: [] }], (hash: string) => hash);
const workflow = createWorkflow();
const blobs: Record<string, Buffer> = { managed: rotated, source: large, small };
workflow.blobStore = { get: async (key: string) => ({ bytes: blobs[key] }) };
workflow.repository = {
  getSourceSnapshotResource: async (id: string, sourceId: string) => ({ id, sourceSnapshotId: sourceId, storageKey: id === "resource_rotated" ? "managed" : "source", contentType: id === "resource_rotated" ? "image/jpeg" : "image/png", rawContentHash: `sha256:${"1".repeat(64)}`, requestedUrl: "https://private.invalid/image.png" }),
  listSourceSnapshotPages: async () => []
};
const managed = { assetId: "asset_fixture", kind: "photo", mimeType: "image/jpeg", width: 999, height: 888, storageKey: "managed", alt: "DO_NOT_EXPOSE_ALT" };
const result = await workflow.executeAuthoringSourceTool({
  call: { name: "inspect_assets", arguments: { assetIds: [managed.assetId, "resource_fixture", "resource_rotated"] } },
  sourceCatalog: new Map([["source_fixture", {}]]), neutralAssetSemantics: true,
  getBuildInput: () => ({ business: { assets: [managed] } })
});
const previews = result.diagnosticOutput.previews;
assert.deepEqual(previews.map((preview: any) => [preview.width, preview.height]), [[20, 60], [2000, 1000], [20, 60]], "Tool previews do not expose oriented decoded original dimensions for managed and source images.");
assert(previews.every((preview: any) => !["currentAlt", "kind", "sourceUrl", "sourcePageUrl", "storageKey"].some(key => key in preview)), "Neutral preview exposed semantic/private fields.");
const images = result.modelOutput.filter((item: any) => item.type === "input_image");
const previewSizes = await Promise.all(images.map(async (item: any) => {
  const metadata = await sharp(Buffer.from(item.image_url.split(",")[1], "base64")).metadata();
  return [metadata.width, metadata.height];
}));
assert.deepEqual(previewSizes, [[20, 60], [960, 480], [20, 60]], "Preview rotation, no-enlargement or existing 960px bound changed.");
assert.deepEqual([managed.width, managed.height], [999, 888], "Inspection mutated retained metadata.");
assert.deepEqual(result.diagnosticOutput.previewUnavailable, []);

// Exercise the actual selective-preview method, including its model-visible
// summary. Oversized input never reaches a decoder; missing IDs remain distinct.
const oversized = Buffer.alloc(4_000_001);
const fetched: string[] = [];
const fixtureBlobs: Record<string, Buffer> = {
  good: small, oversized, corrupt: Buffer.from("not an image"),
  encoding: small, budget_a: small, budget_b: small
};
function configureInspection(target: any) {
  target.blobStore = { get: async (key: string) => {
    fetched.push(key);
    if (key === "missing") throw new Error("DO_NOT_EXPOSE_STORAGE_ERROR");
    return fixtureBlobs[key] ? { bytes: fixtureBlobs[key] } : undefined;
  } };
  target.repository = {
    getSourceSnapshotResource: async (id: string, sourceId: string) => id === "unknown" ? undefined : ({
      id, sourceSnapshotId: sourceId, storageKey: id === "source_large" ? "oversized" : "good",
      contentType: "image/png", rawContentHash: `sha256:${"1".repeat(64)}`,
      requestedUrl: "https://private.invalid/image.png"
    }),
    listSourceSnapshotPages: async () => []
  };
}
const managedFixture = (id: string, key: string) => ({ ...managed, assetId: id, storageKey: key });
async function inspect(target: any, ids: string[], assets: ReturnType<typeof managedFixture>[]) {
  const output = await target.executeAuthoringSourceTool({
    call: { name: "inspect_assets", arguments: { assetIds: ids } },
    sourceCatalog: new Map([["source_fixture", {}]]), neutralAssetSemantics: true,
    getBuildInput: () => ({ business: { assets } })
  });
  const summary = JSON.parse(typeof output.modelOutput === "string" ? output.modelOutput : output.modelOutput[0].text);
  assert.deepEqual(summary, JSON.parse(JSON.stringify(output.diagnosticOutput)), "Model and diagnostic preview summaries disagree.");
  for (const item of summary.previewUnavailable) assert.deepEqual(Object.keys(item).sort(), ["id", "reason", "type"]);
  assert.doesNotMatch(JSON.stringify(summary), /DO_NOT_EXPOSE|private\.invalid|storageKey/);
  return { summary, output };
}
const unavailableWorkflow = createWorkflow();
configureInspection(unavailableWorkflow);
const mixed = await inspect(unavailableWorkflow, ["large_managed", "good_managed", "source_large", "missing_managed", "source_fifth"], [
  managedFixture("large_managed", "oversized"), managedFixture("good_managed", "good"), managedFixture("missing_managed", "missing")
]);
assert.equal(mixed.summary.ok, true, "Preview failure changed ID-resolution success semantics.");
assert.deepEqual(mixed.summary.missingAssetIds, []);
assert.deepEqual(mixed.summary.previewUnavailable, [
  { id: "large_managed", type: "managed_asset", reason: "original_byte_limit" },
  { id: "source_large", type: "source_resource", reason: "original_byte_limit" },
  { id: "missing_managed", type: "managed_asset", reason: "blob_unavailable" },
  { id: "source_fifth", type: "source_resource", reason: "request_preview_limit" }
]);
assert.deepEqual(fetched, ["oversized", "good", "oversized", "missing"], "Skipped previews changed the first-four attempt limit or order.");
assert.equal(mixed.summary.previewCount, 1);
assert.equal(mixed.summary.previews[0].id, "good_managed");
assert.equal(mixed.output.modelOutput[1].text, `Asset preview 1: ${JSON.stringify(mixed.summary.previews[0])}`);
assert.equal(mixed.output.modelOutput[2].type, "input_image");
const corrupt = await inspect(unavailableWorkflow, ["bad", "unknown"], [managedFixture("bad", "corrupt")]);
assert.equal(corrupt.summary.ok, false);
assert.deepEqual(corrupt.summary.missingAssetIds, ["unknown"]);
assert.deepEqual(corrupt.summary.previewUnavailable, [{ id: "bad", type: "managed_asset", reason: "decode_unavailable" }]);
assert.equal(typeof corrupt.output.modelOutput, "string");

// Control encoder outcomes without allocating huge decoded fixtures. The real
// method still owns the aggregate budget, outcome labels and image pairing.
let encoded = 0;
const controlledSharp = ((_bytes: Buffer, options: SharpOptions) => {
  assert.deepEqual(options, { limitInputPixels: 80_000_000, animated: false });
  const instance = {
    metadata: async () => ({ autoOrient: { width: 40, height: 20 } }),
    rotate: () => instance,
    resize: (options: ResizeOptions) => { assert.deepEqual(options, { width: 960, height: 960, fit: "inside", withoutEnlargement: true }); return instance; },
    webp: (options: WebpOptions) => { assert.deepEqual(options, { quality: 82, effort: 4 }); return instance; },
    toBuffer: async () => { if (++encoded === 1) throw new Error("DO_NOT_EXPOSE_ENCODER_ERROR"); return Buffer.alloc(1_300_000); }
  };
  return instance;
}) as unknown as typeof sharp;
const controlledWorkflow = createWorkflow(controlledSharp);
configureInspection(controlledWorkflow);
const controlled = await inspect(controlledWorkflow, ["encoding", "budget_a", "budget_b"], [
  managedFixture("encoding", "encoding"), managedFixture("budget_a", "budget_a"), managedFixture("budget_b", "budget_b")
]);
assert.equal(controlled.summary.ok, true);
assert.deepEqual(controlled.summary.previewUnavailable, [
  { id: "encoding", type: "managed_asset", reason: "preview_encoding_failed" },
  { id: "budget_b", type: "managed_asset", reason: "preview_byte_budget" }
]);
assert.equal(controlled.summary.previewCount, 1);
assert.equal(controlled.summary.previews[0].id, "budget_a");
console.log("Media previews verified: oriented originals, no enlargement, neutral semantics, unchanged bounds, explicit selective unavailability and identical model/diagnostic summaries.");
