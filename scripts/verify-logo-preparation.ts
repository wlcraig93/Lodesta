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
import { rankSourceAssetCandidates } from "../packages/site-platform/source-resource-ranking";
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

const sourceSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 330 77"><rect width="330" height="77" fill="#285649"/></svg>');
const sourceSvgHash = sha256(sourceSvg);
const svgMaterialization = await materializeSourceLogo({
  bytes: sourceSvg,
  mimeType: "image/svg+xml",
  sourceRevisionId: "source_resource_svg_logo",
  sourceContentHash: sourceSvgHash
});
assert.equal(svgMaterialization.status, "prepared");
if (svgMaterialization.status !== "prepared") throw new Error("Self-contained source SVG did not materialize.");
const expectedSvgPng = await sharp(sourceSvg, {
  animated: false,
  unlimited: false,
  failOn: "warning",
  limitInputPixels: 80_000_000,
  density: 72
}).timeout({ seconds: 2 }).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
assert.deepEqual(svgMaterialization.bytes, expectedSvgPng);
assert.equal(svgMaterialization.mimeType, "image/png");
assert.equal(svgMaterialization.contentHash, sha256(expectedSvgPng));
assert.notEqual(svgMaterialization.contentHash, sourceSvgHash, "An SVG derivative reused the raw source hash.");
assert.equal(svgMaterialization.presentation.changed, true);
assert.deepEqual(svgMaterialization.preparation.operations, ["rasterize_svg"]);
assert.equal(svgMaterialization.presentation.width, 330);
assert.equal(svgMaterialization.presentation.height, 77);
assert.deepEqual(svgMaterialization.revisionIdentity, {
  sourceRevisionId: "source_resource_svg_logo",
  sourceContentHash: sourceSvgHash,
  logoPresentationRecipeVersion: 1
});
const repeatedSvgMaterialization = await materializeSourceLogo({
  bytes: sourceSvg,
  mimeType: "image/svg+xml",
  sourceRevisionId: "source_resource_svg_logo",
  sourceContentHash: sourceSvgHash
});
assert.equal(repeatedSvgMaterialization.status, "prepared");
if (repeatedSvgMaterialization.status !== "prepared") throw new Error("Repeated source SVG materialization failed.");
assert.deepEqual(repeatedSvgMaterialization.bytes, svgMaterialization.bytes);
assert.deepEqual(repeatedSvgMaterialization.presentation, svgMaterialization.presentation);
assert.deepEqual(repeatedSvgMaterialization.revisionIdentity, svgMaterialization.revisionIdentity);

const percentageDimensionsWithViewBox = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 20 10"><rect width="20" height="10" fill="#285649"/></svg>'
);
const percentageWithViewBoxMaterialization = await materializeSourceLogo({
  bytes: percentageDimensionsWithViewBox,
  mimeType: "image/svg+xml",
  sourceRevisionId: "source_resource_percentage_dimensions_with_viewbox",
  sourceContentHash: sha256(percentageDimensionsWithViewBox)
});
assert.equal(percentageWithViewBoxMaterialization.status, "prepared",
  "A positive intrinsic viewBox should remain valid when presentation dimensions are percentages.");

const absoluteDimensionsWithoutViewBox = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="20px" height="10pt"><rect width="20" height="10" fill="#285649"/></svg>'
);
const absoluteDimensionsMaterialization = await materializeSourceLogo({
  bytes: absoluteDimensionsWithoutViewBox,
  mimeType: "image/svg+xml",
  sourceRevisionId: "source_resource_absolute_dimensions",
  sourceContentHash: sha256(absoluteDimensionsWithoutViewBox)
});
assert.equal(absoluteDimensionsMaterialization.status, "prepared",
  "Positive absolute dimensions without a viewBox should remain supported.");

const unusableSvgCases = [
  ["missing dimensions", '<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>', "dimensions_missing"],
  ["percentage-only dimensions", '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"><rect width="10" height="10"/></svg>', "dimensions_missing"],
  ["zero dimensions", '<svg xmlns="http://www.w3.org/2000/svg" width="0" height="10"><rect width="10" height="10"/></svg>', "dimensions_missing"],
  ["negative dimensions", '<svg xmlns="http://www.w3.org/2000/svg" width="-10" height="10"><rect width="10" height="10"/></svg>', "dimensions_missing"],
  ["empty dimensions", '<svg xmlns="http://www.w3.org/2000/svg" width="" height="10"><rect width="10" height="10"/></svg>', "dimensions_missing"],
  ["dynamic dimensions", '<svg xmlns="http://www.w3.org/2000/svg" width="calc(100px)" height="10"><rect width="10" height="10"/></svg>', "dimensions_missing"],
  ["excessive pixels", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4000 3001"><rect width="4000" height="3001"/></svg>', "pixel_limit_exceeded"],
  ["malformed input", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path', "decode_failed"],
  ["empty output", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>', "empty_content"],
  ["embedded image", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><image href="data:image/png;base64,AA=="/></svg>', "unsupported_svg"],
  ["external href", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><use href="https://assets.example/mark.svg#logo"/></svg>', "unsupported_svg"],
  ["CSS import", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><style>@import url("https://assets.example/logo.css");</style></svg>', "unsupported_svg"],
  ["external entity", '<!DOCTYPE svg SYSTEM "https://assets.example/logo.dtd"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>', "unsupported_svg"],
  ["internal entity", '<!DOCTYPE svg [<!ENTITY mark "logo">]><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>&mark;</text></svg>', "unsupported_svg"],
  ["script", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>void 0</script></svg>', "unsupported_svg"],
  ["foreignObject", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><foreignObject width="10" height="10"/></svg>', "unsupported_svg"],
  ["CSS escape", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><style>.mark{fill:url(\\68 ttps://assets.example/mark.svg)}</style></svg>', "unsupported_svg"],
  ["unsupported encoding", '<?xml version="1.0" encoding="UTF-16"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>', "unsupported_svg"]
] as const;
for (const [label, source, reason] of unusableSvgCases) {
  const result = await materializeSourceLogo({
    bytes: Buffer.from(source),
    mimeType: "image/svg+xml",
    sourceRevisionId: `source_resource_${label.replaceAll(" ", "_")}`,
    sourceContentHash: sha256(source)
  });
  assert.equal(result.status, "unusable", `${label} unexpectedly materialized.`);
  if (result.status !== "unusable") throw new Error(`${label} unexpectedly materialized.`);
  assert.equal(result.reason, reason, `${label} returned the wrong rejection reason.`);
}

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
const sourceLogoEntry = (id: string, bytes: Buffer, path: string, contentType = "image/png") => ({
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
    contentType,
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
const sourceDocumentEntry = (html: string) => {
  const bytes = Buffer.from(html);
  return {
    resource: sourceSnapshotResourceSchema.parse({
      schemaVersion: 1,
      id: page.resourceId,
      sourceSnapshotId: snapshot.id,
      captureKind: "http_response",
      role: "document",
      requestedUrl: page.requestedUrl,
      finalUrl: page.finalUrl,
      outcome: "fetched",
      status: 200,
      contentType: "text/html; charset=utf-8",
      storedEncoding: "identity",
      rawContentHash: sha256(bytes),
      blobContentHash: sha256(bytes),
      storageKey: `source-mirror/${sha256(bytes).slice(7)}.bin`,
      rawBytes: bytes.length,
      storedBytes: bytes.length,
      headers: {},
      redirectChain: [],
      initiatorUrls: [page.requestedUrl],
      capturedAt: snapshot.capturedAt,
      metadata: {}
    }),
    bytes
  };
};
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
assert.equal(canonical.revision.provenance.sourceResourceId, undefined,
  "Existing raster provenance changed shape under the same deterministic revision identity.");

const exactLengthSvg = (source: string, bytes: number) => {
  const padding = bytes - Buffer.byteLength(source);
  assert(padding >= 0);
  return Buffer.from(source.replace("</svg>", `${" ".repeat(padding)}</svg>`));
};
const porscheSpecialistLogo = exactLengthSvg(
  '<svg xmlns="http://www.w3.org/2000/svg" width="380" height="488" viewBox="0 0 380 488"><path fill="#111" d="M0 0h380v488H0z"/></svg>',
  18_911
);
const pristineBusinessLogo = exactLengthSvg(
  '<svg xmlns="http://www.w3.org/2000/svg" width="331" height="77" viewBox="0 0 331 77"><path fill="#111" d="M0 0h331v77H0z"/></svg>',
  12_832
);
const porscheUrl = "https://cdn.prod.website-files.com/64aeacbc660c41c0352856c7/64c154b45e92d9ea81c153be_PorscheLogoNew.svg";
const pristineUrl = "https://cdn.prod.website-files.com/661fb5d27d5fec91160b4b8e/6637b84b273968f93dd9af3f_PristineTXNewLogo.svg";
const porscheFixture = sourceLogoEntry(
  "source_resource_4d8652b6f9fab0c2cb2a6b57",
  porscheSpecialistLogo,
  "PorscheLogoNew.svg",
  "image/svg+xml"
);
const pristineFixture = sourceLogoEntry(
  "source_resource_fe8c27c72feb4b17056f80d3",
  pristineBusinessLogo,
  "PristineTXNewLogo.svg",
  "image/svg+xml"
);
const porscheEntry = { ...porscheFixture, resource: sourceSnapshotResourceSchema.parse({
  ...porscheFixture.resource, requestedUrl: porscheUrl, finalUrl: porscheUrl
}) };
const pristineEntry = { ...pristineFixture, resource: sourceSnapshotResourceSchema.parse({
  ...pristineFixture.resource, requestedUrl: pristineUrl, finalUrl: pristineUrl
}) };
assert((porscheEntry.resource.rawBytes ?? 0) > (pristineEntry.resource.rawBytes ?? 0),
  "Structurally matched regression fixture no longer reproduces the original file-size winner.");
assert.equal(rankSourceAssetCandidates({
  pages: [page], resources: [porscheEntry.resource, pristineEntry.resource], includeSvgLogoCandidates: true
})[0]?.resource.id, porscheEntry.resource.id,
"The structurally matched fixture no longer reproduces the original canonical-logo ranking defect.");
const retainedHomepage = sourceDocumentEntry(`<!doctype html><html><body>
  <!-- <a href="/"><img src="${porscheUrl}"></a> -->
  <script>const misleading = '<a href="/"><img src="${porscheUrl}"></a>';</script>
  <a data-href="/"><img src="${porscheUrl}"></a>
  <a href="   "><img src="${porscheUrl}"></a>
  <a href="#clients"><img src="${porscheUrl}"></a>
  <a href="?filter=brand"><img src="${porscheUrl}"></a>
  <nav><a href=/#top class="nav-logo-link"><img src=${pristineUrl} class="logo"></a></nav>
  <a href="/specialist/porsche-2"><img src="${porscheUrl}" class="home-specialist-list-logo"></a>
  <a href="https://external.example/"><img src="${porscheUrl}"></a>
</body></html>`);
const homepageLinkedCanonical = await materializeCanonicalSourceLogo({
  snapshot,
  pages: [page],
  resources: [porscheEntry, pristineEntry, retainedHomepage],
  businessName: "Pristine Auto Detailing"
});
assert.equal(homepageLinkedCanonical.status, "canonical");
if (homepageLinkedCanonical.status !== "canonical") throw new Error("Homepage-linked business logo was unavailable.");
assert.equal(homepageLinkedCanonical.candidate.resource.id, pristineEntry.resource.id,
  "A larger specialist logo displaced the retained homepage home-link logo.");
assert(homepageLinkedCanonical.candidate.relevanceReasons.includes(
  "image is linked to the homepage from the retained homepage"
));

const absoluteHomepage = sourceDocumentEntry(`<!doctype html><html><body>
  <a href="https://example.com/"><img srcset="${pristineUrl} 1x"></a>
  <a href="/specialist/porsche-2"><img data-src="${porscheUrl}"></a>
</body></html>`);
const absoluteHomepageCanonical = await materializeCanonicalSourceLogo({
  snapshot,
  pages: [page],
  resources: [porscheEntry, pristineEntry, absoluteHomepage],
  businessName: "Pristine Auto Detailing"
});
assert.equal(absoluteHomepageCanonical.status, "canonical");
if (absoluteHomepageCanonical.status !== "canonical") throw new Error("Absolute homepage-link evidence was unavailable.");
assert.equal(absoluteHomepageCanonical.candidate.resource.id, pristineEntry.resource.id,
  "Absolute same-origin homepage-link evidence was not honored.");

const malformedHomepageLogo = sourceLogoEntry(
  "source_resource_malformed_homepage_logo",
  Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 331 77"><path'),
  "BusinessLogo.svg",
  "image/svg+xml"
);
const retainedMalformedHomepage = sourceDocumentEntry(`<!doctype html><html><body>
  <a href="/"><img src="/BusinessLogo.svg"></a>
  <a href="/partner"><img src="/PorscheLogoNew.svg"></a>
</body></html>`);
const unusableHomepageCanonical = await materializeCanonicalSourceLogo({
  snapshot,
  pages: [page],
  resources: [porscheEntry, malformedHomepageLogo, retainedMalformedHomepage],
  businessName: "Example"
});
assert.equal(unusableHomepageCanonical.status, "unavailable",
  "An unusable homepage identity mark fell through to a valid partner logo.");
if (unusableHomepageCanonical.status !== "unavailable") throw new Error("Unusable homepage logo selected a partner mark.");
assert.deepEqual(unusableHomepageCanonical.unusableCandidates, [
  { resourceId: malformedHomepageLogo.resource.id, reason: "decode_failed" }
]);

const svgCanonical = await materializeCanonicalSourceLogo({
  snapshot,
  pages: [page],
  resources: [
    sourceLogoEntry("source_resource_raster_logo", cleanLogo, "brand-logo-300x100.png"),
    sourceLogoEntry("source_resource_svg_logo", sourceSvg, "brand-logo.svg", "image/svg+xml")
  ],
  businessName: "Example"
});
assert.equal(svgCanonical.status, "canonical");
if (svgCanonical.status !== "canonical") throw new Error("Canonical SVG source logo selection failed.");
assert.equal(svgCanonical.candidate.resource.id, "source_resource_svg_logo");
assert.equal(svgCanonical.ref.mimeType, "image/png");
assert.equal(svgCanonical.revision.contentHash, sha256(svgCanonical.materialization.bytes));
assert.equal(svgCanonical.revision.id, canonicalSourceLogoRevisionId({
  sourceSnapshotId: snapshot.id,
  sourceContentHash: sourceSvgHash
}));
assert.equal(svgCanonical.revision.provenance.origin, "source_website");
assert.equal(svgCanonical.revision.provenance.sourceSnapshotId, snapshot.id);
assert.equal(svgCanonical.revision.provenance.sourceResourceId, "source_resource_svg_logo");
assert.equal(svgCanonical.revision.provenance.preparation?.sourceContentHash, sourceSvgHash);

const malformedSvgEntry = sourceLogoEntry(
  "source_resource_malformed_svg_logo",
  Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 330 77"><path'),
  "brand-logo.svg",
  "image/svg+xml"
);
const fallbackCanonical = await materializeCanonicalSourceLogo({
  snapshot,
  pages: [page],
  resources: [
    sourceLogoEntry("source_resource_fallback_raster_logo", cleanLogo, "brand-logo-300x100.png"),
    malformedSvgEntry
  ],
  businessName: "Example"
});
assert.equal(fallbackCanonical.status, "canonical");
if (fallbackCanonical.status !== "canonical") throw new Error("Unusable SVG did not fall through to a raster logo.");
assert.equal(fallbackCanonical.candidate.resource.id, "source_resource_fallback_raster_logo");

const corruptRetainedSvg = await materializeCanonicalSourceLogo({
  snapshot,
  pages: [page],
  resources: [{ ...sourceLogoEntry("source_resource_corrupt_svg_logo", sourceSvg, "corrupt-logo.svg", "image/svg+xml"), bytes: Buffer.from("changed") }],
  businessName: "Example"
});
assert.equal(corruptRetainedSvg.status, "unavailable");
if (corruptRetainedSvg.status !== "unavailable") throw new Error("Hash-mismatched retained SVG unexpectedly materialized.");
assert.deepEqual(corruptRetainedSvg.unusableCandidates, [{ resourceId: "source_resource_corrupt_svg_logo", reason: "decode_failed" }]);

const opaque = sourceLogoEntry("opaque_crest", whitePadded, "opaque-cdn-resource");
const missed = await materializeCanonicalSourceLogo({ snapshot, pages: [page], resources: [opaque], businessName: "Example" });
assert.equal(missed.status, "unavailable", "Reproduce filename-based intake missing a visible mark.");
const selected = await materializeCanonicalSourceLogo({ snapshot, pages: [page], resources: [opaque],
  businessName: "Example", selectedResourceId: opaque.resource.id });
assert.equal(selected.status, "canonical");
if (selected.status !== "canonical") throw new Error("Selected source logo was not materialized.");
assert.deepEqual(selected.ref, canonical.ref, "Explicit recognition must use the same canonical identity and presentation, not a second logo path.");
assert.deepEqual(selected.materialization.bytes, canonical.materialization.bytes);
assert.equal((await materializeCanonicalSourceLogo({ snapshot, pages: [], resources: [opaque],
  businessName: "Example", selectedResourceId: opaque.resource.id })).status, "unavailable",
  "Explicit selection cannot bypass retained first-party page association.");

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
