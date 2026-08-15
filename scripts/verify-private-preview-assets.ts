import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  resolveManagedPreviewAsset,
  rewritePreviewAssetUrls
} from "../lib/private-preview-assets";
import { sha256 } from "../packages/business-data";
import { LocalArtifactBlobStore } from "../packages/site-artifacts/blob-store";
import { assetRevisionSchema } from "../packages/site-contracts";
import { generatedSiteContentSecurityPolicy } from "../lib/generated-site-security";
import { resolveSafeManifestPreviewRoute } from "../packages/site-artifacts";

const previewId = "preview_private_assets";
const siteId = "site_private_assets";
const replacement = `/preview/${previewId}/__asset/${siteId}/`;
const rewritten = rewritePreviewAssetUrls(Buffer.from([
  '<img src="/_lodesta/assets/asset_revision_logo" alt="Logo">',
  `body{background-image:url("/api/assets/${siteId}/owner-photo.webp")}`
].join("\n")), "text/html; charset=utf-8", previewId, siteId).toString("utf8");
assert.match(rewritten, new RegExp(`${replacement}asset_revision_logo`));
assert.match(rewritten, new RegExp(`${replacement}owner-photo\\.webp`));

const blobRoot = await mkdtemp(join(tmpdir(), "lodesta-private-preview-assets-"));
const blobStore = new LocalArtifactBlobStore(blobRoot);
const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const contentHash = sha256(bytes);
const revision = assetRevisionSchema.parse({
  schemaVersion: 1,
  id: "asset_revision_logo",
  assetId: "asset_logo",
  businessId: "business_private_assets",
  contentHash,
  storageKey: "site-assets/business_private_assets/source/asset_revision_logo/logo.png",
  mimeType: "image/png",
  bytes: bytes.length,
  origin: "source_website",
  provenance: {
    origin: "source_website",
    sourceUrl: "https://example.com/logo.png",
    sourcePageUrl: "https://example.com/",
    sourceSnapshotId: "source_private_assets",
    alt: "Example logo"
  },
  createdAt: new Date().toISOString()
});
await blobStore.putImmutable({
  key: revision.storageKey,
  bytes,
  contentType: revision.mimeType,
  contentHash
});
const repository = { getAssetRevision: async (id: string) => id === revision.id ? revision : undefined };

const resolved = await resolveManagedPreviewAsset({
  revisionId: revision.id,
  businessId: revision.businessId,
  allowedRevisionIds: [revision.id],
  repository,
  blobStore
});
assert.deepEqual(resolved?.bytes, bytes);
assert.equal(resolved?.mimeType, "image/png");
assert.equal(await resolveManagedPreviewAsset({
  revisionId: revision.id,
  businessId: revision.businessId,
  allowedRevisionIds: [],
  repository,
  blobStore
}), undefined);
assert.equal(await resolveManagedPreviewAsset({
  revisionId: revision.id,
  businessId: "business_other",
  allowedRevisionIds: [revision.id],
  repository,
  blobStore
}), undefined);

assert.match(generatedSiteContentSecurityPolicy("self"), /font-src 'self'/);
assert.match(generatedSiteContentSecurityPolicy("none"), /font-src 'self'/);
assert.match(generatedSiteContentSecurityPolicy("none"), /form-action 'none'/);
const sandboxWorker = await readFile("workers/site-sandbox/src/index.ts", "utf8");
assert.match(sandboxWorker, /font-src 'self'/);
assert.doesNotMatch(sandboxWorker, /font-src 'none'/);
const previewAccess = await readFile("packages/platform-operations/preview-access.ts", "utf8");
assert.match(previewAccess, /\/preview\/\$\{encodeURIComponent\(grant\.id\)\}\/\#\$\{secret\}/,
  "Private preview links can still redirect before the fragment-secret exchange.");

assert.equal(resolveSafeManifestPreviewRoute({ path: ["raleigh"], requestUrl: "https://example.test/preview/id/raleigh" }), "/raleigh");
assert.equal(resolveSafeManifestPreviewRoute({ path: undefined, requestUrl: "https://example.test/preview/id/" }), "/");
assert.equal(resolveSafeManifestPreviewRoute({ path: ["site.css"], requestUrl: "https://example.test/preview/id/site.css" }), undefined);
assert.equal(resolveSafeManifestPreviewRoute({ path: [".."], requestUrl: "https://example.test/preview/id/%2e%2e" }), undefined);

const previewRoute = await readFile("app/preview/[previewId]/[[...path]]/route.ts", "utf8");
assert.match(previewRoute, /resolveSiteVersionRedirect\(version\.id, requestedRoute\)/,
  "Private preview must resolve candidate-version redirects just like the public runtime.");
assert.match(previewRoute, /platformOperationsRepository\.resolveRedirect\(site\.id, requestedRoute\)/,
  "Private preview must preserve owner redirect behavior after candidate-version redirects.");
assert.match(previewRoute, /\"x-lodesta-redirect-owner\": versionRedirect \? \"site-version\" : \"owner\"/);

console.log("Private preview managed-asset binding passed.");
