import assert from "node:assert/strict";
import { sourceSnapshotPageSchema, sourceSnapshotSchema } from "../packages/site-contracts";
import { expectedSiteSandboxManifest, siteTechnicalReleasePolicy } from "../packages/site-contracts/platform-manifest";
import {
  agentAuthoredArtifactSchema,
  isTechnicalReleaseBlocker,
  normalizeAgentAuthoredArtifact,
  prepareSiteArtifact,
  withReleaseSeverity
} from "../packages/site-verification";
import { buildSyntheticSiteInput } from "./support/synthetic-site-input";

// First-party verbatim content at the release gate (owner-approved
// 2026-09-24): the business's own sentences, links, phones and emails on
// current core pages are verified; AI restatements, spam-page links,
// affiliate links and unsafe links are not.

const base = buildSyntheticSiteInput();
const snapshotId = "source_first_party_gate";
const input = { ...base, sourceSnapshotIds: [...base.sourceSnapshotIds, snapshotId] };
const snapshot = sourceSnapshotSchema.parse({
  schemaVersion: 1,
  id: snapshotId,
  businessId: input.businessId,
  sourceType: "website",
  sourceUrl: "https://northstar.example/",
  contentHash: `sha256:${"e".repeat(64)}`,
  capturedAt: "2026-09-20T00:00:00.000Z",
  payload: {}
});
const page = (id: string, path: string, extractedText: string, externalLinks: string[] = [], title = "Northstar") => sourceSnapshotPageSchema.parse({
  schemaVersion: 1,
  id,
  sourceSnapshotId: snapshotId,
  resourceId: `resource_${id}`,
  requestedUrl: `https://northstar.example${path}`,
  finalUrl: `https://northstar.example${path}`,
  path,
  status: 200,
  outcome: "fetched",
  contentType: "text/html",
  indexability: "indexable",
  title,
  headings: [title],
  wordCount: 40,
  internalLinks: [],
  externalLinks,
  linkProminence: 1,
  extractedText,
  textContentHash: `sha256:${"d".repeat(64)}`,
  producer: "test",
  inputHash: `sha256:${"c".repeat(64)}`,
  createdAt: "2026-09-20T00:00:00.000Z"
});
const sourcePages = [
  page("home", "/", [
    "Northstar Collision Repair",
    "Every repair we complete carries a 3 year warranty on workmanship.",
    "Bumper repairs start at $89 for most sedans.",
    "Proudly serving Austin for 30 years in business.",
    "Our headquarters on Main Street handles every estimate.",
    "Fax: (512) 555-0177 · Parts desk: parts@northstar.example"
  ].join("\n"), [
    "https://www.bbb.org/us/tx/austin/profile/auto-body/northstar",
    "https://financing.example/apply/northstar",
    "https://partner.example/deal?utm_source=northstar"
  ]),
  page("blog", "/blog/2018-spring-special", "Limited time: bumper repairs start at $49 through June 30.", []),
  page("spam", "/online-casino-bonus", "Casino bonus codes.", ["https://casino-spam.example/"], "Online casino bonus")
];

function artifact(bodyHtml: string) {
  return agentAuthoredArtifactSchema.parse(normalizeAgentAuthoredArtifact({
    kind: "agent-authored-artifact",
    compilerManifest: expectedSiteSandboxManifest,
    siteName: input.business.name,
    sharedCss: "html{font-family:Arial,sans-serif} body{margin:0}",
    routes: [{ path: "/", title: input.business.name, description: "Collision repair in Austin.", bodyHtml }]
  }));
}
const prepare = (bodyHtml: string) => prepareSiteArtifact({
  authoredArtifact: artifact(bodyHtml),
  buildInput: input,
  runtimeSeriesId: "site-runtime-v4",
  sourceSnapshots: [snapshot],
  sourcePages
});
const blockers = (bodyHtml: string) => prepare(bodyHtml).findings.map(withReleaseSeverity).filter(isTechnicalReleaseBlocker);
const blockerIds = (bodyHtml: string) => blockers(bodyHtml).map((finding) => finding.id);

// Verbatim first-party sentences carry their markers.
for (const sentence of [
  "Every repair we complete carries a 3 year warranty on workmanship.",
  "Bumper repairs start at $89 for most sedans.",
  "Proudly serving Austin for 30 years in business."
]) {
  assert.ok(!blockerIds(`<main><h1>Repairs</h1><p>${sentence}</p></main>`).includes("fact.undeclared_marker"),
    `A verbatim first-party sentence was blocked: ${sentence}`);
}
// AI restatements still need bound facts.
for (const restatement of [
  "Every repair carries a 5 year warranty.",
  "Bumper repairs start at $79 for every vehicle we see.",
  "We have 40 years in business and counting."
]) {
  assert.ok(blockerIds(`<main><h1>Repairs</h1><p>${restatement}</p></main>`).includes("fact.undeclared_marker"),
    `An AI-written sensitive restatement escaped fact verification: ${restatement}`);
}
// Dated or promotional text, or text found only on a blog page, is not current support.
assert.ok(blockerIds("<main><h1>Deals</h1><p>Limited time: bumper repairs start at $49 through June 30.</p></main>").includes("fact.undeclared_marker"),
  "A dated blog-only promotion was accepted as current first-party support.");

// Location words are advisory.
const location = prepare("<main><h1>Visit</h1><p>Stop by our headquarters for a same-week estimate on any repair.</p></main>");
assert.ok(!location.findings.map(withReleaseSeverity).filter(isTechnicalReleaseBlocker).length,
  "Location-role wording blocked release.");
assert.ok(location.findings.some((finding) => finding.id === "advisory.location_claim" && finding.severity === "warning"));

// Outbound links, phones and emails shown on the business's own pages are verified destinations.
const linked = blockerIds(`<main><h1>Trust</h1>
  <a href="https://www.bbb.org/us/tx/austin/profile/auto-body/northstar">BBB profile</a>
  <a href="https://financing.example/apply/northstar">Financing</a>
  <a href="tel:+15125550177">Fax (512) 555-0177</a>
  <a href="mailto:parts@northstar.example">parts@northstar.example</a></main>`);
assert.deepEqual(linked.filter((id) => id === "fact.link_mismatch"), [], "A first-party partner, financing, phone or email link was blocked.");
assert.ok(!linked.includes("fact.undeclared_marker"), "A first-party displayed fax number or email was blocked as an undeclared marker.");
// Spam-page links, affiliate/tracking links, unseen destinations and unsafe links still block.
for (const href of ["https://casino-spam.example/", "https://partner.example/deal?utm_source=northstar", "https://unseen.example/"]) {
  assert.ok(blockerIds(`<main><h1>Links</h1><a href="${href}">Link</a></main>`).includes("fact.link_mismatch"),
    `An unsupported outbound link was accepted: ${href}`);
}
assert.ok(prepare('<main><h1>Links</h1><a href="javascript:alert(1)">Link</a></main>').findings.some((finding) => finding.id === "link.unsafe"),
  "An unsafe link escaped the sanitizer.");
assert.ok(blockerIds('<main><h1>Call</h1><a href="tel:+15125559999">Call (512) 555-9999</a></main>').includes("fact.link_mismatch"),
  "An unseen phone number was accepted.");

// Slug spelling and missing glyphs are advisory under the release policy.
assert.equal((siteTechnicalReleasePolicy.blockingIds as readonly string[]).includes("route.slug_mismatch"), false);
assert.equal((siteTechnicalReleasePolicy.blockingIds as readonly string[]).includes("render.missing_glyph"), false);
assert.equal(isTechnicalReleaseBlocker({ id: "route.slug_mismatch", severity: "error", area: "route", message: "x" }), false);

console.log("First-party gate verification passed.");
