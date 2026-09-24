import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import type {
  SourceSnapshotPage,
  SourceSnapshotResource
} from "../packages/site-contracts";
import {
  rankSourceAssetCandidates,
  sourceImageFamily,
  sourcePhotoNotes,
  sourcePhotoPageRole,
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
// A non-stock media host the business's own page loads is a first-party host.
assert(!cdnCandidates.find(c => c.resource.id === "cdn_service")?.relevanceReasons
  .includes("cross-origin dependency rather than a first-party asset"),
"A media CDN loaded by the business's own page was penalized as cross-origin.");
assert.equal(cdnCandidates.find(c => c.resource.id === "cdn_service")?.firstPartyHost, true);

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
  "https://images.squarespace-cdn.com/content/abc/roof-replacement.jpg",
  "https://example.com/uploads/livestock-fence.jpg"
]) assert.equal(stockImageSignal(url), false, `Business photograph was labeled stock: ${url}`);
assert.deepEqual(sourcePhotoNotes({ imageUrl: "https://example.com/gallery/deck.jpg", pagePath: "/our-work", width: 2400, height: 1600 }), ["published on a project or gallery page"]);
assert.deepEqual(sourcePhotoNotes({ imageUrl: "https://example.com/AdobeStock_1.jpg", pagePath: "/", width: 800, height: 1200 }), [
  "published on the source homepage",
  "URL indicates licensed stock photography, not this business's own work",
  "800x1200: too small for a full-width or hero placement",
  "portrait orientation"
]);

// Any media host the business's own pages load images from is first-party:
// site-builder CDNs, generic CDNs, the site's own subdomains. Stock hosts,
// review platforms, and other businesses' websites stay cross-origin.
const homeWithPartner = { ...home, externalLinks: ["https://www.partner-supplier.example/"] };
const builderCdnRanking = rankSourceAssetCandidates({
  pages: [homeWithPartner, about],
  resources: [
    resource("cloudfront_photo", "https://d1abc234.cloudfront.net/uploads/crew.jpg", home.finalUrl!, "image/jpeg", 90_000),
    resource("cloudinary_photo", "https://res.cloudinary.com/fixture/image/upload/roof.jpg", home.finalUrl!, "image/jpeg", 90_000),
    resource("gbp_photo", "https://lh3.googleusercontent.com/p/AF1QipN-fixture=s1600", home.finalUrl!, "image/jpeg", 90_000),
    resource("partner_photo", "https://cdn.partner-supplier.example/catalog/shingle.jpg", home.finalUrl!, "image/jpeg", 90_000),
    resource("other_business_site_photo", "https://www.unrelated-business.example/images/truck.jpg", home.finalUrl!, "image/jpeg", 90_000),
    resource("webflow_photo", "https://cdn.prod.website-files.com/64ab/65cd_detail-bay.jpeg", home.finalUrl!, "image/jpeg", 90_000),
    resource("squarespace_photo", "https://images.squarespace-cdn.com/content/abc/coating.jpg?format=1500w", home.finalUrl!, "image/jpeg", 90_000),
    resource("wix_photo", "https://static.wixstatic.com/media/a1b2c3_d4e5~mv2.jpg/v1/fill/w_980,h_600/detail.jpg", about.finalUrl!, "image/jpeg", 90_000),
    resource("subdomain_photo", "https://media.fixture.example/uploads/shop.jpg", home.finalUrl!, "image/jpeg", 90_000),
    resource("photon_photo", "https://i0.wp.com/fixture.example/wp-content/uploads/crew.jpg", home.finalUrl!, "image/jpeg", 90_000),
    resource("third_party_photo", "https://s3-media0.fl.yelpcdn.com/bphoto/fixture/o.jpg", home.finalUrl!, "image/jpeg", 90_000),
    resource("stock_host_photo", "https://images.unsplash.com/photo-1581578731548", home.finalUrl!, "image/jpeg", 90_000),
    resource("foreign_photon", "https://i0.wp.com/other.example/wp-content/uploads/crew.jpg", home.finalUrl!, "image/jpeg", 90_000)
  ]
});
const crossOrigin = (id: string) => builderCdnRanking.find((candidate) => candidate.resource.id === id)?.relevanceReasons
  .includes("cross-origin dependency rather than a first-party asset");
for (const id of ["webflow_photo", "squarespace_photo", "wix_photo", "subdomain_photo", "photon_photo", "cloudfront_photo", "cloudinary_photo", "gbp_photo"]) {
  assert.equal(crossOrigin(id), false, `A first-party site-builder or subdomain photo was penalized as cross-origin: ${id}`);
}
for (const id of ["third_party_photo", "stock_host_photo", "foreign_photon", "partner_photo", "other_business_site_photo"]) {
  assert.equal(crossOrigin(id), true, `A third-party or stock image became first-party: ${id}`);
}
assert.equal(builderCdnRanking.find((candidate) => candidate.resource.id === "cloudfront_photo")?.firstPartyHost, true);

// Responsive size variants share one visual family.
for (const [left, right] of [
  ["https://cdn.prod.website-files.com/site/hero-p-500.jpeg", "https://cdn.prod.website-files.com/site/hero.jpeg"],
  ["https://fixture.example/uploads/deck-1024x683.jpg", "https://fixture.example/uploads/deck-scaled.jpg"],
  ["https://images.squarespace-cdn.com/content/abc/roof.jpg?format=500w", "https://images.squarespace-cdn.com/content/abc/roof.jpg?format=2500w"],
  ["https://static.wixstatic.com/media/a1~mv2.jpg/v1/fill/w_400,h_300/a.jpg", "https://static.wixstatic.com/media/a1~mv2.jpg"],
  ["https://fixture.example/img/team@2x.png", "https://fixture.example/img/team.png"]
]) assert.equal(sourceImageFamily(left!), sourceImageFamily(right!), `Size variants did not share a family: ${left}`);
assert.notEqual(sourceImageFamily("https://fixture.example/a/hero.jpg"), sourceImageFamily("https://fixture.example/b/hero.jpg"));
const webflowVariants = rankSourceAssetCandidates({
  pages: [home],
  resources: [
    resource("variant_500", "https://cdn.prod.website-files.com/site/hero-p-500.jpeg", home.finalUrl!, "image/jpeg", 40_000),
    resource("variant_1080", "https://cdn.prod.website-files.com/site/hero-p-1080.jpeg", home.finalUrl!, "image/jpeg", 120_000)
  ]
});
assert.deepEqual(webflowVariants.map((candidate) => candidate.resource.id), ["variant_1080"],
  "Webflow -p-NNN variants were not collapsed to the largest retained file.");

// A photo referenced only by a stylesheet belongs to the pages loading that
// stylesheet (through nested imports), or the homepage when none was retained.
const stylesheet = (id: string, url: string, initiators: string[]): SourceSnapshotResource => ({
  ...resource(id, url, initiators[0] ?? "", "text/css", 4_000), role: "stylesheet", initiatorUrls: initiators
});
const servicePage = page("page_service_detail", "/ceramic-coating/");
const stylesheetRanking = rankSourceAssetCandidates({
  pages: [home, servicePage],
  resources: [
    stylesheet("sheet_main", "https://fixture.example/css/main.css", [servicePage.finalUrl!]),
    stylesheet("sheet_nested", "https://fixture.example/css/sections.css", ["https://fixture.example/css/main.css"]),
    stylesheet("sheet_orphan", "https://fixture.example/css/orphan.css", ["https://fixture.example/unretained/"]),
    resource("css_background", "https://fixture.example/media/bay-background.jpg", "https://fixture.example/css/main.css", "image/jpeg", 90_000),
    resource("nested_css_background", "https://fixture.example/media/foam-cannon.jpg", "https://fixture.example/css/sections.css", "image/jpeg", 90_000),
    resource("orphan_css_background", "https://fixture.example/media/garage.jpg", "https://fixture.example/css/orphan.css", "image/jpeg", 90_000),
    resource("unknown_initiator", "https://fixture.example/media/unknown.jpg", "https://fixture.example/unretained/", "image/jpeg", 90_000)
  ]
});
const stylesheetPage = (id: string) => stylesheetRanking.find((candidate) => candidate.resource.id === id)?.sourcePageId;
assert.equal(stylesheetPage("css_background"), servicePage.id, "A stylesheet-only photo was dropped instead of attributed to its loading page.");
assert.equal(stylesheetPage("nested_css_background"), servicePage.id, "A nested-import stylesheet photo was dropped.");
assert.equal(stylesheetPage("orphan_css_background"), home.id, "A stylesheet photo without a retained loading page did not fall back to the homepage.");
assert.equal(stylesheetPage("unknown_initiator"), undefined, "An image with no retained page or stylesheet initiator gained a page.");

assert.equal(sourcePhotoPageRole("/"), "home");
assert.equal(sourcePhotoPageRole("/services/tint"), "service");
assert.equal(sourcePhotoPageRole("/ceramic-coating", "Ceramic coating", true), "service");
assert.equal(sourcePhotoPageRole("/contact", "Contact", true), "other");
assert.equal(sourcePhotoPageRole("/about-us"), "about");
assert.equal(sourcePhotoPageRole("/gallery"), "portfolio");

// The homepage path must not normalize away before preferred-slot selection.
assert.doesNotMatch(workflowSource, /replace\(\/\\\/\+\$\/, ""\) \|\| ""/,
  "Source-page paths must normalize the homepage to \"/\", not an empty string.");

// Ranking is vertical-neutral: no trade vocabulary earns a filename bonus.
{
  const [pestPhoto] = rankSourceAssetCandidates({ pages: [home], resources: [
    resource("pest_named", "https://fixture.example/images/termite-inspection.jpg", home.finalUrl!, "image/jpeg", 80_000)
  ] });
  const [neutralPhoto] = rankSourceAssetCandidates({ pages: [home], resources: [
    resource("neutral_named", "https://fixture.example/images/deckboard-staining.jpg", home.finalUrl!, "image/jpeg", 80_000)
  ] });
  assert.equal(pestPhoto?.relevanceScore, neutralPhoto?.relevanceScore, "A trade-specific filename word changed an image's rank.");
}

console.log("Source asset ranking verification passed.");
