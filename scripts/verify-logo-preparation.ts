import assert from "node:assert/strict";
import sharp from "sharp";
import { sha256 } from "../packages/business-data";
import { prepareLogoPresentation } from "../packages/site-platform/logo-preparation";
import {
  canonicalSourceLogoAssetId,
  canonicalSourceLogoRevisionId,
  materializeCanonicalSourceLogo,
  materializeSourceLogo,
  sourceLogoPreparedRevisionId
} from "../packages/site-platform/source-logo-materialization";
import { sourceSnapshotPageSchema, sourceSnapshotResourceSchema, sourceSnapshotSchema } from "../packages/site-contracts";

const transparentPadded = await sharp({
  create: { width: 240, height: 160, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
}).composite([{
  input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160"><rect x="60" y="55" width="120" height="50" fill="#256343"/></svg>')
}]).png().toBuffer();
const transparentPrepared = await prepareLogoPresentation({ bytes: transparentPadded, mimeType: "image/png" });
assert.equal(transparentPrepared.status, "prepared");
if (transparentPrepared.status !== "prepared") throw new Error("Transparent logo preparation failed.");
assert.equal(transparentPrepared.changed, true);
assert(transparentPrepared.operations.includes("trim_transparent_canvas"));
assert(!transparentPrepared.operations.includes("remove_uniform_background"));
assert(transparentPrepared.width < 180 && transparentPrepared.height < 100);

const whitePadded = await sharp({
  create: { width: 300, height: 300, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } }
}).composite([{
  input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><path fill="#2f634b" fill-rule="evenodd" d="M70 100h160v100H70zm55 30v40h50v-40z"/></svg>')
}]).png().toBuffer();
const whitePrepared = await prepareLogoPresentation({ bytes: whitePadded, mimeType: "image/png" });
assert.equal(whitePrepared.status, "prepared");
if (whitePrepared.status !== "prepared") throw new Error("White logo preparation failed.");
assert.equal(whitePrepared.changed, true);
assert(whitePrepared.operations.includes("remove_uniform_background"));
assert(whitePrepared.operations.includes("trim_transparent_canvas"));
assert.equal(whitePrepared.backgroundColor, "#ffffff");
assert(whitePrepared.width < 220 && whitePrepared.height < 150);
const whiteOutput = await sharp(whitePrepared.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
assert(whiteOutput.data.some((_value, index) => index % 4 === 3 && whiteOutput.data[index] === 0));
assert(whiteOutput.data.some((_value, index) => index % 4 === 3 && whiteOutput.data[index] === 255));
const outputCenterAlpha = whiteOutput.data[((Math.floor(whiteOutput.info.height / 2) * whiteOutput.info.width + Math.floor(whiteOutput.info.width / 2)) * 4) + 3];
assert.equal(outputCenterAlpha, 0, "An enclosed area of the verified uniform matte remained opaque.");

const intentionalColoredTile = await sharp({
  create: { width: 200, height: 200, channels: 4, background: { r: 36, g: 99, b: 75, alpha: 1 } }
}).composite([{
  input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><circle cx="100" cy="100" r="42" fill="#fff"/></svg>')
}]).png().toBuffer();
const coloredPrepared = await prepareLogoPresentation({ bytes: intentionalColoredTile, mimeType: "image/png" });
assert.equal(coloredPrepared.status, "prepared");
if (coloredPrepared.status !== "prepared") throw new Error("Colored logo preparation failed.");
assert.equal(coloredPrepared.changed, false);
assert.deepEqual(coloredPrepared.operations, []);
assert.equal(coloredPrepared.bytes.equals(intentionalColoredTile), true);

const antialiasedWhiteTile = await sharp({
  create: { width: 300, height: 300, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } }
}).composite([{
  input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300"><circle cx="150" cy="150" r="58.5" fill="#2f634b"/></svg>')
}]).png().toBuffer();
const antialiasedRaw = await sharp(antialiasedWhiteTile).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
antialiasedRaw.data[3] = 249;
const antialiasedInput = await sharp(antialiasedRaw.data, { raw: antialiasedRaw.info }).png().toBuffer();
const antialiasedPrepared = await prepareLogoPresentation({ bytes: antialiasedInput, mimeType: "image/png" });
assert.equal(antialiasedPrepared.status, "prepared");
if (antialiasedPrepared.status !== "prepared") throw new Error("Antialiased logo preparation failed.");
assert(antialiasedPrepared.operations.includes("remove_uniform_background"));

const cleanLogo = await sharp({
  create: { width: 120, height: 60, channels: 4, background: { r: 36, g: 99, b: 75, alpha: 1 } }
}).png().toBuffer();
const cleanPrepared = await prepareLogoPresentation({ bytes: cleanLogo, mimeType: "image/png" });
assert.equal(cleanPrepared.status, "prepared");
if (cleanPrepared.status !== "prepared") throw new Error("Clean logo preparation failed.");
assert.equal(cleanPrepared.changed, false);
assert.deepEqual(cleanPrepared.operations, []);
assert.equal(cleanPrepared.width, 120);
assert.equal(cleanPrepared.height, 60);
const unchangedMaterialization = await materializeSourceLogo({
  bytes: cleanLogo,
  mimeType: "image/png",
  sourceRevisionId: "source_resource_clean_logo",
  sourceContentHash: sha256(cleanLogo)
});
assert.equal(unchangedMaterialization.status, "prepared");
if (unchangedMaterialization.status !== "prepared") throw new Error("Unchanged source logo materialization failed.");
assert.deepEqual(unchangedMaterialization.preparation.operations, []);
assert.equal(unchangedMaterialization.bytes.equals(cleanLogo), true);
assert.equal(unchangedMaterialization.contentHash, sha256(cleanLogo));
assert.equal(
  sourceLogoPreparedRevisionId(unchangedMaterialization.revisionIdentity),
  sourceLogoPreparedRevisionId({
    sourceRevisionId: "source_resource_clean_logo",
    sourceContentHash: sha256(cleanLogo)
  }),
  "Adoption, canary, and experiment materializers did not share one recipe-bound revision identity."
);

const corruptPrepared = await prepareLogoPresentation({ bytes: Buffer.from("not an image"), mimeType: "image/png" });
assert.equal(corruptPrepared.status, "unusable");
if (corruptPrepared.status !== "unusable") throw new Error("Corrupt logo unexpectedly decoded.");
assert.equal(corruptPrepared.reason, "decode_failed");

const oversizedLogo = await sharp({
  create: { width: 4_000, height: 3_001, channels: 3, background: { r: 255, g: 255, b: 255 } }
}).png().toBuffer();
const oversizedPrepared = await prepareLogoPresentation({ bytes: oversizedLogo, mimeType: "image/png" });
assert.equal(oversizedPrepared.status, "unusable");
if (oversizedPrepared.status !== "unusable") throw new Error("Oversized logo unexpectedly passed analysis.");
assert.equal(oversizedPrepared.reason, "pixel_limit_exceeded");

const snapshot = sourceSnapshotSchema.parse({
  schemaVersion: 1,
  id: "source_canonical_logo_test",
  businessId: "business_canonical_logo_test",
  sourceType: "website",
  sourceUrl: "https://example.com/",
  contentHash: sha256("canonical-source-logo-test"),
  capturedAt: "2026-08-14T00:00:00.000Z",
  payload: {}
});
const page = sourceSnapshotPageSchema.parse({
  schemaVersion: 1,
  id: "source_page_canonical_logo_test",
  sourceSnapshotId: snapshot.id,
  resourceId: "source_document_canonical_logo_test",
  requestedUrl: "https://example.com/",
  finalUrl: "https://example.com/",
  path: "/",
  outcome: "fetched",
  status: 200,
  contentType: "text/html",
  indexability: "indexable",
  title: "Example",
  headings: ["Example"],
  wordCount: 1,
  internalLinks: [],
  externalLinks: [],
  rawContentHash: sha256("document"),
  linkProminence: 1,
  extractedText: "Example",
  textContentHash: sha256("Example"),
  producer: "verify-logo-preparation",
  inputHash: sha256("canonical-source-logo-test-input"),
  createdAt: snapshot.capturedAt
});
const sourceLogoEntry = (id: string, bytes: Buffer, path: string) => ({
  resource: sourceSnapshotResourceSchema.parse({
    schemaVersion: 1,
    id,
    sourceSnapshotId: snapshot.id,
    captureKind: "http_response",
    role: "image",
    requestedUrl: `https://example.com/${path}`,
    finalUrl: `https://example.com/${path}`,
    outcome: "fetched",
    status: 200,
    contentType: "image/png",
    storedEncoding: "identity",
    rawContentHash: sha256(bytes),
    blobContentHash: sha256(bytes),
    storageKey: `source-mirror/${sha256(bytes).slice(7)}.bin`,
    rawBytes: bytes.length,
    storedBytes: bytes.length,
    headers: {},
    redirectChain: [],
    initiatorUrls: ["https://example.com/"],
    capturedAt: snapshot.capturedAt,
    metadata: {}
  }),
  bytes
});
const canonical = await materializeCanonicalSourceLogo({
  snapshot,
  pages: [page],
  resources: [
    sourceLogoEntry("source_resource_small_logo", cleanLogo, "logo.png"),
    sourceLogoEntry("source_resource_large_logo", whitePadded, "brand-logo.png")
  ],
  businessName: "Example"
});
assert.equal(canonical.status, "canonical");
if (canonical.status !== "canonical") throw new Error("Canonical source logo selection failed.");
assert.equal(canonical.candidate.resource.id, "source_resource_large_logo");
assert.equal(canonical.ref.assetId, canonicalSourceLogoAssetId(snapshot.businessId));
assert.equal(canonical.ref.revisionId, canonical.revision.id);
assert.equal(canonical.revision.id, canonicalSourceLogoRevisionId({
  sourceSnapshotId: snapshot.id,
  sourceContentHash: sha256(whitePadded)
}));
assert.equal(canonical.revision.provenance.origin, "source_website");
assert.equal(canonical.revision.provenance.sourceSnapshotId, snapshot.id);
assert.equal(canonical.revision.provenance.sourceResourceId, undefined);

process.stdout.write(`${JSON.stringify({
  ok: true,
  transparentCanvasTrim: "pass",
  neutralBackgroundRemoval: "pass",
  antialiasedNeutralBackgroundRemoval: "pass",
  coloredBrandTilePreservation: "pass",
  unchangedReceipt: "pass",
  deterministicMaterialization: "pass",
  canonicalSourceSelection: "pass",
  unusableDiagnostics: "pass"
})}\n`);
