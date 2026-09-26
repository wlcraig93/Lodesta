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

// Legal pages: a binary completeness check over the legal body. Formatting,
// shell lines and "last updated" boilerplate may differ; every substantive
// provision must be present, and the exact path is still required.
{
  const provisions = [
    "We collect the contact details you choose to send when you request an estimate.",
    "We use those details only to answer your request and schedule the repair you asked for.",
    "We never sell personal information to anyone for any purpose.",
    "You may ask us to correct or delete your information by writing to our office.",
    "Service providers who host this website may process data on our behalf under contract.",
    "We keep records only as long as the law and our warranty obligations require.",
    "Questions about this policy can be sent to the shop manager at our street address.",
    "Children under thirteen should not submit information through this website.",
    "We may update this policy and will post the new version on this page.",
    "Cookies on this site remember your form progress and expire when you close the browser.",
    "Analytics on this site count visits without identifying individual visitors.",
    "Security measures protect submitted information while it is stored and transmitted."
  ];
  const shell = ["Northstar Collision Repair", "Home", "Services", "Contact", "Call (512) 555-0142 today for a free collision estimate from our team."];
  const shellPage = (id: string, path: string) => page(id, path, [...shell, `${path} page body with enough words to be a real page.`].join("\n"));
  const legalPage = page("privacy", "/privacy", [...shell, "Privacy Policy", "Last updated: March 3, 2026", ...provisions, "© 2026 Northstar Collision Repair"].join("\n"), [], "Privacy Policy");
  const legalSources = [legalPage, shellPage("s1", "/services"), shellPage("s2", "/about"), shellPage("s3", "/contact")];
  const prepareLegal = (bodyHtml: string, path = "/privacy") => prepareSiteArtifact({
    authoredArtifact: agentAuthoredArtifactSchema.parse(normalizeAgentAuthoredArtifact({
      kind: "agent-authored-artifact",
      compilerManifest: expectedSiteSandboxManifest,
      siteName: input.business.name,
      sharedCss: "body{font:16px Arial,sans-serif}",
      routes: [
        { path: "/", title: input.business.name, description: "Collision repair in Austin.", bodyHtml: "<main><h1>Collision repair</h1><p>Repairs for Austin drivers.</p></main>" },
        { path, title: "Privacy Policy", description: "How the shop handles information.", bodyHtml }
      ]
    })),
    buildInput: input,
    runtimeSeriesId: "site-runtime-v4",
    sourceSnapshots: [snapshot],
    sourcePages: legalSources
  });
  const legalBlocker = (bodyHtml: string, path?: string) => prepareLegal(bodyHtml, path).findings
    .find((finding) => finding.id === "fact.legal_source_preservation" && finding.severity === "error");
  // Reformatted (list markup, curly quotes, extra whitespace), without the site
  // shell and without the "last updated"/copyright boilerplate: complete.
  const reformatted = `<main><h1>Privacy Policy</h1><ul>${provisions.map((provision) => `<li>  ${provision}  </li>`).join("")}</ul></main>`;
  assert.equal(legalBlocker(reformatted), undefined, "A complete, reformatted legal body was rejected.");
  // One omitted provision fails, even though more than 90% of the text is kept.
  const omitted = `<main><h1>Privacy Policy</h1>${provisions.slice(0, -1).map((provision) => `<p>${provision}</p>`).join("")}</main>`;
  assert.match(legalBlocker(omitted)?.message ?? "", /missing 1 substantive source provision.*Security measures protect/,
    "An omitted legal provision passed the completeness check.");
  // A reworded provision fails.
  const reworded = `<main><h1>Privacy Policy</h1>${provisions.map((provision, index) => `<p>${index === 2 ? "We do not sell your data." : provision}</p>`).join("")}</main>`;
  assert.ok(legalBlocker(reworded), "A reworded legal provision passed the completeness check.");
  // The exact path is still required.
  assert.ok(legalBlocker(reformatted, "/privacy-policy"), "A legal page moved off its exact source path passed.");
}

// A contact value the owner replaced is no longer first-party support: every
// operational use blocks, while a legal page's verbatim copy is only reported.
{
  const superseded = { phones: ["(512) 555-0177"], emails: ["parts@northstar.example"] };
  const prepareAfterChange = (routes: Array<{ path: string; bodyHtml: string; title?: string; description?: string }>) => prepareSiteArtifact({
    authoredArtifact: agentAuthoredArtifactSchema.parse(normalizeAgentAuthoredArtifact({
      kind: "agent-authored-artifact",
      compilerManifest: expectedSiteSandboxManifest,
      siteName: input.business.name,
      sharedCss: "body{font:16px Arial,sans-serif}",
      routes: routes.map((route) => ({ title: input.business.name, description: "Collision repair in Austin.", ...route }))
    })),
    buildInput: input,
    runtimeSeriesId: "site-runtime-v4",
    sourceSnapshots: [snapshot],
    sourcePages,
    supersededContacts: superseded
  }).findings.map(withReleaseSeverity);
  assert.ok(!blockerIds("<main><h1>Repairs</h1><p>Fax: (512) 555-0177 · Parts desk: parts@northstar.example</p></main>").includes("fact.superseded_contact"),
    "Without an owner change the first-party contact line stays supported.");
  for (const bodyHtml of [
    "<main><h1>Repairs</h1><p>Fax: (512) 555-0177</p></main>",
    "<main><h1>Repairs</h1><p>Call 512.555.0177 anytime.</p></main>",
    "<main><h1>Repairs</h1><p>Email parts@northstar.example for parts.</p></main>"
  ]) {
    const findings = prepareAfterChange([{ path: "/", bodyHtml }]);
    assert.ok(findings.some((finding) => finding.id === "fact.superseded_contact" && isTechnicalReleaseBlocker(finding)), `A replaced contact detail passed: ${bodyHtml}`);
  }
  const titled = prepareAfterChange([{ path: "/", bodyHtml: "<main><h1>Repairs</h1></main>", description: "Call (512) 555-0177 for repairs." }]);
  assert.ok(titled.some((finding) => finding.id === "fact.superseded_contact"), "A replaced phone in the page description passed.");
  const unrelated = prepareAfterChange([{ path: "/", bodyHtml: "<main><h1>Repairs</h1><p>Serving 78701 and 78704 since 2004; license 5125550.</p></main>" }]);
  assert.ok(!unrelated.some((finding) => finding.id === "fact.superseded_contact"), "Unrelated numbers were read as the replaced phone.");
}

// A legal page's contact line follows the owner's replacement: the old value
// blocks there too, and swapping in the current value keeps the provision
// verbatim. A value removed with no replacement stays and is only reported.
{
  const provisions = [
    "We collect the name, phone number and vehicle details you submit through our estimate form.",
    "Questions about this policy can be sent to the shop manager by calling (512) 555-0177 during business hours.",
    "We keep records only as long as the law and our warranty obligations require."
  ];
  const shell = ["Northstar Collision Repair", "Home", "Services", "Contact"];
  const sources = [
    page("privacy", "/privacy", [...shell, "Privacy Policy", ...provisions].join("\n"), [], "Privacy Policy"),
    ...["/services", "/about", "/contact"].map((path, index) => page(`s${index}`, path, [...shell, `${path} page body with enough words to be a real page.`].join("\n")))
  ];
  const prepareLegal = (bodyHtml: string, buildInput = input) => prepareSiteArtifact({
    authoredArtifact: agentAuthoredArtifactSchema.parse(normalizeAgentAuthoredArtifact({
      kind: "agent-authored-artifact",
      compilerManifest: expectedSiteSandboxManifest,
      siteName: buildInput.business.name,
      sharedCss: "body{font:16px Arial,sans-serif}",
      routes: [
        { path: "/", title: buildInput.business.name, description: "Collision repair in Austin.", bodyHtml: "<main><h1>Collision repair</h1><p>Repairs for Austin drivers.</p></main>" },
        { path: "/privacy", title: "Privacy Policy", description: "How the shop handles information.", bodyHtml }
      ]
    })),
    buildInput,
    runtimeSeriesId: "site-runtime-v4",
    sourcePages: sources,
    supersededContacts: { phones: ["(512) 555-0177"], emails: [] }
  }).findings.map(withReleaseSeverity).filter(isTechnicalReleaseBlocker).map((finding) => finding.id);
  const legalHtml = (lines: string[]) => `<main><h1>Privacy Policy</h1>${lines.map((line) => `<p>${line}</p>`).join("")}</main>`;
  const replaced = provisions.map((line) => line.replace("(512) 555-0177", "(512) 555-0142"));
  assert.deepEqual(prepareLegal(legalHtml(replaced)), [], "A legal page carrying the owner's current phone was blocked.");
  assert.ok(prepareLegal(legalHtml(provisions)).includes("fact.superseded_contact"), "A legal page kept a replaced phone.");
  assert.ok(!prepareLegal(legalHtml(provisions)).includes("fact.legal_source_preservation"), "The verbatim legal text itself was reported as changed.");
  assert.ok(prepareLegal(legalHtml(replaced.slice(1))).includes("fact.legal_source_preservation"), "A dropped provision passed alongside the phone swap.");
  const noPhone = { ...input, business: { ...input.business, contacts: {} } };
  assert.deepEqual(prepareLegal(legalHtml(provisions), noPhone), [], "A removed phone with no replacement blocked the verbatim legal text.");
}

console.log("First-party gate verification passed.");
