import assert from "node:assert/strict";
import {
  fastPreviewContentSecurityPolicy,
  resolveOwnerPreviewAsset,
  rewriteFastPreview
} from "../app/api/site-agent/sessions/[sessionId]/preview/[[...path]]/route";
import { LocalArtifactBlobStore } from "../packages/site-artifacts/blob-store";
import { sha256, stableJson } from "../packages/business-data";
import { assetRevisionRefSchema, siteAgentRunEventSchema } from "../packages/site-contracts";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const rendered = rewriteFastPreview([
  '<a href="/">Home</a>',
  '<img src="/_lodesta/assets/asset_revision_logo" alt="Logo">',
  '<a href="/_lodesta/assets/asset_revision_download">Download</a>',
  '<a href="/services">Services</a>',
  '<a href="#contact">Contact</a>',
  '<a href="https://example.com/">External</a>',
  '</body>'
].join(""), "session owner/preview", "site-runtime-v2");

const base = "/api/site-agent/sessions/session%20owner%2Fpreview/preview";
assert.match(rendered, new RegExp(`href="${base}/"`));
assert.match(rendered, new RegExp(`src="${base}/_lodesta/assets/asset_revision_logo"`));
assert.match(rendered, new RegExp(`href="${base}/_lodesta/assets/asset_revision_download"`));
assert.match(rendered, new RegExp(`href="${base}/services"`));
assert.match(rendered, /href="#contact"/);
assert.match(rendered, /href="https:\/\/example\.com\/"/);
assert.match(rendered, /<script src="\/_lodesta\/runtime\/site-runtime-v2\.js" defer data-lodesta-runtime="site-runtime-v2"><\/script><\/body>/);
assert.match(fastPreviewContentSecurityPolicy, /script-src 'self'/);
assert.doesNotMatch(fastPreviewContentSecurityPolicy, /script-src 'none'/);

const retainedRuntime = rewriteFastPreview(
  '<body><script src="/_lodesta/runtime/site-runtime-v1.js" defer data-lodesta-runtime="site-runtime-v1"></script></body>',
  "session owner/preview",
  "site-runtime-v2"
);
assert.equal((retainedRuntime.match(/data-lodesta-runtime=/g) ?? []).length, 1);
assert.match(retainedRuntime, /src="\/_lodesta\/runtime\/site-runtime-v1\.js"/);

const blobRoot = await mkdtemp(join(tmpdir(), "lodesta-owner-preview-"));
const blobStore = new LocalArtifactBlobStore(blobRoot);
const assetBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const assetHash = sha256(assetBytes);
const asset = assetRevisionRefSchema.parse({
  assetId: "asset_staged",
  revisionId: "asset_revision_staged",
  kind: "logo",
  contentHash: assetHash,
  storageKey: "source-mirror/staged.bin",
  mimeType: "image/png",
  alt: "Staged logo",
  origin: "source_website",
  sourceFactIds: [],
  activeForFutureBuilds: true
});
await blobStore.putImmutable({ key: asset.storageKey, bytes: assetBytes, contentType: asset.mimeType, contentHash: assetHash });
const payloadBytes = Buffer.from(stableJson({ diagnosticResult: { ok: true, asset } }));
const payloadHash = sha256(payloadBytes);
const payloadRef = "agent-run-events/run_preview/event_asset/payload.json";
await blobStore.putImmutable({ key: payloadRef, bytes: payloadBytes, contentType: "application/json", contentHash: payloadHash });
const event = siteAgentRunEventSchema.parse({
  schemaVersion: "site-agent-run-event",
  id: "event_staged_asset",
  runId: "run_preview",
  sequence: 1,
  kind: "tool_call",
  name: "adopt_source_asset",
  status: "succeeded",
  summary: {},
  payloadRef,
  payloadHash,
  startedAt: new Date().toISOString(),
  completedAt: new Date().toISOString()
});
const staged = await resolveOwnerPreviewAsset({
  revisionId: asset.revisionId,
  businessId: "business_preview",
  runId: "run_preview",
  repository: {
    getAssetRevision: async () => undefined,
    listAgentRunEvents: async () => [event]
  },
  blobStore
});
assert.equal(staged?.mimeType, "image/png");
assert.deepEqual(staged?.bytes, assetBytes);

const denied = await resolveOwnerPreviewAsset({
  revisionId: "asset_revision_other",
  businessId: "business_preview",
  runId: "run_preview",
  repository: {
    getAssetRevision: async () => undefined,
    listAgentRunEvents: async () => [event]
  },
  blobStore
});
assert.equal(denied, undefined);

console.log("Owner fast-preview URL rewriting passed.");
