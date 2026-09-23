import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type {
  SourceSnapshotPage,
  SourceSnapshotResource
} from "../packages/site-contracts";
import {
  rankSourceAssetCandidates,
  sourcePhotoNotes,
  sourceResourceIsAdoptableImage,
  stockImageSignal
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
assert.match(contractsSource.match(/adopt_source_asset:[\s\S]*?\n  \}\)\.strict\(\),/)?.[0] ?? "", /"logo"/,
  "A visually identified missed logo needs an honest adoption kind.");
assert.doesNotMatch(managerSource, /The official logo is already supplied/,
  "The tool must not claim that intake always found a logo.");
assert.equal(ranked[1]?.resource.id, "technician");
assert.equal(ranked[1]?.likelyKind, "photo");
assert.equal(ranked[1]?.sourcePageId, about.id);
assert.equal(sourceResourceIsAdoptableImage(resource("bad", "https://fixture.example/a", home.finalUrl!, "text/html")), false);
const svgLogo = resource("svg_logo", "https://fixture.example/assets/brand-logo.svg", home.finalUrl!, "image/svg+xml", 12_000);
const svgDecoration = resource("svg_decoration", "https://fixture.example/assets/decorative-wave.svg", home.finalUrl!, "image/svg+xml", 12_000);
assert.equal(sourceResourceIsAdoptableImage(svgLogo), false, "General source adoption must remain raster-only.");
assert.equal(rankSourceAssetCandidates({ pages: [home], resources: [svgLogo, svgDecoration] }).length, 0,
  "Ordinary ranking admitted SVG resources.");
const logoSelectionRanking = rankSourceAssetCandidates({
  pages: [home],
  resources: [svgLogo, svgDecoration],
  includeSvgLogoCandidates: true
});
assert.deepEqual(logoSelectionRanking.map(candidate => candidate.resource.id), [svgLogo.id, svgDecoration.id]);
assert.equal(logoSelectionRanking[0]?.likelyKind, "logo");
assert.notEqual(logoSelectionRanking[1]?.likelyKind, "logo",
  "Logo-only SVG admission must not turn unrelated SVG artwork into an automatic logo.");
const unpersistedSvgLogo = { ...svgLogo, id: "svg_logo_unpersisted", storageKey: undefined };
const unassociatedSvgLogo = { ...svgLogo, id: "svg_logo_unassociated", initiatorUrls: ["https://fixture.example/missing"] };
const failedSvgLogo = { ...svgLogo, id: "svg_logo_failed", outcome: "failed" as const };
assert.equal(rankSourceAssetCandidates({
  pages: [home],
  resources: [unpersistedSvgLogo, unassociatedSvgLogo, failedSvgLogo],
  includeSvgLogoCandidates: true
}).length, 0, "Logo-only SVG ranking bypassed persistence, fetch, or retained page-association requirements.");

const pristineCamelCaseLogo = {
  ...resource(
    "pristine_camel_case_logo",
    "https://cdn.prod.website-files.com/661fb5d27d5fec91160b4b8e/6637b84b273968f93dd9af3f_PristineTXNewLogo.svg",
    home.finalUrl!,
    "image/svg+xml",
    12_832
  ),
  storedEncoding: "gzip" as const,
  rawContentHash: "sha256:1da64661d91f5da0990aaa40dbdace59352c2227cbb90a7676f1e0d85863a83d",
  blobContentHash: "sha256:f914ab0ce1b5528ad81e0d4c8d5b7e506a96ce8745142ea1e7645e6effda0c8c",
  storedBytes: 3_091
};
const embeddedLowercaseLogoText = resource(
  "embedded_lowercase_logo_text",
  "https://fixture.example/assets/catalogology.svg",
  home.finalUrl!,
  "image/svg+xml",
  12_000
);
const camelCaseLogoRanking = rankSourceAssetCandidates({
  pages: [home],
  resources: [pristineCamelCaseLogo, embeddedLowercaseLogoText],
  includeSvgLogoCandidates: true
});
assert.equal(camelCaseLogoRanking.find(candidate => candidate.resource.id === pristineCamelCaseLogo.id)?.likelyKind, "logo",
  "Camel/acronym filename boundaries did not expose the retained PristineTXNewLogo signal.");
assert.notEqual(camelCaseLogoRanking.find(candidate => candidate.resource.id === embeddedLowercaseLogoText.id)?.likelyKind, "logo",
  "An arbitrary lowercase substring became a logo signal.");

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

const identityRanking = rankSourceAssetCandidates({
  pages: [home],
  resources: [
    resource("business_logo", "https://fixture.example/images/logos/Logo.png", home.finalUrl!, "image/png", 40_000),
    resource("association_logo", "https://fixture.example/images/accolades/chamber-logo.png", home.finalUrl!, "image/png", 250_000),
    resource("site_vendor_logo", "https://fixture.example/common/scorpion/logo/wordmark-gray.png", home.finalUrl!, "image/png", 8_000),
    resource("social_preview", "https://fixture.example/images/FB-LinkImage.jpg", home.finalUrl!, "image/jpeg", 250_000),
    resource("android_icon", "https://fixture.example/android-chrome-512x512.png", home.finalUrl!, "image/png", 250_000)
  ]
});
assert.equal(identityRanking[0]?.resource.id, "business_logo", "Association or site-vendor artwork displaced the business logo.");
assert.equal(identityRanking.find((candidate) => candidate.resource.id === "association_logo")?.likelyKind, "other");
assert.equal(identityRanking.find((candidate) => candidate.resource.id === "site_vendor_logo")?.likelyKind, "other");
assert.notEqual(identityRanking.find((candidate) => candidate.resource.id === "social_preview")?.likelyKind, "photo");
assert.equal(identityRanking.find((candidate) => candidate.resource.id === "android_icon")?.likelyKind, "icon");

const projectPage = {
  ...page("page_project", "/changed-this-bath-from-wallpaper-to-paint"),
  title: "Changed this bath from wallpaper to paint"
};
const projectGalleryRanking = rankSourceAssetCandidates({
  pages: [projectPage],
  resources: [
    resource(
      "project_thumb",
      "https://fixture.example/wp-content/gallery/changed-bath/thumbs/thumbs_b1.jpg",
      projectPage.finalUrl!,
      "image/jpeg",
      8_000
    ),
    resource(
      "project_original",
      "https://fixture.example/wp-content/gallery/changed-bath/b1.jpg",
      projectPage.finalUrl!,
      "image/jpeg",
      90_000
    )
  ]
});
assert.equal(projectGalleryRanking.length, 1, "A gallery thumbnail remained as a separate authoring candidate beside its original.");
assert.equal(projectGalleryRanking[0]?.resource.id, "project_original", "A low-resolution gallery thumbnail displaced its discovered original.");
assert.equal(projectGalleryRanking[0]?.likelyKind, "photo");
assert(projectGalleryRanking[0]?.relevanceReasons.includes("first-party gallery image"));

const opaqueFirstPartyPhoto = rankSourceAssetCandidates({
  pages: [home],
  resources: [
    resource(
      "named_owner_photo",
      "https://fixture.example/images/Jordan-With-A-Project-2024.webp",
      home.finalUrl!,
      "image/webp",
      80_000
    )
  ]
});
assert.equal(opaqueFirstPartyPhoto[0]?.likelyKind, "photo", "A substantial first-party customer image required a service keyword to reach visual evidence.");
assert(opaqueFirstPartyPhoto[0]?.relevanceReasons.includes("substantial customer-page image; inspect pixels and provenance before adoption"));

const cdnPage = page("page_services", "/services.html");
const cdnCandidates = rankSourceAssetCandidates({
  pages: [home, cdnPage, authorArchive],
  resources: [
    resource("cdn_service", "https://media.example/opaque-work-image", cdnPage.finalUrl!, "image/jpeg", 30_000),
    resource("cdn_tiny", "https://media.example/opaque-small-image", home.finalUrl!, "image/png", 600),
    resource("cdn_vendor", "https://media.example/common/scorpion/logo/wordmark.png", home.finalUrl!, "image/png", 80_000),
    resource("cdn_archive", "https://media.example/opaque-archive-image", authorArchive.finalUrl!, "image/jpeg", 80_000)
  ]
});
assert.equal(cdnCandidates.find(c => c.resource.id === "cdn_service")?.likelyKind, "photo",
  "A CDN-hosted customer-page photograph was excluded from the photo-first visual selection.");
for (const id of ["cdn_tiny", "cdn_vendor", "cdn_archive"]) {
  assert.notEqual(cdnCandidates.find(c => c.resource.id === id)?.likelyKind, "photo",
    "Tiny graphics, vendor artwork or archive-only media became default photo candidates.");
}
assert(cdnCandidates.find(c => c.resource.id === "cdn_service")?.relevanceReasons
  .includes("cross-origin dependency rather than a first-party asset"),
"A visual-review hint erased the cross-origin provenance warning.");

for (const url of [
  "https://example.com/wp-content/uploads/AdobeStock_123456.jpeg",
  "https://example.com/images/shutterstock_98765.jpg",
  "https://images.unsplash.com/photo-1581578731548",
  "https://static.wixstatic.com/media/11062b_4f2d.jpg",
  "https://static.wixstatic.com/media/nsplsh_5a7b.jpg",
  "https://example.com/uploads/iStock-1182.jpg"
]) assert.equal(stockImageSignal(url), true, `Stock image URL was not recognized: ${url}`);
for (const url of [
  "https://example.com/wp-content/uploads/crew-truck-2024.jpg",
  "https://images.squarespace-cdn.com/content/v1/abc/roof-replacement.jpg",
  "https://example.com/uploads/livestock-fence.jpg"
]) assert.equal(stockImageSignal(url), false, `Business photograph was labeled stock: ${url}`);
assert.deepEqual(sourcePhotoNotes({ imageUrl: "https://example.com/gallery/deck.jpg", pagePath: "/our-work", width: 2400, height: 1600 }), ["published on a project or gallery page"]);
assert.deepEqual(sourcePhotoNotes({ imageUrl: "https://example.com/AdobeStock_1.jpg", pagePath: "/", width: 800, height: 1200 }), [
  "published on the source homepage",
  "URL indicates licensed stock photography, not this business's own work",
  "800x1200: too small for a full-width or hero placement",
  "portrait orientation"
]);

console.log("Source asset ranking verification passed.");
