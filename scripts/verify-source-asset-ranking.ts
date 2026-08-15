import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type {
  SourceSnapshotPage,
  SourceSnapshotResource
} from "../packages/site-contracts";
import {
  rankSourceAssetCandidates,
  sourceResourceIsAdoptableImage
} from "../packages/site-platform/source-resource-ranking";

const sourceId = "source_fixture";
const page = (id: string, path: string): SourceSnapshotPage => ({
  schemaVersion: 1,
  id,
  sourceSnapshotId: sourceId,
  resourceId: `document_${id}`,
  requestedUrl: `https://fixture.example${path}`,
  finalUrl: `https://fixture.example${path}`,
  path,
  outcome: "fetched",
  status: 200,
  indexability: "indexable",
  headings: [],
  wordCount: 100,
  internalLinks: [],
  externalLinks: [],
  linkProminence: 1,
  extractedText: "",
  textContentHash: `sha256:${"1".repeat(64)}`,
  producer: "fixture",
  inputHash: `sha256:${"2".repeat(64)}`,
  createdAt: "2026-08-05T00:00:00.000Z"
});
const resource = (id: string, url: string, initiator: string, contentType = "image/webp", rawBytes = 60_000): SourceSnapshotResource => ({
  schemaVersion: 1,
  id,
  sourceSnapshotId: sourceId,
  captureKind: "http_response",
  role: "image",
  requestedUrl: url,
  finalUrl: url,
  outcome: "fetched",
  status: 200,
  contentType,
  storedEncoding: "identity",
  rawContentHash: `sha256:${id.padEnd(64, "a").slice(0, 64)}`,
  blobContentHash: `sha256:${id.padEnd(64, "b").slice(0, 64)}`,
  storageKey: `source/${id}`,
  rawBytes,
  storedBytes: rawBytes,
  headers: {},
  redirectChain: [],
  initiatorUrls: [initiator],
  capturedAt: "2026-08-05T00:00:00.000Z",
  metadata: {}
});

const home = page("page_home", "/");
const about = page("page_about", "/about-us/");
const authorArchive = page("page_author", "/author/editor/");
const ranked = rankSourceAssetCandidates({
  pages: [home, about, authorArchive],
  resources: [
    resource("logo_original", "https://fixture.example/uploads/logo.png", home.finalUrl!),
    resource("logo_thumbnail", "https://fixture.example/uploads/logo-300x150.png", home.finalUrl!, "image/png", 12_000),
    resource("technician", "https://fixture.example/uploads/Connor-Technician.webp", about.finalUrl!),
    resource("html_mislabeled", "https://fixture.example/template/", home.finalUrl!, "text/html", 200_000)
  ]
});

assert.equal(ranked.length, 2, "Thumbnail variants should deduplicate and non-image bodies should be excluded.");
assert.equal(ranked[0]?.resource.id, "logo_original");
assert.equal(ranked[0]?.likelyKind, "logo");

const [contractsSource, managerSource, workflowSource] = await Promise.all([
  readFile(new URL("../packages/site-agent/contracts.ts", import.meta.url), "utf8"),
  readFile(new URL("../packages/site-agent/manager.ts", import.meta.url), "utf8"),
  readFile(new URL("../packages/site-platform/workflow.ts", import.meta.url), "utf8")
]);
assert.match(contractsSource, /list_source_resources:[\s\S]{0,500}limit: z\.number\(\)\.int\(\)\.min\(1\)\.max\(60\)/);
assert.match(managerSource, /tool\("list_source_resources"[\s\S]{0,1200}maximum: 60/);
assert.match(workflowSource, /initiatorUrls: resource\.initiatorUrls\.slice\(0, 5\)/);
assert.match(workflowSource, /const previewable = requested\.map/);
assert.match(workflowSource, /Asset preview \$\{labeledPreview\.previewIndex\}/);
assert.match(workflowSource, /previews,\s*previewCount: previews\.length/);
assert.match(workflowSource, /filter\(\(candidate\) => candidate\.likelyKind !== "logo"\)/,
  "Raw source-logo alternatives remain visible to the author.");
assert.doesNotMatch(contractsSource.match(/adopt_source_asset:[\s\S]*?\n  \}\)\.strict\(\),/)?.[0] ?? "", /"logo"/,
  "The author can still adopt an arbitrary raw source logo.");
assert.equal(ranked[1]?.resource.id, "technician");
assert.equal(ranked[1]?.likelyKind, "photo");
assert.equal(ranked[1]?.sourcePageId, about.id);
assert.equal(sourceResourceIsAdoptableImage(resource("bad", "https://fixture.example/a", home.finalUrl!, "text/html")), false);

const archiveFilenameTrap = resource(
  "archive_tech",
  "https://fixture.example/uploads/tech-7.png",
  authorArchive.finalUrl!,
  "image/png",
  4_000_000
);
const homepagePhoto = resource(
  "homepage_photo",
  "https://fixture.example/uploads/forest.jpg",
  home.finalUrl!,
  "image/jpeg",
  250_000
);
const customerPageAssociation = resource(
  "multi_page_photo",
  "https://fixture.example/uploads/service-yard.jpg",
  authorArchive.finalUrl!,
  "image/jpeg",
  300_000
);
customerPageAssociation.initiatorUrls.push(about.finalUrl!);
const archiveAware = rankSourceAssetCandidates({
  pages: [home, about, authorArchive],
  resources: [archiveFilenameTrap, homepagePhoto, customerPageAssociation]
});
assert.equal(archiveAware[0]?.resource.id, "homepage_photo", "Homepage composition evidence should outrank filename-only archive art.");
assert.equal(archiveAware[1]?.resource.id, "multi_page_photo", "A customer-content initiator should win over an archive association for the same resource.");
assert.equal(archiveAware[1]?.sourcePageId, about.id);
assert.equal(archiveAware.at(-1)?.resource.id, "archive_tech", "Archive-only filename signals must not dominate retained visual evidence.");

console.log("Source asset ranking verification passed.");
