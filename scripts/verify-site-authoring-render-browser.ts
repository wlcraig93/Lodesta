import assert from "node:assert/strict";
import sharp from "sharp";
import { sha256 } from "../packages/business-data";
import type { ArtifactBlobStore, BlobListInput, ImmutableBlob } from "../packages/site-artifacts/blob-store";
import {
  BrowserVerificationUnavailableError,
  createInspectionIdentity,
  isTechnicalReleaseBlocker,
  normalizeInspectionFindings,
  prepareSiteArtifact,
  runArtifactBrowserGate
} from "../packages/site-verification";
import { expectedSiteSandboxManifest } from "../packages/site-contracts";
import { materializeSourceLogo } from "../packages/site-platform/source-logo-materialization";
import { buildSyntheticSiteInput } from "./support/synthetic-site-input";

class MemoryBlobStore implements ArtifactBlobStore {
  private readonly values = new Map<string, ImmutableBlob>();
  async putImmutable(blob: ImmutableBlob) { this.values.set(blob.key, blob); }
  async get(key: string) { return this.values.get(key); }
  async exists(key: string) { return this.values.has(key); }
  async delete(key: string) { return this.values.delete(key); }
  async listPage(input: BlobListInput = {}) {
    const limit = input.limit ?? 1000;
    const objects = [...this.values.values()]
      .filter((blob) => (!input.prefix || blob.key.startsWith(input.prefix)) && (!input.cursor || blob.key > input.cursor))
      .sort((left, right) => left.key.localeCompare(right.key))
      .map((blob) => ({ key: blob.key, bytes: blob.bytes.byteLength, etag: blob.contentHash }));
    const page = objects.slice(0, limit);
    const truncated = objects.length > page.length;
    return { objects: page, truncated, cursor: truncated ? page.at(-1)?.key : undefined };
  }
}

const buildInput = buildSyntheticSiteInput();
const name = buildInput.publicFacts.find((fact) => fact.kind === "business_name")!;
const phone = buildInput.publicFacts.find((fact) => fact.kind === "phone")!;
const service = buildInput.publicFacts.find((fact) => fact.kind === "offering")!;
const address = buildInput.publicFacts.find((fact) => fact.kind === "address")!;
const hours = buildInput.publicFacts.find((fact) => fact.kind === "hours")!;
const form = buildInput.forms[0];

const prepared = prepareSiteArtifact({
  buildInput,
  runtimeSeriesId: "site-runtime-v4",
  authoredArtifact: {
    kind: "agent-authored-artifact",
    compilerManifest: expectedSiteSandboxManifest,
    siteName: String(name.value),
    sharedCss: `*{box-sizing:border-box}body{margin:0;color:#17211b;background:#f7f4ee;font:18px/1.55 Arial,sans-serif}header,main,footer{padding:28px max(20px,calc((100% - 1080px)/2))}header{display:flex;justify-content:space-between;gap:24px;background:#fff}nav{display:flex;gap:20px;flex-wrap:wrap;font-size:12px}a{color:inherit}.hero{padding-block:100px}h1{font:700 clamp(46px,7vw,88px)/1.02 Georgia,serif;letter-spacing:0;max-width:900px}h2{font:700 40px/1.1 Georgia,serif;letter-spacing:0}.button{display:inline-flex;min-height:48px;align-items:center;padding:10px 18px;background:#9b2c20;color:#fff;text-decoration:none}.panel{border-top:1px solid #bbb;padding-block:60px}.carousel-card{width:180px;height:24px;background:#9b2c20;animation:carousel-slide .35s linear infinite alternate}@keyframes carousel-slide{to{transform:translateX(24px)}}[data-lodesta-map]{display:grid;grid-template-columns:minmax(0,1fr) auto}[data-lodesta-map-surface]{min-width:0;background:#17211b;color:#fff}[data-lodesta-map-fallback]{min-width:11rem}form,label{display:grid;gap:10px}form label{font-size:14px}input,textarea,button{font:inherit;min-height:48px;padding:10px}button{background:#17211b;color:#fff;border:0}@media(max-width:640px){header{align-items:flex-start;flex-direction:column}.hero{padding-block:64px}h1{font-size:48px}}`,
    routes: [
      {
        path: "/",
        title: String(name.value),
        description: "Local collision repair and body work.",
        bodyHtml: `<header><strong data-lodesta-business-name data-lodesta-identity-status="verified" data-lodesta-fact-id="${name.id}">${name.value}</strong><nav><a href="/">Home</a><a href="/contact">Contact</a></nav></header><main><section class="hero"><p>Collision care, clearly handled.</p><p>A customer&#x2019;s next step &#x2192;</p><h1>${name.value}</h1><p data-lodesta-fact-id="${service.id}">${service.value}</p><a class="button" href="/contact">Request help</a><div class="carousel-card" aria-hidden="true"></div></section><section data-lodesta-map="location_primary"><div data-lodesta-map-surface><div data-lodesta-location-heading><span data-lodesta-location-kicker>Location</span><strong data-lodesta-location-name>Austin, TX</strong></div><address data-lodesta-location-address data-lodesta-fact-id="${address.id}">${address.value}</address><dl data-lodesta-location-hours data-lodesta-fact-id="${hours.id}"><div><dt>Monday</dt><dd>8:00 AM-5:30 PM</dd></div><div><dt>Tuesday</dt><dd>8:00 AM-5:30 PM</dd></div><div><dt>Wednesday</dt><dd>8:00 AM-5:30 PM</dd></div><div><dt>Thursday</dt><dd>8:00 AM-5:30 PM</dd></div><div><dt>Friday</dt><dd>8:00 AM-5:30 PM</dd></div><div><dt>Saturday</dt><dd>Closed</dd></div><div><dt>Sunday</dt><dd>Closed</dd></div></dl></div><a href="https://www.google.com/maps/search/?api=1&amp;query=1200%20Main%20Street%2C%20Austin%2C%20TX%2C%2078701" target="_blank" rel="noopener noreferrer" data-lodesta-map-fallback>Get directions</a></section></main><footer><a href="tel:${phone.value}" data-lodesta-fact-id="${phone.id}">${phone.value}</a></footer>`
      },
      {
        path: "/contact",
        title: `Contact ${name.value}`,
        description: "Request collision repair help.",
        bodyHtml: `<header><strong data-lodesta-business-name data-lodesta-identity-status="verified" data-lodesta-fact-id="${name.id}">${name.value}</strong><nav><a href="/">Home</a><a href="/contact">Contact</a></nav></header><main><section class="hero"><h1>Request repair help</h1><p data-lodesta-fact-id="${phone.id}">${phone.value}</p></section><section class="panel"><h2>Tell us what happened</h2><form data-lodesta-form-id="${form.id}" data-lodesta-form-key="${form.key}" data-lodesta-form-revision="${form.revision}" data-lodesta-form-destination="${form.destination}"><label for="name">Name</label><input id="name" data-lodesta-field-id="name" name="name" required><label for="phone">Phone</label><input id="phone" data-lodesta-field-id="phone" name="phone" type="tel" required><label for="message">Details</label><textarea id="message" data-lodesta-field-id="message" name="message"></textarea><button type="submit" data-lodesta-form-submit>${form.submitLabel}</button><p data-lodesta-form-status aria-live="polite" aria-atomic="true"></p></form></section></main>`
      }
    ],
    capabilityBindings: [
      { id: "primary_map", kind: "map", route: "/", config: { locationId: "location_primary" } },
      { id: "contact_form", kind: "form", route: "/contact", config: { formId: form.id } }
    ]
  }
});

const preparationErrors = prepared.findings.filter((finding) => finding.severity === "error");
assert.equal(preparationErrors.length, 0, preparationErrors.map((finding) => `${finding.id}: ${finding.message}`).join("\n"));
const home = prepared.routes.find((route) => route.path === "/")!.html;
const contact = prepared.routes.find((route) => route.path === "/contact")!.html;
assert(home.includes('href="site.css"') && home.includes('href="contact/"'), "Homepage paths are not portable.");
assert(contact.includes('href="../site.css"') && contact.includes('href="../"'), "Nested route paths are not portable.");
const legacyFileRoutePrepared = prepareSiteArtifact({
  buildInput,
  runtimeSeriesId: "site-runtime-v4",
  authoredArtifact: {
    kind: "agent-authored-artifact",
    compilerManifest: expectedSiteSandboxManifest,
    siteName: String(name.value),
    sharedCss: "body{font:16px Arial,sans-serif}",
    routes: [
      {
        path: "/",
        title: String(name.value),
        description: "Fixture homepage with a retained legacy service URL.",
        bodyHtml: `<main><h1 data-lodesta-business-name data-lodesta-identity-status="verified" data-lodesta-fact-id="${name.id}">${name.value}</h1><a href="/legacy-service.html">Legacy service</a></main>`
      },
      {
        path: "/legacy-service.html",
        title: `Legacy service | ${name.value}`,
        description: "Fixture service retained at its exact legacy file-like URL.",
        bodyHtml: `<main><h1>Legacy service</h1><a href="/">Home</a></main>`
      }
    ],
    capabilityBindings: []
  }
});
const legacyFileRouteHome = legacyFileRoutePrepared.routes.find((route) => route.path === "/")!.html;
assert(
  legacyFileRouteHome.includes('href="legacy-service.html"')
    && !legacyFileRouteHome.includes('href="legacy-service.html/"'),
  "The finalizer rewrote an exact legacy file-like route into a trailing-slash URL."
);
const structuredData = JSON.parse(home.match(/<script type="application\/ld\+json">([^<]+)<\/script>/)?.[1] ?? "null");
assert.deepEqual(
  structuredData?.makesOffer?.map((offer: { itemOffered?: { name?: string } }) => offer.itemOffered?.name),
  buildInput.business.offerings.map((offering) => offering.name),
  "Structured offerings did not come exclusively from normalized BusinessOffering authority."
);

const browser = await runArtifactBrowserGate({
  prepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render"
});
const repeatedBrowser = await runArtifactBrowserGate({
  prepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-repeat"
});
assert.deepEqual(
  normalizeInspectionFindings(repeatedBrowser.findings),
  normalizeInspectionFindings(browser.findings),
  "Verifier findings changed for identical prepared input."
);
const deterministicInspectionContext = {
  purpose: "browser-verifier-determinism",
  publicBuildInputHash: buildInput.inputHash
};
assert.equal(
  createInspectionIdentity({
    context: deterministicInspectionContext,
    findings: browser.findings,
    captures: browser.captures
  }),
  createInspectionIdentity({
    context: deterministicInspectionContext,
    findings: repeatedBrowser.findings,
    captures: repeatedBrowser.captures
  }),
  "Verifier inspection identity changed for identical prepared input."
);
const browserErrors = browser.findings.filter((finding) => finding.severity === "error");
assert.equal(browserErrors.length, 0, browserErrors.map((finding) => `${finding.route ?? "/"} ${finding.id}: ${finding.message}`).join("\n"));
assert(!browser.findings.some((finding) => finding.id === "render.escaped_entity"), "A normal React numeric-entity round trip became visible entity source.");
assert(!browser.findings.some((finding) => finding.id === "render.body_font"), "Compact navigation text was incorrectly classified as undersized body copy.");
assert(!browser.findings.some((finding) =>
  finding.id === "render.target_size"
  && finding.message.includes('a "Contact"')
  && finding.message.includes("desktop")), "An ordinary desktop navigation Contact link was incorrectly classified as a primary touch action.");
assert(browser.findings.some((finding) =>
  finding.id === "render.primary_geometry"
  && finding.route === "/contact"
  && finding.severity === "info"), "A non-homepage route was incorrectly held to homepage above-fold conversion geometry.");
assert(browser.findings.some((finding) => finding.id === "render.form_text"), "The dedicated form-text diagnostic did not report undersized labels.");
assert.equal(browser.allRoutesChecked, prepared.routes.length, "Browser verification did not fetch every finalized route.");
assert.equal(browser.routesChecked, 2);
assert.equal(browser.captures.length, 5);
assert.equal(browser.captures.filter((capture) => capture.stage === "natural").length, 0, "Routine verification retained redundant natural-load screenshots.");
assert.equal(browser.captures.filter((capture) => capture.stage === "settled").length, 5, "Routine verification did not retain the homepage tablet proof plus one settled frame per routine route and viewport.");
assert.equal(browser.captures.filter((capture) => capture.frame === "middle" || capture.frame === "bottom").length, 0, "Routine verification retained redundant extended frames for successful routes.");
assert.equal(browser.findings.filter((finding) => finding.id === "accessibility.axe.complete").length, 2, "Canonical axe-core verification did not run on every mobile route.");

const browserDefaultDocumentPrepared = {
  ...prepared,
  files: prepared.files.map((file) => file.path === "site.css"
    ? {
        ...file,
        bytes: Buffer.from(".menu-toggle{min-width:44px}.lead-form button{border:1px solid #000}")
      }
    : file)
};
const browserDefaultDocumentBrowser = await runArtifactBrowserGate({
  prepared: browserDefaultDocumentPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-browser-default-document",
  routePaths: ["/"],
  viewports: [{ name: "desktop", width: 1280, height: 900 }]
});
const browserDefaultDocumentFinding = browserDefaultDocumentBrowser.findings.find((finding) =>
  finding.id === "render.browser_default_document");
assert.equal(
  browserDefaultDocumentFinding?.severity,
  "error",
  `Coordinated browser-default document styling did not fail verification. Findings: ${browserDefaultDocumentBrowser.findings.map((finding) => `${finding.id}:${finding.message}`).join(" | ")}`
);
assert.equal(
  browserDefaultDocumentFinding ? isTechnicalReleaseBlocker(browserDefaultDocumentFinding) : false,
  true,
  "Catastrophic stylesheet loss was not classified as a technical release blocker."
);

const uncontaminatedReviewPrepared = {
  ...prepared,
  files: prepared.files.map((file) => file.path === "site.css"
    ? {
        ...file,
        bytes: Buffer.from(`${file.bytes.toString("utf8")}\n[data-lodesta-form-status]:not(:empty){position:fixed;inset:0;z-index:99999;background:#ff0000;color:#ff0000}`)
      }
    : file)
};
const uncontaminatedReview = await runArtifactBrowserGate({
  prepared: uncontaminatedReviewPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-uncontaminated-review",
  captureMode: "review",
  routePaths: ["/contact"],
  viewports: [{ name: "desktop", width: 1280, height: 900 }]
});
for (const capture of uncontaminatedReview.captures) {
  const { data, info } = await sharp(capture.bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let redPixelCount = 0;
  for (let offset = 0; offset < data.length; offset += info.channels) {
    if (data[offset] === 255 && data[offset + 1] === 0 && data[offset + 2] === 0) redPixelCount += 1;
  }
  assert.equal(redPixelCount, 0, `Review capture ${capture.frame ?? "unknown"} retained a submitted form state instead of the untouched page.`);
}

const divWrappedDesktopNavigationPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => ({
    ...route,
    html: route.html.replace(/<nav>/g, '<div class="desktop-links">').replace(/<\/nav>/g, "</div>")
  })),
  files: prepared.files.map((file) => file.path.endsWith(".html")
    ? {
        ...file,
        bytes: Buffer.from(file.bytes.toString("utf8").replace(/<nav>/g, '<div class="desktop-links">').replace(/<\/nav>/g, "</div>"))
      }
    : file)
};
const divWrappedDesktopNavigationBrowser = await runArtifactBrowserGate({
  prepared: divWrappedDesktopNavigationPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-div-wrapped-navigation",
  routePaths: ["/"],
  viewports: [{ name: "desktop", width: 1280, height: 900 }]
});
assert(
  divWrappedDesktopNavigationBrowser.findings.some((finding) =>
    finding.id === "functional.navigation_reachability"
    && finding.severity === "info"
    && finding.message.includes("All 2 primary destination(s) were reachable")),
  "Visible hit-testable header links were misclassified as unreachable solely because their author used a div instead of a navigation landmark."
);

const keyboardSkipLinkPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? {
        ...route,
        html: route.html
          .replace("<header>", '<header><a class="keyboard-skip" href="#main">Skip to content</a>')
          .replace("<main>", '<main id="main">')
      }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? {
        ...file,
        bytes: Buffer.from(file.bytes.toString("utf8")
          .replace("<header>", '<header><a class="keyboard-skip" href="#main">Skip to content</a>')
          .replace("<main>", '<main id="main">'))
      }
    : file.path === "site.css"
      ? {
          ...file,
          bytes: Buffer.from(`${file.bytes.toString("utf8")}\n.keyboard-skip{position:absolute;opacity:0;pointer-events:none}.keyboard-skip:focus{opacity:1;pointer-events:auto}`)
        }
      : file)
};
const keyboardSkipLinkBrowser = await runArtifactBrowserGate({
  prepared: keyboardSkipLinkPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-keyboard-skip-link",
  routePaths: ["/"],
  viewports: [{ name: "desktop", width: 1280, height: 900 }]
});
assert(
  keyboardSkipLinkBrowser.findings.some((finding) =>
    finding.id === "functional.navigation_reachability"
    && finding.severity === "info"
    && finding.message.includes("All 2 primary destination(s) were reachable")),
  "A focus-revealed skip link was incorrectly counted as an unreachable primary navigation destination."
);

const constrainedMapPrepared = {
  ...prepared,
  files: prepared.files.map((file) => file.path === "site.css"
    ? { ...file, bytes: Buffer.from(`${file.bytes.toString("utf8")}\n[data-lodesta-map]{width:250px}`) }
    : file)
};
const constrainedMapBrowser = await runArtifactBrowserGate({
  prepared: constrainedMapPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-constrained-map",
  routePaths: ["/"],
  viewports: [{ name: "desktop", width: 1280, height: 900 }]
});
const constrainedMapFinding = constrainedMapBrowser.findings.find((finding) => finding.id === "capability.map_layout");
assert(
  constrainedMapFinding?.severity === "error"
    && constrainedMapFinding.message.includes("location details")
    && isTechnicalReleaseBlocker(constrainedMapFinding),
  "A managed location card compressed into an unreadable desktop side rail escaped the capability gate."
);

const localPresencePattern = /<section data-lodesta-map="location_primary">[\s\S]*?<\/section>/;
const missingLocalPresencePrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace(localPresencePattern, "") }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace(localPresencePattern, "")) }
    : file)
};
const missingLocalPresenceBrowser = await runArtifactBrowserGate({
  prepared: missingLocalPresencePrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-missing-local-presence",
  routePaths: ["/"],
  viewports: [{ name: "desktop", width: 1280, height: 900 }]
});
const missingLocalPresenceFinding = missingLocalPresenceBrowser.findings.find((finding) =>
  finding.id === "render.local_presence_missing");
assert(
  missingLocalPresenceFinding?.severity === "warning"
    && !isTechnicalReleaseBlocker(missingLocalPresenceFinding),
  "A homepage with publishable geography but no visible canonical locality cue escaped the local-presence advisory."
);

const belowFoldHeroPrepared = {
  ...prepared,
  files: prepared.files.map((file) => file.path === "site.css"
    ? { ...file, bytes: Buffer.from(`${file.bytes.toString("utf8")}\n.hero{margin-top:900px}`) }
    : file)
};

const conversationCtaPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("Request help", "Start a conversation") }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("Request help", "Start a conversation")) }
    : file)
};
const conversationCtaBrowser = await runArtifactBrowserGate({
  prepared: conversationCtaPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-conversation-cta",
  routePaths: ["/"],
  viewports: [{ name: "desktop", width: 1280, height: 900 }]
});
assert(
  !conversationCtaBrowser.findings.some((finding) =>
    finding.id === "render.primary_geometry" && finding.message.includes("main primary action above fold: false")),
  "A visible above-fold Start a conversation CTA was not recognized as a primary conversion action."
);

const getInTouchCtaPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("Request help", "Get in touch") }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("Request help", "Get in touch")) }
    : file)
};
const getInTouchCtaBrowser = await runArtifactBrowserGate({
  prepared: getInTouchCtaPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-get-in-touch-cta",
  routePaths: ["/"],
  viewports: [{ name: "desktop", width: 1280, height: 900 }]
});
assert(
  !getInTouchCtaBrowser.findings.some((finding) =>
    finding.id === "render.primary_geometry" && finding.message.includes("main primary action above fold: false")),
  "A visible above-fold Get in touch CTA was not recognized as a primary conversion action."
);

const belowFoldHeroBrowser = await runArtifactBrowserGate({
  prepared: belowFoldHeroPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-below-fold-hero",
  routePaths: ["/"],
  viewports: [{ name: "desktop", width: 1280, height: 900 }]
});
const belowFoldHeroFinding = belowFoldHeroBrowser.findings.find((finding) => finding.id === "render.primary_geometry");
assert(
  belowFoldHeroFinding?.severity === "warning"
    && belowFoldHeroFinding.message.includes("Primary heading above fold: false")
    && belowFoldHeroFinding.message.includes("main primary action above fold: false")
    && !isTechnicalReleaseBlocker(belowFoldHeroFinding),
  "An empty first viewport with both the main heading and conversion below the fold escaped advisory author feedback."
);

const mobileFormBeforeHeadingPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/contact"
    ? {
        ...route,
        html: route.html.replace(
          '<section class="panel">',
          '<section class="panel"><a class="button mobile-leading-action" href="/contact">Request help</a>'
        )
      }
    : route),
  files: prepared.files.map((file) => file.path === "site.css"
    ? {
        ...file,
        bytes: Buffer.from(`${file.bytes.toString("utf8")}\n@media(max-width:640px){main{display:flex;flex-direction:column}.panel{order:-1}}`)
      }
    : file)
};
const mobileFormBeforeHeadingBrowser = await runArtifactBrowserGate({
  prepared: mobileFormBeforeHeadingPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-mobile-form-before-heading",
  routePaths: ["/contact"],
  viewports: [{ name: "mobile", width: 390, height: 844 }]
});
const mobileFormBeforeHeadingFinding = mobileFormBeforeHeadingBrowser.findings.find((finding) =>
  finding.id === "render.primary_geometry" && finding.route === "/contact");
assert(
  mobileFormBeforeHeadingFinding?.severity === "warning"
    && mobileFormBeforeHeadingFinding.message.includes("heading precedes main action: false")
    && mobileFormBeforeHeadingFinding.message.includes("do not reorder a form or action above the page purpose")
    && !isTechnicalReleaseBlocker(mobileFormBeforeHeadingFinding),
  "A mobile conversion block visually reordered ahead of its page heading escaped advisory author feedback."
);

const misleadingCallMarkup = '<a class="misleading-call" href="#contact">Call Northstar</a>';
const crampedCallMarkup = `<a class="cramped-call" href="tel:${phone.value}">Call(${phone.value})</a>`;
const misleadingCallPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</header>", `${misleadingCallMarkup}${crampedCallMarkup}</header>`) }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</header>", `${misleadingCallMarkup}${crampedCallMarkup}</header>`)) }
    : file)
};
const misleadingCallBrowser = await runArtifactBrowserGate({
  prepared: misleadingCallPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-misleading-call",
  routePaths: ["/"],
  viewports: [{ name: "desktop", width: 1280, height: 900 }]
});
const misleadingCallFinding = misleadingCallBrowser.findings.find((finding) =>
  finding.id === "render.call_action_destination");
assert(
  misleadingCallFinding?.severity === "warning"
    && misleadingCallFinding.message.includes('"Call Northstar" -> "#contact"')
    && !isTechnicalReleaseBlocker(misleadingCallFinding),
  "A visible Call action that opens a page section instead of the phone dialer escaped the semantic-action advisory."
);
assert(
  !browser.findings.some((finding) => finding.id === "render.call_action_destination"),
  "Canonical tel: actions were incorrectly reported as misleading Call actions."
);
const crampedCallFinding = misleadingCallBrowser.findings.find((finding) =>
  finding.id === "render.call_action_label_spacing");
assert(
  crampedCallFinding?.severity === "warning"
    && crampedCallFinding.message.includes(`"Call(${phone.value})"`)
    && !isTechnicalReleaseBlocker(crampedCallFinding),
  "A visible Call action without readable whitespace before the phone number escaped the typography advisory."
);
assert(
  !browser.findings.some((finding) => finding.id === "render.call_action_label_spacing"),
  "Readable canonical tel: actions were incorrectly reported as cramped Call labels."
);

const linkedServiceDescriptionMarkup = '<p class="section-label" style="font-size:12px">Decorative section label</p><p class="contact-details"><span style="font-size:12px;letter-spacing:.12em">NEXT STEP</span><span style="font-size:12px;letter-spacing:.12em">SERVICE AREA</span></p><div class="tiny-index-family" style="font-size:11px"><span>01</span><span>02</span></div><a class="linked-service-card" href="/contact"><h2>Residential pest control</h2><p style="font-size:14px">Thoughtful protection for the places you live.</p></a>';
const unstructuredFooterMarkup = '<div class="site-footer__grid"><div style="min-height:96px"><a href="/">Company</a></div><div style="min-height:96px"><a href="/contact">Services</a></div><div style="min-height:96px"><a href="/contact">Contact</a></div></div>';
const linkedServiceDescriptionPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</main>", `${linkedServiceDescriptionMarkup}</main>`).replace("</footer>", `${unstructuredFooterMarkup}</footer>`) }
    : route),
  files: prepared.files.map((file) => {
    if (file.path !== "index.html") return file;
    return { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</main>", `${linkedServiceDescriptionMarkup}</main>`).replace("</footer>", `${unstructuredFooterMarkup}</footer>`)) };
  })
};
const linkedServiceDescriptionBrowser = await runArtifactBrowserGate({
  prepared: linkedServiceDescriptionPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-linked-service-description",
  routePaths: ["/"]
});
const linkedServiceDescriptionFinding = linkedServiceDescriptionBrowser.findings.find((finding) => finding.id === "render.body_font");
assert(
  linkedServiceDescriptionFinding?.severity === "warning"
    && linkedServiceDescriptionFinding.message.includes("1 body-copy element(s)")
    && linkedServiceDescriptionFinding.message.includes("examples are representative, not an exhaustive repair list")
    && linkedServiceDescriptionFinding.message.includes("p within a.linked-service-card (1 element, min 14px)")
    && linkedServiceDescriptionFinding.message.includes("Thoughtful protection for the places you live.")
    && !linkedServiceDescriptionFinding.message.includes("NEXT STEP")
    && !linkedServiceDescriptionFinding.message.includes("SERVICE AREA")
    && !linkedServiceDescriptionFinding.message.includes("Decorative section label"),
  "Undersized body copy inside a linked service card escaped the launch-floor advisory."
);
const unstructuredFooterFinding = linkedServiceDescriptionBrowser.findings.find((finding) => finding.id === "render.footer_group_layout");
assert(
  unstructuredFooterFinding?.severity === "warning"
    && unstructuredFooterFinding.message.includes("div.site-footer__grid")
    && unstructuredFooterFinding.message.includes("3 direct groups"),
  "A wide multi-group footer silently fell back to an accidental desktop block stack."
);
const groupedTinyTextFinding = linkedServiceDescriptionBrowser.findings.find((finding) => finding.id === "render.tiny_text");
assert(
  groupedTinyTextFinding?.severity === "warning"
    && groupedTinyTextFinding.message.includes("2 visible text element(s)")
    && groupedTinyTextFinding.message.includes("examples are representative, not exhaustive")
    && groupedTinyTextFinding.message.includes("span within div.tiny-index-family (2 elements, min 11px)"),
  "Tiny repeated labels were reported only as serial examples instead of one shared component family."
);

const paddedLogoPng = await sharp({
  create: { width: 150, height: 150, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } }
}).composite([{
  input: Buffer.from('<svg width="150" height="150" xmlns="http://www.w3.org/2000/svg"><rect x="55" y="65" width="40" height="20" fill="#315a46"/></svg>')
}]).png().toBuffer();
const undersizedPhotoFixture = await retainedPhotoFixture(paddedLogoPng, "undersized-prominent");
const undersizedProminentRasterMarkup = `<img class="undersized-project-photo" alt="Finished wallcovering installation" src="/_lodesta/assets/${undersizedPhotoFixture.revisionId}" style="display:block;width:360px;height:240px;object-fit:cover">`;
const undersizedProminentRasterPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</main>", `${undersizedProminentRasterMarkup}</main>`) }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</main>", `${undersizedProminentRasterMarkup}</main>`)) }
    : file)
};
const undersizedProminentRasterBrowser = await runArtifactBrowserGate({
  prepared: undersizedProminentRasterPrepared,
  buildInput: undersizedPhotoFixture.buildInput,
  blobStore: undersizedPhotoFixture.blobStore,
  capturePrefix: "verification/site-authoring-render-undersized-prominent-raster",
  routePaths: ["/"],
  viewports: [{ name: "desktop", width: 1280, height: 900 }]
});
const undersizedProminentRasterFinding = undersizedProminentRasterBrowser.findings.find((finding) => finding.id === "render.raster_image_upscale");
assert(
  undersizedProminentRasterFinding?.severity === "warning"
    && undersizedProminentRasterFinding.message.includes("undersized-project-photo")
    && undersizedProminentRasterFinding.message.includes("360×240px")
    && undersizedProminentRasterFinding.message.includes("150×150px"),
  `A prominent raster enlarged beyond its intrinsic pixels escaped the source-suitability advisory: ${undersizedProminentRasterBrowser.findings.map((finding) => `${finding.id}:${finding.message}`).join(" | ")}`
);
const preparedSourceLogo = await materializeSourceLogo({
  bytes: paddedLogoPng,
  mimeType: "image/png",
  sourceRevisionId: "source_resource_padded_logo",
  sourceContentHash: sha256(paddedLogoPng)
});
assert.equal(preparedSourceLogo.status, "prepared");
const paddedSourceLogoFixture = await canonicalLogoFixture(preparedSourceLogo.bytes, "source_website", "prepared-source");
const filteredRasterLogoMarkup = `<img class="footer-art" alt="Northstar Collision" src="/_lodesta/assets/${paddedSourceLogoFixture.revisionId}" style="display:block;width:120px;height:60px;filter:grayscale(1) brightness(0) invert(1)"><a class="footer-brand-filter-wrapper" style="display:block;width:120px;height:60px;filter:brightness(0) invert(1)"><img alt="Collision repair" src="/_lodesta/assets/${paddedSourceLogoFixture.revisionId}" style="display:block;width:120px;height:60px"></a>`;
const filteredRasterLogoPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</footer>", `${filteredRasterLogoMarkup}</footer>`) }
    : route),
  files: prepared.files.map((file) => {
    if (file.path !== "index.html") return file;
    return { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</footer>", `${filteredRasterLogoMarkup}</footer>`)) };
  })
};
const filteredRasterLogoBrowser = await runArtifactBrowserGate({
  prepared: filteredRasterLogoPrepared,
  buildInput: paddedSourceLogoFixture.buildInput,
  blobStore: paddedSourceLogoFixture.blobStore,
  capturePrefix: "verification/site-authoring-render-filtered-raster-logo",
  routePaths: ["/"]
});
const filteredRasterLogoFinding = filteredRasterLogoBrowser.findings.find((finding) => finding.id === "render.raster_logo_filter");
assert(
  filteredRasterLogoFinding?.severity === "warning"
    && filteredRasterLogoFinding.message.includes("footer-art")
    && filteredRasterLogoFinding.message.includes("footer-brand-filter-wrapper"),
  `A directly or ancestor-filtered raster logo escaped the brand-integrity advisory: ${filteredRasterLogoBrowser.findings.map((finding) => `${finding.id}:${finding.message}`).join(" | ")}`
);

const oversizedFooterLogoMarkup = `<img class="footer-art" alt="Northstar Collision" src="/_lodesta/assets/${paddedSourceLogoFixture.revisionId}" style="display:block;width:280px;height:280px">`;
const oversizedFooterLogoPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</footer>", `${oversizedFooterLogoMarkup}</footer>`) }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</footer>", `${oversizedFooterLogoMarkup}</footer>`)) }
    : file)
};
const oversizedFooterLogoBrowser = await runArtifactBrowserGate({
  prepared: oversizedFooterLogoPrepared,
  buildInput: paddedSourceLogoFixture.buildInput,
  blobStore: paddedSourceLogoFixture.blobStore,
  capturePrefix: "verification/site-authoring-render-oversized-footer-logo",
  routePaths: ["/"],
  viewports: [{ name: "desktop", width: 1280, height: 900 }]
});
const oversizedFooterLogoFinding = oversizedFooterLogoBrowser.findings.find((finding) => finding.id === "render.footer_raster_logo_scale");
assert(
  oversizedFooterLogoFinding?.severity === "warning"
    && oversizedFooterLogoFinding.message.includes("footer-art")
    && oversizedFooterLogoFinding.message.includes("280×280px"),
  "An oversized square raster logo tile escaped the footer hierarchy advisory."
);

const paddedPrimaryLogoMarkup = `<img class="masthead-art" alt="Northstar Collision" src="/_lodesta/assets/${paddedSourceLogoFixture.revisionId}" style="display:block;width:150px;height:60px;object-fit:contain">`;
const paddedPrimaryLogoPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("<header>", `<header>${paddedPrimaryLogoMarkup}`) }
    : route),
  files: prepared.files.map((file) => {
    if (file.path !== "index.html") return file;
    return { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("<header>", `<header>${paddedPrimaryLogoMarkup}`)) };
  })
};
const paddedPrimaryLogoBrowser = await runArtifactBrowserGate({
  prepared: paddedPrimaryLogoPrepared,
  buildInput: paddedSourceLogoFixture.buildInput,
  blobStore: paddedSourceLogoFixture.blobStore,
  capturePrefix: "verification/site-authoring-render-padded-primary-logo",
  routePaths: ["/"]
});
const paddedPrimaryLogoFinding = paddedPrimaryLogoBrowser.findings.find((finding) => finding.id === "render.raster_logo_content_scale");
assert(
  !paddedPrimaryLogoFinding,
  "A platform-prepared source logo still required an authored crop workaround."
);

const ownerLogoFixture = await canonicalLogoFixture(paddedLogoPng, "owner_upload", "owner-crop");
const intentionallyCroppedLogoMarkup = `<span class="cropped-brand-frame"><img class="cropped-brand-logo" alt="Northstar Collision" src="/_lodesta/assets/${ownerLogoFixture.revisionId}"></span>`;
const intentionallyCroppedLogoPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("<header>", `<header>${intentionallyCroppedLogoMarkup}`) }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("<header>", `<header>${intentionallyCroppedLogoMarkup}`)) }
    : file.path === "site.css"
      ? { ...file, bytes: Buffer.from(`${file.bytes.toString("utf8")}\n.cropped-brand-frame{display:block;position:relative;overflow:hidden;width:100px;height:60px;flex:0 0 100px}.cropped-brand-logo{display:block;position:absolute;width:240px;height:240px;max-width:none;left:-70px;top:-100px}`) }
      : file)
};
const intentionallyCroppedLogoBrowser = await runArtifactBrowserGate({
  prepared: intentionallyCroppedLogoPrepared,
  buildInput: ownerLogoFixture.buildInput,
  blobStore: ownerLogoFixture.blobStore,
  capturePrefix: "verification/site-authoring-render-intentionally-cropped-logo",
  routePaths: ["/"],
  viewports: [{ name: "desktop", width: 1280, height: 900 }]
});
assert(
  !intentionallyCroppedLogoBrowser.findings.some((finding) =>
    finding.id === "render.clipping_overlap" && finding.message.includes("cropped-brand-logo")),
  "A bounded header-logo crop was incorrectly reported as accidental element clipping."
);
const sourceCroppedLogoPrepared = {
  ...intentionallyCroppedLogoPrepared,
  routes: intentionallyCroppedLogoPrepared.routes.map((route) => ({
    ...route,
    html: route.html.replace(ownerLogoFixture.revisionId, paddedSourceLogoFixture.revisionId)
  })),
  files: intentionallyCroppedLogoPrepared.files.map((file) => file.path === "index.html"
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace(ownerLogoFixture.revisionId, paddedSourceLogoFixture.revisionId)) }
    : file)
};
const sourceCroppedLogoBrowser = await runArtifactBrowserGate({
  prepared: sourceCroppedLogoPrepared,
  buildInput: paddedSourceLogoFixture.buildInput,
  blobStore: paddedSourceLogoFixture.blobStore,
  capturePrefix: "verification/site-authoring-render-source-logo-crop",
  routePaths: ["/"],
  viewports: [{ name: "desktop", width: 1280, height: 900 }]
});
assert(
  sourceCroppedLogoBrowser.findings.some((finding) =>
    finding.id === "render.clipping_overlap" && finding.message.includes("cropped-brand-logo")),
  "Translated cropping of a prepared source logo was incorrectly exempted from overflow verification."
);

const officialLogoRevisionId = "asset_revision_official_logo";
const officialLogoStorageKey = "verification/assets/official-logo.png";
const officialLogoContentHash = sha256(paddedLogoPng);
const officialLogoBuildInput = {
  ...buildInput,
  business: {
    ...buildInput.business,
    assets: [{
      assetId: "asset_official_logo",
      revisionId: officialLogoRevisionId,
      kind: "logo" as const,
      contentHash: officialLogoContentHash,
      storageKey: officialLogoStorageKey,
      mimeType: "image/png" as const,
      alt: "Northstar Collision Repair logo",
      width: 150,
      height: 150,
      origin: "source_website" as const,
      sourceFactIds: [],
      activeForFutureBuilds: true
    }]
  },
  assetRevisionIds: [officialLogoRevisionId]
};
const officialLogoBlobStore = new MemoryBlobStore();
await officialLogoBlobStore.putImmutable({
  key: officialLogoStorageKey,
  bytes: paddedLogoPng,
  contentType: "image/png",
  contentHash: officialLogoContentHash
});
const missingOfficialLogoBrowser = await runArtifactBrowserGate({
  prepared,
  buildInput: officialLogoBuildInput,
  blobStore: officialLogoBlobStore,
  capturePrefix: "verification/site-authoring-render-missing-official-logo",
  routePaths: ["/"]
});
assert(
  missingOfficialLogoBrowser.findings.some((finding) =>
    finding.id === "render.primary_logo_missing"
    && finding.severity === "warning"
    && finding.message.includes("active logo-classified asset revision")
    && finding.message.includes("Judge the asset by its pixels")),
  "A homepage that ignored an active logo-classified asset escaped the pixel-aware retained-brand advisory."
);
const renderedOfficialLogoMarkup = `<img class="masthead-art" alt="Northstar Collision Repair" src="/_lodesta/assets/${officialLogoRevisionId}" style="display:block;width:150px;height:60px;object-fit:contain">`;
const renderedOfficialLogoPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("<header>", `<header>${renderedOfficialLogoMarkup}`) }
    : route),
  files: prepared.files.map((file) => {
    if (file.path !== "index.html") return file;
    return { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("<header>", `<header>${renderedOfficialLogoMarkup}`)) };
  })
};
const renderedOfficialLogoBrowser = await runArtifactBrowserGate({
  prepared: renderedOfficialLogoPrepared,
  buildInput: officialLogoBuildInput,
  blobStore: officialLogoBlobStore,
  capturePrefix: "verification/site-authoring-render-official-logo",
  routePaths: ["/"]
});
assert(
  !renderedOfficialLogoBrowser.findings.some((finding) => finding.id === "render.primary_logo_missing"),
  "The retained-brand advisory did not recognize a visible exact official logo asset."
);

const transparentDarkLogoPng = await sharp({
  create: { width: 180, height: 72, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
}).composite([{
  input: Buffer.from('<svg width="180" height="72" xmlns="http://www.w3.org/2000/svg"><rect x="8" y="12" width="36" height="48" rx="8" fill="#263f35"/><rect x="54" y="22" width="116" height="12" rx="3" fill="#263f35"/><rect x="54" y="40" width="88" height="10" rx="3" fill="#263f35"/></svg>')
}]).png().toBuffer();
const darkSourceLogoFixture = await canonicalLogoFixture(transparentDarkLogoPng, "source_website", "dark-source");
const lowContrastLogoMarkup = `<img class="masthead-art" alt="Northstar Collision Repair" src="/_lodesta/assets/${darkSourceLogoFixture.revisionId}" style="display:block;width:180px;height:72px;object-fit:contain">`;
const lowContrastLogoPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("<header>", `<header style="background:#20382f">${lowContrastLogoMarkup}`) }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("<header>", `<header style="background:#20382f">${lowContrastLogoMarkup}`)) }
    : file)
};
const lowContrastLogoBrowser = await runArtifactBrowserGate({
  prepared: lowContrastLogoPrepared,
  buildInput: darkSourceLogoFixture.buildInput,
  blobStore: darkSourceLogoFixture.blobStore,
  capturePrefix: "verification/site-authoring-render-low-contrast-logo",
  routePaths: ["/"],
  captureMode: "review",
  viewports: [{ name: "desktop", width: 1280, height: 900 }]
});
const lowContrastLogoFinding = lowContrastLogoBrowser.findings.find((finding) => finding.id === "render.primary_logo_surface_contrast");
assert(
  lowContrastLogoFinding?.severity === "warning"
    && lowContrastLogoFinding.message.includes("masthead-art")
    && lowContrastLogoFinding.message.includes("median pixel contrast")
    && lowContrastLogoFinding.message.includes("Keep the exact supplied mark unchanged"),
  `A dark transparent logo on a dark header escaped the pixel-level surface advisory: ${lowContrastLogoBrowser.findings.map((finding) => `${finding.id}:${finding.message}`).join(" | ")}`
);
const compatibleLogoPrepared = {
  ...lowContrastLogoPrepared,
  routes: lowContrastLogoPrepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("background:#20382f", "background:#f7f4ee") }
    : route),
  files: lowContrastLogoPrepared.files.map((file) => file.path === "index.html"
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("background:#20382f", "background:#f7f4ee")) }
    : file)
};
const compatibleLogoBrowser = await runArtifactBrowserGate({
  prepared: compatibleLogoPrepared,
  buildInput: darkSourceLogoFixture.buildInput,
  blobStore: darkSourceLogoFixture.blobStore,
  capturePrefix: "verification/site-authoring-render-compatible-logo",
  routePaths: ["/"],
  captureMode: "review",
  viewports: [{ name: "desktop", width: 1280, height: 900 }]
});
assert(
  !compatibleLogoBrowser.findings.some((finding) => finding.id === "render.primary_logo_surface_contrast"),
  "A dark logo on a compatible light surface was incorrectly reported as visually lost."
);

const canonicalPortalUrl = "https://northstar.fieldportals.com/";
const portalBuildInput = {
  ...buildInput,
  business: {
    ...buildInput.business,
    links: [{
      id: "link_customer_portal",
      kind: "other" as const,
      label: "Customer Login",
      url: canonicalPortalUrl,
      publicEligible: true,
      sourceFactIds: ["fact_customer_portal"]
    }]
  }
};
const wrongPortalPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</nav>", '<a href="https://northstar.example/">Customer portal</a></nav>') }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</nav>", '<a href="https://northstar.example/">Customer portal</a></nav>')) }
    : file)
};
const wrongPortalBrowser = await runArtifactBrowserGate({
  prepared: wrongPortalPrepared,
  buildInput: portalBuildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-wrong-canonical-portal",
  routePaths: ["/"]
});
const wrongPortalFinding = wrongPortalBrowser.findings.find((finding) => finding.id === "functional.canonical_link");
assert(
  wrongPortalFinding?.severity === "error"
    && isTechnicalReleaseBlocker(wrongPortalFinding)
    && wrongPortalFinding.message.includes(canonicalPortalUrl),
  "A customer-portal label pointing at the source homepage did not fail the exact canonical-link gate."
);

const footerOnlyPortalPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("<footer>", `<footer style="margin-top:150vh"><a href="${canonicalPortalUrl}">Customer login</a>`) }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("<footer>", `<footer style="margin-top:150vh"><a href="${canonicalPortalUrl}">Customer login</a>`)) }
    : file)
};
const footerOnlyPortalBrowser = await runArtifactBrowserGate({
  prepared: footerOnlyPortalPrepared,
  buildInput: portalBuildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-footer-only-mobile-portal",
  routePaths: ["/"]
});
const mobilePortalFinding = footerOnlyPortalBrowser.findings.find((finding) =>
  finding.id === "functional.canonical_link" && finding.message.includes("mobile experience"));
assert(
  mobilePortalFinding?.severity === "error" && isTechnicalReleaseBlocker(mobilePortalFinding),
  `A canonical customer portal available only below the mobile fold escaped the functional release gate: ${footerOnlyPortalBrowser.findings
    .map((finding) => `${finding.id}:${finding.severity}:${finding.message}`)
    .join(" | ")}`
);

const headerPortalPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</nav>", `<a href="${canonicalPortalUrl}">Customer login</a></nav>`) }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</nav>", `<a href="${canonicalPortalUrl}">Customer login</a></nav>`)) }
    : file)
};
const headerPortalBrowser = await runArtifactBrowserGate({
  prepared: headerPortalPrepared,
  buildInput: portalBuildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-mobile-portal",
  routePaths: ["/"]
});
assert(
  !headerPortalBrowser.findings.some((finding) =>
    finding.id === "functional.canonical_link" && finding.message.includes("mobile experience")),
  "A visible exact customer portal in the mobile primary navigation was incorrectly rejected."
);

const placeholderLinkPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</nav>", '<a href="#">Customer login</a></nav>') }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</nav>", '<a href="#">Customer login</a></nav>')) }
    : file)
};
const placeholderLinkBrowser = await runArtifactBrowserGate({
  prepared: placeholderLinkPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-placeholder-link",
  routePaths: ["/"]
});
const placeholderLinkFinding = placeholderLinkBrowser.findings.find((finding) =>
  finding.id === "link.rendered" && finding.message.includes(": #"));
assert(
  placeholderLinkFinding?.severity === "error" && isTechnicalReleaseBlocker(placeholderLinkFinding),
  "A rendered placeholder href was not treated as a functional release blocker."
);

const missingAriaReferencePrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</main>", '<section aria-labelledby="missing-section-title"><p>Section copy</p></section></main>') }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</main>", '<section aria-labelledby="missing-section-title"><p>Section copy</p></section></main>')) }
    : file)
};
const missingAriaReferenceBrowser = await runArtifactBrowserGate({
  prepared: missingAriaReferencePrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-missing-aria-reference",
  routePaths: ["/"]
});
const missingAriaReferenceFinding = missingAriaReferenceBrowser.findings.find((finding) =>
  finding.id === "functional.aria_reference");
assert(
  missingAriaReferenceFinding?.severity === "error"
    && isTechnicalReleaseBlocker(missingAriaReferenceFinding)
    && missingAriaReferenceFinding.message.includes("missing-section-title"),
  "A rendered ARIA relationship targeting a missing element ID was not treated as a functional release blocker."
);

const missingFragmentTargetPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</main>", '<a href="#missing-contact">Contact section</a></main>') }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</main>", '<a href="#missing-contact">Contact section</a></main>')) }
    : file)
};
const missingFragmentTargetBrowser = await runArtifactBrowserGate({
  prepared: missingFragmentTargetPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-missing-fragment-target",
  routePaths: ["/"]
});
const missingFragmentTargetFinding = missingFragmentTargetBrowser.findings.find((finding) =>
  finding.id === "functional.fragment_target");
assert(
  missingFragmentTargetFinding?.severity === "error"
    && isTechnicalReleaseBlocker(missingFragmentTargetFinding)
    && missingFragmentTargetFinding.message.includes("#missing-contact"),
  "A same-page link targeting a missing fragment ID was not treated as a functional release blocker."
);

const undersizedFormPrepared = {
  ...prepared,
  files: prepared.files.map((file) => file.path === "site.css"
    ? { ...file, bytes: Buffer.from(`${file.bytes.toString("utf8")}\nform label,form input,form textarea,form button{font-size:13px}input,textarea{min-height:0;height:31px;padding:0}`) }
    : file)
};
const undersizedFormBrowser = await runArtifactBrowserGate({
  prepared: undersizedFormPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-undersized-form",
  routePaths: ["/contact"]
});
const undersizedFormFinding = undersizedFormBrowser.findings.find((finding) =>
  finding.id === "render.target_size"
  && finding.message.includes("input")
  && finding.message.includes("31px")
  && /input[^\"]* \"[^\"]+\"/.test(finding.message));
assert(
  undersizedFormFinding?.severity === "warning",
  "Rendered form fields below 44px escaped the actionable target-size advisory."
);
const undersizedFormTextFinding = undersizedFormBrowser.findings.find((finding) =>
  finding.id === "render.form_text" && finding.message.includes("13px"));
assert(
  undersizedFormTextFinding?.severity === "warning",
  "Rendered form text below 16px escaped the dedicated form-text advisory."
);

const oversizedSingleLineFieldPrepared = {
  ...prepared,
  files: prepared.files.map((file) => file.path === "site.css"
    ? { ...file, bytes: Buffer.from(`${file.bytes.toString("utf8")}\ninput[type=tel]{height:144px}`) }
    : file)
};
const oversizedSingleLineFieldBrowser = await runArtifactBrowserGate({
  prepared: oversizedSingleLineFieldPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-oversized-single-line-field",
  routePaths: ["/contact"]
});
const oversizedSingleLineFieldFinding = oversizedSingleLineFieldBrowser.findings.find((finding) =>
  finding.id === "render.oversized_single_line_field" && finding.message.includes("144px tall"));
assert(
  oversizedSingleLineFieldFinding?.severity === "warning" && !isTechnicalReleaseBlocker(oversizedSingleLineFieldFinding),
  "A single-line field styled like a textarea escaped the component-quality advisory."
);

const duplicateFirstFieldLabel = (html: string) => html.replace(
  /(<label\b[^>]*\bfor="[^"]+"[^>]*>[\s\S]*?<\/label>)/i,
  "$1$1"
);
const duplicateFieldLabelPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/contact"
    ? { ...route, html: duplicateFirstFieldLabel(route.html) }
    : route),
  files: prepared.files.map((file) => file.path === "contact/index.html"
    ? { ...file, bytes: Buffer.from(duplicateFirstFieldLabel(file.bytes.toString("utf8"))) }
    : file)
};
const duplicateFieldLabelBrowser = await runArtifactBrowserGate({
  prepared: duplicateFieldLabelPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-duplicate-field-label",
  routePaths: ["/contact"]
});
const duplicateFieldLabelFinding = duplicateFieldLabelBrowser.findings.find((finding) =>
  finding.id === "render.duplicate_field_label" && finding.message.includes("form field"));
assert(
  duplicateFieldLabelFinding?.severity === "warning" && !isTechnicalReleaseBlocker(duplicateFieldLabelFinding),
  "A form field with two visible labels escaped the duplicate-label quality advisory."
);

const narrowMediaSplitMarkup = '<section class="narrow-media-split"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt=""><div><h2>Good work should leave room for good things.</h2><p>A complete thought belongs beside the visual.</p></div></section>';
const narrowMediaSplitPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</main>", `${narrowMediaSplitMarkup}</main>`) }
    : route),
  files: prepared.files.map((file) => {
    if (file.path === "index.html") {
      return { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</main>", `${narrowMediaSplitMarkup}</main>`)) };
    }
    return file.path === "site.css"
      ? { ...file, bytes: Buffer.from(`${file.bytes.toString("utf8")}\n.narrow-media-split{display:grid;grid-template-columns:40% 1fr;gap:12px}.narrow-media-split img{width:100%;height:320px;object-fit:cover}.narrow-media-split h2{font-size:36px;line-height:1}`) }
      : file;
  })
};
const narrowMediaSplitBrowser = await runArtifactBrowserGate({
  prepared: narrowMediaSplitPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-narrow-media-split",
  routePaths: ["/"]
});
const narrowMediaSplitFinding = narrowMediaSplitBrowser.findings.find((finding) => finding.id === "render.mobile_narrow_split");
assert(
  narrowMediaSplitFinding?.severity === "warning" && narrowMediaSplitFinding.message.includes("Good work should leave"),
  "A squeezed mobile heading-and-media split escaped the composition advisory."
);

const narrowTextSplitMarkup = '<section class="narrow-text-split"><div><h2>A clearer response to what is happening at home</h2><p>The first column carries the main explanation.</p></div><div class="narrow-text-peer"><strong>Thorough inspection</strong><p>Identify activity and entry points.</p><strong>Specific treatment</strong><p>Focus on the pest and the property.</p></div></section>';
const narrowTextSplitPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</main>", `${narrowTextSplitMarkup}</main>`) }
    : route),
  files: prepared.files.map((file) => {
    if (file.path === "index.html") {
      return { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</main>", `${narrowTextSplitMarkup}</main>`)) };
    }
    return file.path === "site.css"
      ? { ...file, bytes: Buffer.from(`${file.bytes.toString("utf8")}\n.narrow-text-split{display:grid;grid-template-columns:1fr 1fr;gap:45px;padding:24px}.narrow-text-split h2{font-size:36px;line-height:1.05}.narrow-text-peer{display:grid;gap:8px}`) }
      : file;
  })
};
const narrowTextSplitBrowser = await runArtifactBrowserGate({
  prepared: narrowTextSplitPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-narrow-text-split",
  routePaths: ["/"],
  viewports: [{ name: "mobile", width: 375, height: 812 }]
});
const narrowTextSplitFinding = narrowTextSplitBrowser.findings.find((finding) => finding.id === "render.mobile_narrow_split");
assert(
  narrowTextSplitFinding?.severity === "warning"
    && narrowTextSplitFinding.message.includes("A clearer response")
    && narrowTextSplitFinding.message.includes("text column"),
  "A squeezed mobile text-versus-text split escaped the composition advisory."
);

const longMobileCardWallMarkup = `<section class="long-mobile-card-wall">${Array.from({ length: 8 }, (_, index) => `<article><h3>Service ${index + 1}</h3><p>Focused local service information with enough repeated descriptive copy to turn this catalog into a long undifferentiated phone wall.</p></article>`).join("")}</section>`;
const longMobileCardWallPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</main>", `${longMobileCardWallMarkup}</main>`) }
    : route),
  files: prepared.files.map((file) => {
    if (file.path === "index.html") {
      return { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</main>", `${longMobileCardWallMarkup}</main>`)) };
    }
    return file.path === "site.css"
      ? { ...file, bytes: Buffer.from(`${file.bytes.toString("utf8")}\n.long-mobile-card-wall{display:grid;gap:14px;padding:14px}.long-mobile-card-wall article{min-height:180px;padding:20px;border:1px solid #bbb}.long-mobile-card-wall p{font-size:16px;line-height:1.5}`) }
      : file;
  })
};
const longMobileCardWallBrowser = await runArtifactBrowserGate({
  prepared: longMobileCardWallPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-long-mobile-card-wall",
  routePaths: ["/"],
  viewports: [{ name: "mobile", width: 375, height: 812 }]
});
const longMobileCardWallFinding = longMobileCardWallBrowser.findings.find((finding) => finding.id === "render.mobile_inventory_wall");
assert(
  longMobileCardWallFinding?.severity === "warning"
    && longMobileCardWallFinding.message.includes("8 full-width descriptive cards"),
  "A multi-viewport homepage card inventory wall escaped the mobile hierarchy advisory."
);

const fragmentedHeadingMarkup = '<section class="fragmented-heading"><h2>Good care for the places you call home.</h2><p>This column intentionally has no adjacent media.</p></section>';
const fragmentedHeadingPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</main>", `${fragmentedHeadingMarkup}</main>`) }
    : route),
  files: prepared.files.map((file) => {
    if (file.path === "index.html") {
      return { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</main>", `${fragmentedHeadingMarkup}</main>`)) };
    }
    return file.path === "site.css"
      ? { ...file, bytes: Buffer.from(`${file.bytes.toString("utf8")}\n.fragmented-heading{display:grid;grid-template-columns:64px 1fr;gap:18px}.fragmented-heading h2{width:24px;font-size:42px;line-height:1;overflow-wrap:anywhere}`) }
      : file;
  })
};
const fragmentedHeadingBrowser = await runArtifactBrowserGate({
  prepared: fragmentedHeadingPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-fragmented-heading",
  routePaths: ["/"]
});
const fragmentedHeadingFinding = fragmentedHeadingBrowser.findings.find((finding) => finding.id === "functional.mobile_heading_measure");
assert(
  fragmentedHeadingFinding?.severity === "error" && fragmentedHeadingFinding.message.includes("Good care for the places"),
  "A heading collapsed into one- and two-character mobile fragments escaped the functional readable-measure gate."
);

const fragmentedBodyMarkup = '<section class="fragmented-body"><h2>Wallpaper removal</h2><ol><li><strong>Protect the room.</strong> Cover floors and account for runoff before working on a wall.</li></ol></section>';
const fragmentedBodyPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</main>", `${fragmentedBodyMarkup}</main>`) }
    : route),
  files: prepared.files.map((file) => {
    if (file.path === "index.html") {
      return { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</main>", `${fragmentedBodyMarkup}</main>`)) };
    }
    return file.path === "site.css"
      ? { ...file, bytes: Buffer.from(`${file.bytes.toString("utf8")}\n.fragmented-body ol{list-style:none}.fragmented-body li{display:grid;grid-template-columns:2.5rem 1fr;gap:.8rem}.fragmented-body li:before{content:'01'}.fragmented-body li strong{display:block}`) }
      : file;
  })
};
const fragmentedBodyBrowser = await runArtifactBrowserGate({
  prepared: fragmentedBodyPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-fragmented-body",
  routePaths: ["/"],
  viewports: [
    { name: "desktop", width: 1280, height: 900 },
    { name: "mobile", width: 390, height: 844 }
  ]
});
const fragmentedBodyFinding = fragmentedBodyBrowser.findings.find((finding) => finding.id === "functional.text_measure");
assert(
  fragmentedBodyFinding?.severity === "error"
    && fragmentedBodyFinding.message.includes("Cover floors")
    && isTechnicalReleaseBlocker(fragmentedBodyFinding),
  `Anonymous grid text collapsed into an unreadable strip escaped the functional readable-measure gate: ${JSON.stringify(fragmentedBodyBrowser.findings)}`
);

const mediaContainerOverflowMarkup = '<section class="overflowing-media"><div class="overflowing-media-frame"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="Technician portrait"></div><div class="overflowing-media-copy"><h2>Good pest control is personal.</h2><p>Adjacent copy must not be painted underneath an overflowing photograph.</p></div></section>';
const mediaContainerOverflowPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</main>", `${mediaContainerOverflowMarkup}</main>`) }
    : route),
  files: prepared.files.map((file) => {
    if (file.path === "index.html") {
      return { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</main>", `${mediaContainerOverflowMarkup}</main>`)) };
    }
    return file.path === "site.css"
      ? { ...file, bytes: Buffer.from(`${file.bytes.toString("utf8")}
.overflowing-media{display:flex;flex-direction:column}.overflowing-media-frame{max-height:320px}.overflowing-media-frame img{display:block;width:100%;height:720px;object-fit:cover}.overflowing-media-copy{padding:40px;background:#e8f0f4}`) }
      : file;
  })
};
const mediaContainerOverflowBrowser = await runArtifactBrowserGate({
  prepared: mediaContainerOverflowPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-media-container-overflow",
  routePaths: ["/"],
  captureMode: "review"
});
const mediaContainerOverflowFinding = mediaContainerOverflowBrowser.findings.find((finding) =>
  finding.id === "render.media_container_overflow" && finding.message.includes("tablet"));
assert(
  mediaContainerOverflowFinding?.severity === "warning"
    && mediaContainerOverflowFinding.message.includes("overflowing-media-frame")
    && !isTechnicalReleaseBlocker(mediaContainerOverflowFinding),
  "An in-flow tablet photograph painting underneath adjacent copy escaped the media-container overflow advisory."
);

const transparentServiceGraphic = await sharp(Buffer.from(`
  <svg width="560" height="365" xmlns="http://www.w3.org/2000/svg">
    <circle cx="42" cy="90" r="38" fill="#c65d2e"/><text x="4" y="160" font-size="30" fill="#17211b">Ants</text>
    <circle cx="518" cy="90" r="38" fill="#315a46"/><text x="452" y="160" font-size="30" fill="#17211b">Termites</text>
    <circle cx="42" cy="270" r="38" fill="#315a46"/><text x="4" y="350" font-size="30" fill="#17211b">Fleas</text>
    <circle cx="518" cy="270" r="38" fill="#c65d2e"/><text x="438" y="350" font-size="30" fill="#17211b">Spiders</text>
  </svg>
`)).png().toBuffer();
const croppedTransparentGraphicMarkup = `<section class="cropped-service-graphic"><img src="data:image/png;base64,${transparentServiceGraphic.toString("base64")}" alt="Pest service categories"></section>`;
const croppedTransparentGraphicPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</main>", `${croppedTransparentGraphicMarkup}</main>`) }
    : route),
  files: prepared.files.map((file) => {
    if (file.path === "index.html") {
      return { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</main>", `${croppedTransparentGraphicMarkup}</main>`)) };
    }
    return file.path === "site.css"
      ? { ...file, bytes: Buffer.from(`${file.bytes.toString("utf8")}
.cropped-service-graphic{width:340px;height:300px}.cropped-service-graphic img{display:block;width:100%;height:100%;object-fit:cover}`) }
      : file;
  })
};
const croppedTransparentGraphicBrowser = await runArtifactBrowserGate({
  prepared: croppedTransparentGraphicPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-cropped-transparent-graphic",
  routePaths: ["/"]
});
const croppedTransparentGraphicFinding = croppedTransparentGraphicBrowser.findings.find((finding) =>
  finding.id === "render.informational_graphic_crop");
assert(
  croppedTransparentGraphicFinding?.severity === "warning"
    && croppedTransparentGraphicFinding.message.includes("crops 26% of its source width")
    && croppedTransparentGraphicFinding.message.includes("opaque edge pixels")
    && !isTechnicalReleaseBlocker(croppedTransparentGraphicFinding),
  "A transparent labeled service graphic losing opaque edge content through object-fit cover escaped the crop advisory."
);

const primaryHeadingDecorationMarkup = '<section class="primary-heading-decoration"><h1>Keep pests out.<br><em>Keep it tentless.</em></h1></section>';
const primaryHeadingDecorationPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</main>", `${primaryHeadingDecorationMarkup}</main>`) }
    : route),
  files: prepared.files.map((file) => {
    if (file.path === "index.html") {
      return { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</main>", `${primaryHeadingDecorationMarkup}</main>`)) };
    }
    return file.path === "site.css"
      ? { ...file, bytes: Buffer.from(`${file.bytes.toString("utf8")}
.primary-heading-decoration{position:relative;overflow:hidden;background:#171614;color:#fff;padding:32px;width:375px}.primary-heading-decoration h1{position:relative;font-size:58px;line-height:1;z-index:1}.primary-heading-decoration h1 em{color:#f4511e}.primary-heading-decoration::after{content:"";position:absolute;width:210px;height:210px;right:-90px;top:48px;background:#f4511e;transform:rotate(18deg)}`) }
      : file;
  })
};
const primaryHeadingDecorationBrowser = await runArtifactBrowserGate({
  prepared: primaryHeadingDecorationPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-primary-heading-decoration",
  routePaths: ["/"],
  viewports: [{ name: "mobile", width: 375, height: 812 }]
});
const primaryHeadingDecorationFinding = primaryHeadingDecorationBrowser.findings.find((finding) =>
  finding.id === "render.text_surface_boundary" && finding.message.includes("Keep pests out. Keep it tentless"));
assert(
  primaryHeadingDecorationFinding
    && !isTechnicalReleaseBlocker(primaryHeadingDecorationFinding),
  `A low-contrast primary-heading fragment crossing a decorative pseudo-element escaped the rendered advisory: ${JSON.stringify(primaryHeadingDecorationBrowser.findings)}`
);

const headerBrandCollisionMarkup = '<div class="header-utility-collision-fixture"><span>Thoughtful pest control for Raleigh NC</span></div>';
const headerBrandCollisionLogo = '<img class="header-overlap-logo-fixture" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="Official business logo">';
const headerBrandCollisionPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("<header", `${headerBrandCollisionMarkup}<header`).replace("</header>", `${headerBrandCollisionLogo}</header>`) }
    : route),
  files: prepared.files.map((file) => {
    if (file.path === "index.html") {
      return { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("<header", `${headerBrandCollisionMarkup}<header`).replace("</header>", `${headerBrandCollisionLogo}</header>`)) };
    }
    return file.path === "site.css"
      ? { ...file, bytes: Buffer.from(`${file.bytes.toString("utf8")}
.header-utility-collision-fixture{height:34px;padding-left:18px;background:#17342a;color:white}.header-utility-collision-fixture span{display:block;line-height:34px}.header-overlap-logo-fixture{position:absolute;left:0;top:-34px;width:180px;height:130px;background:white}`) }
      : file;
  })
};
const headerBrandCollisionBrowser = await runArtifactBrowserGate({
  prepared: headerBrandCollisionPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-header-brand-collision",
  routePaths: ["/"],
  viewports: [{ name: "desktop", width: 1280, height: 800 }]
});
const headerBrandCollisionFinding = headerBrandCollisionBrowser.findings.find((finding) =>
  finding.id === "render.header_brand_collision");
assert(
  headerBrandCollisionFinding?.severity === "warning"
    && headerBrandCollisionFinding.message.includes("header-overlap-logo-fixture")
    && headerBrandCollisionFinding.message.includes("Thoughtful pest control for Raleigh NC")
    && !isTechnicalReleaseBlocker(headerBrandCollisionFinding),
  `A header logo covering utility text escaped the brand-layout advisory: ${headerBrandCollisionFinding?.message ?? "missing finding"}`
);

const headerContentOcclusionMarkup = '<p class="header-content-occlusion-fixture">Pest control, thoughtfully done</p>';
const headerContentOcclusionPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("<main>", `<main>${headerContentOcclusionMarkup}`) }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("<main>", `<main>${headerContentOcclusionMarkup}`)) }
    : file.path === "site.css"
      ? { ...file, bytes: Buffer.from(`${file.bytes.toString("utf8")}
header{position:absolute!important;inset:0 0 auto 0!important;z-index:20!important;height:130px!important;background:#17342a!important}.header-content-occlusion-fixture{position:absolute;left:24px;top:112px;z-index:1;margin:0;color:#fff;font-size:16px;line-height:24px}`) }
      : file)
};
const headerContentOcclusionBrowser = await runArtifactBrowserGate({
  prepared: headerContentOcclusionPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-header-content-occlusion",
  routePaths: ["/"],
  viewports: [{ name: "mobile", width: 375, height: 812 }]
});
const headerContentOcclusionFinding = headerContentOcclusionBrowser.findings.find((finding) =>
  finding.id === "render.header_content_occlusion");
assert(
  headerContentOcclusionFinding?.severity === "warning"
    && headerContentOcclusionFinding.message.includes("Pest control, thoughtfully done")
    && !isTechnicalReleaseBlocker(headerContentOcclusionFinding),
  `Main-content text covered by a header escaped the rendered advisory: ${headerContentOcclusionFinding?.message ?? "missing finding"}`
);

const articleHeaderPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("<main>", '<main><article><header class="article-header-fixture"><p>Guide</p><h1>How to keep pests outside</h1></header></article>') }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("<main>", '<main><article><header class="article-header-fixture"><p>Guide</p><h1>How to keep pests outside</h1></header></article>')) }
    : file.path === "site.css"
      ? { ...file, bytes: Buffer.from(`${file.bytes.toString("utf8")}\n.article-header-fixture{position:relative;padding:48px 24px;background:#f4f1e9}`) }
      : file)
};
const articleHeaderBrowser = await runArtifactBrowserGate({
  prepared: articleHeaderPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-article-header",
  routePaths: ["/"],
  viewports: [{ name: "mobile", width: 375, height: 812 }]
});
assert(
  !articleHeaderBrowser.findings.some((finding) => finding.id === "render.header_content_occlusion"),
  "An article header inside main was mistaken for page-level chrome and reported as covering its own content."
);

const syntheticIdentityAndRepeatedImageMarkup = `<section class="identity-device-fixture"><a class="wordmark-dot-fixture" href="#">24 Seven Pest Control</a><img class="official-brand-logo" src="/_lodesta/assets/${paddedSourceLogoFixture.revisionId}" alt="Northstar Collision"><div class="compact-brand-stamp">SURGE<br><span>PEST CONTROL</span></div><div class="area-stamp" aria-hidden="true"><span>TX</span><small>Local service</small></div><div class="approach-stamp" aria-hidden="true"><span>Kind</span><span>by nature</span></div><div class="approach-marker" aria-hidden="true"><span>K</span></div><div class="aside-mark" aria-hidden="true">✳</div><div class="evidence-free-marker" aria-hidden="true" style="position:relative;width:156px;height:156px;border:1px solid #1266a6"><i></i></div><div class="hero-mark-fixture" aria-hidden="true"><span class="mark-line-fixture"></span><span class="mark-leaf-fixture">⌁</span><small>Care for your space, without the guesswork.</small></div><div class="leaf-shape" aria-hidden="true"><span>kind. by design</span></div><div class="art-panel"><span>Kind by nature</span><span class="art-number">01</span><p>Clean, green, and effective.</p></div><div class="hero-visual-word-poster"><div class="hero-visual-word">kind<span>.</span></div></div><div class="logo-poster-mark"><span>The Kind Difference</span><img class="poster-business-logo" src="/_lodesta/assets/${paddedSourceLogoFixture.revisionId}" alt="Collision repair"><span class="logo-poster-number">01</span><small>People · Earth · Pet</small></div><img class="first-proof-photo" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="Technician at work"></section><section class="geography-orbit-fixture"><p>For homes in Austin and nearby communities.</p></section><div class="decorative-orbit-art" aria-hidden="true"><span>care</span></div><div class="decorative-shadow-rings"><span>kind.</span></div><div class="hero-mark-two-rings"><span class="hero-ring-one"></span><span class="hero-ring-two"></span><div>Start with the signs.</div></div><section class="hero-fixture"><h2>A clearer way home</h2></section><section class="false-affordance-list"><article class="service-row-fixture"><h3>Ant control</h3><span class="row-mark-fixture" aria-hidden="true">+</span></article><article class="service-row-fixture"><h3>Termite control</h3><span class="row-mark-fixture" aria-hidden="true">+</span></article><article class="service-row-fixture"><h3>Mosquito control</h3><span class="row-mark-fixture" aria-hidden="true">+</span></article></section><div class="fake-search-fixture">Search by state or city ↗</div><section class="repeated-photo-fixture"><img class="second-proof-photo" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="Technician at work"></section>`;
const duplicateHeaderActionMarkup = '<a class="header-cta-fixture" href="/contact">Contact ↗</a><button class="desktop-dual-nav-fixture" type="button" data-lodesta-menu-toggle aria-controls="desktop-menu-fixture" aria-label="Open navigation">Menu</button><div id="desktop-menu-fixture" hidden></div>';
const syntheticIdentityAndRepeatedImagePrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</header>", `${duplicateHeaderActionMarkup}</header>`).replace("</main>", `${syntheticIdentityAndRepeatedImageMarkup}</main>`) }
    : route),
  files: prepared.files.map((file) => {
    if (file.path === "index.html") {
      return { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</header>", `${duplicateHeaderActionMarkup}</header>`).replace("</main>", `${syntheticIdentityAndRepeatedImageMarkup}</main>`)) };
    }
    return file.path === "site.css"
      ? { ...file, bytes: Buffer.from(`${file.bytes.toString("utf8")}
.identity-device-fixture,.geography-orbit-fixture,.repeated-photo-fixture{position:relative;padding:40px}.desktop-dual-nav-fixture{display:none}@media(min-width:900px){.desktop-dual-nav-fixture{display:block}}.wordmark-dot-fixture{display:inline-flex;align-items:center}.wordmark-dot-fixture::before{content:"";display:inline-block;width:10px;height:10px;margin-right:9px;background:#d9ed72;border-radius:50%}.official-brand-logo{display:block;width:120px;height:60px}.compact-brand-stamp{display:grid;width:130px;height:55px;place-items:center;background:#ffcc00;font-size:15px;line-height:1;transform:rotate(-5deg)}.compact-brand-stamp span{font-size:12px}.area-stamp,.approach-stamp{display:grid;width:180px;aspect-ratio:1;place-items:center;border:1px solid #1266a6;border-radius:50%;transform:rotate(-8deg)}.area-stamp span{font-size:64px}.approach-stamp{font-size:14px;width:118px}.approach-marker{display:grid;width:132px;height:132px;place-items:center;border:1px solid #1266a6;font-size:72px}.aside-mark{font-size:180px;line-height:.8;color:#5bc681}.hero-mark-fixture{display:grid;width:300px;height:300px;place-items:center;border-radius:50%;background:#dcebdd}.mark-line-fixture{width:58px;height:116px;border:1px solid #1266a6;border-bottom:0;border-radius:80% 20% 0 0;transform:rotate(24deg)}.mark-leaf-fixture{font-size:58px;transform:rotate(-30deg)}.leaf-shape{display:grid;place-items:center;width:250px;height:300px;background:#087b3d;color:white;border-radius:80% 20% 70% 30%;font-size:50px;transform:rotate(-26deg)}.art-panel{display:flex;flex-direction:column;justify-content:space-between;width:225px;height:280px;padding:22px;background:#1266a6;color:white;transform:rotate(-7deg)}.art-number{font-size:90px}.hero-visual-word-poster{display:grid;width:300px;height:300px;place-items:center;background:#1266a6}.hero-visual-word{font-size:120px}.logo-poster-mark{display:grid;width:300px;height:300px;place-items:center;border:1px solid #1266a6;background:#f2f3e8}.logo-poster-mark img{display:block;width:180px;height:90px}.logo-poster-number{font-size:72px}.geography-orbit-fixture{min-height:360px}.geography-orbit-fixture::after{content:"";position:absolute;width:300px;height:300px;inset:20px auto auto 20px;border:1px solid #1266a6;border-radius:50%;pointer-events:none}.decorative-orbit-art,.decorative-shadow-rings{position:relative;display:grid;width:320px;height:320px;place-items:center;border:1px solid #1266a6;border-radius:50%;font-size:64px}.decorative-orbit-art::before,.decorative-orbit-art::after,.decorative-shadow-rings::after,.hero-fixture::before,.hero-fixture::after{content:"";position:absolute;border:1px solid #1266a6;border-radius:50%}.decorative-orbit-art::before{inset:36px}.decorative-orbit-art::after{inset:72px}.decorative-shadow-rings::after{width:220px;height:220px;box-shadow:0 0 0 28px rgba(18,102,166,.2),0 0 0 56px rgba(18,102,166,.1)}.hero-mark-two-rings{position:relative;display:grid;place-items:center;width:400px;height:400px}.hero-ring-one,.hero-ring-two{position:absolute;width:390px;height:390px;border:1px solid #1266a6;border-radius:50%}.hero-ring-two{width:280px;height:280px}.hero-fixture{position:relative;min-height:520px}.hero-fixture::before{width:460px;height:460px;right:-160px;top:10px}.hero-fixture::after{width:260px;height:260px;right:20px;top:110px}.false-affordance-list{padding:40px}.service-row-fixture{display:grid;grid-template-columns:1fr auto;align-items:center;min-height:72px;border-bottom:1px solid #999}.row-mark-fixture{font-size:24px}.fake-search-fixture{width:320px;min-height:56px;padding:12px;border:1px solid #999}.first-proof-photo,.second-proof-photo{display:block;width:240px;height:180px}`) }
      : file;
  })
};
const syntheticIdentityAndRepeatedImageBrowser = await runArtifactBrowserGate({
  prepared: syntheticIdentityAndRepeatedImagePrepared,
  buildInput: paddedSourceLogoFixture.buildInput,
  blobStore: paddedSourceLogoFixture.blobStore,
  capturePrefix: "verification/site-authoring-render-synthetic-identity-repeated-image",
  routePaths: ["/"]
});
const syntheticIdentityDeviceFinding = syntheticIdentityAndRepeatedImageBrowser.findings.find((finding) =>
  finding.id === "render.synthetic_identity_device");
assert(
  syntheticIdentityDeviceFinding?.severity === "warning"
    && syntheticIdentityDeviceFinding.message.includes("area-stamp")
    && syntheticIdentityDeviceFinding.message.includes("TX")
    && syntheticIdentityDeviceFinding.message.includes("approach-stamp")
    && syntheticIdentityDeviceFinding.message.includes("Kind by nature")
    && syntheticIdentityDeviceFinding.message.includes("compact-brand-stamp")
    && syntheticIdentityDeviceFinding.message.includes("SURGE PEST CONTROL")
    && syntheticIdentityDeviceFinding.message.includes("approach-marker")
    && syntheticIdentityDeviceFinding.message.includes('"K"')
    && syntheticIdentityDeviceFinding.message.includes("aside-mark")
    && syntheticIdentityDeviceFinding.message.includes("evidence-free-marker")
    && syntheticIdentityDeviceFinding.message.includes("hero-mark-fixture")
    && syntheticIdentityDeviceFinding.message.includes("without the guesswork")
    && syntheticIdentityDeviceFinding.message.includes("leaf-shape")
    && syntheticIdentityDeviceFinding.message.includes("kind. by design")
    && syntheticIdentityDeviceFinding.message.includes("art-panel")
    && syntheticIdentityDeviceFinding.message.includes("Kind by nature 01 Clean, green, and effective")
    && syntheticIdentityDeviceFinding.message.includes("hero-visual-word-poster")
    && syntheticIdentityDeviceFinding.message.includes("logo-poster-mark")
    && syntheticIdentityDeviceFinding.message.includes("The Kind Difference 01 People · Earth · Pet")
    && !isTechnicalReleaseBlocker(syntheticIdentityDeviceFinding),
  `A text-and-CSS locality or slogan stamp competing with the official identity escaped the brand-fidelity advisory: ${syntheticIdentityDeviceFinding?.message}`
);
const compactAlphanumericMonogramMarkup = '<span class="brand-mark-fixture" aria-hidden="true" style="display:grid;width:38px;height:38px;place-items:center;background:#1266a6;color:#fff">L3</span>';
const compactAlphanumericMonogramPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</main>", `${compactAlphanumericMonogramMarkup}</main>`) }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</main>", `${compactAlphanumericMonogramMarkup}</main>`)) }
    : file)
};
const compactAlphanumericMonogramBrowser = await runArtifactBrowserGate({
  prepared: compactAlphanumericMonogramPrepared,
  buildInput: paddedSourceLogoFixture.buildInput,
  blobStore: paddedSourceLogoFixture.blobStore,
  capturePrefix: "verification/site-authoring-render-compact-alphanumeric-monogram",
  routePaths: ["/"]
});
const compactAlphanumericMonogramFinding = compactAlphanumericMonogramBrowser.findings.find((finding) =>
  finding.id === "render.synthetic_identity_device");
assert(
  compactAlphanumericMonogramFinding?.severity === "warning"
    && compactAlphanumericMonogramFinding.message.includes("brand-mark-fixture")
    && compactAlphanumericMonogramFinding.message.includes('"L3"')
    && !isTechnicalReleaseBlocker(compactAlphanumericMonogramFinding),
  `A compact alphanumeric CSS monogram escaped the identity advisory: ${compactAlphanumericMonogramFinding?.message ?? "missing finding"}`
);
const geographyCircleFinding = syntheticIdentityAndRepeatedImageBrowser.findings.find((finding) =>
  finding.id === "render.geography_circle");
assert(
  geographyCircleFinding?.severity === "warning"
    && geographyCircleFinding.message.includes("geography-orbit-fixture::after")
    && geographyCircleFinding.message.includes("For homes in Austin")
    && !isTechnicalReleaseBlocker(geographyCircleFinding),
  "A large outlined radius framing service-geography language escaped the pseudo-map advisory."
);
const desktopDualNavigationFinding = syntheticIdentityAndRepeatedImageBrowser.findings.find((finding) =>
  finding.id === "render.desktop_dual_navigation");
assert(
  desktopDualNavigationFinding?.severity === "warning"
    && desktopDualNavigationFinding.message.includes("desktop-dual-nav-fixture")
    && !isTechnicalReleaseBlocker(desktopDualNavigationFinding),
  "A mobile disclosure left visible beside a complete desktop navigation escaped the component advisory."
);
const decorativeDiagramFinding = syntheticIdentityAndRepeatedImageBrowser.findings.find((finding) =>
  finding.id === "render.decorative_diagram");
assert(
  decorativeDiagramFinding?.severity === "warning"
    && decorativeDiagramFinding.message.includes("decorative-orbit-art")
    && decorativeDiagramFinding.message.includes("decorative-shadow-rings")
    && decorativeDiagramFinding.message.includes("hero-mark-two-rings")
    && decorativeDiagramFinding.message.includes("outlined circular layers")
    && !isTechnicalReleaseBlocker(decorativeDiagramFinding),
  `A CSS-only concentric orbit graphic with no factual encoding escaped the decorative-diagram advisory: ${decorativeDiagramFinding?.message ?? "missing finding"}`
);

const filledGeographyAndDrawingMarkup = '<div class="filled-geography-circle" aria-hidden="true">NC <span>Triangle</span></div><div class="ant-drawing-fixture" aria-hidden="true"><span></span><span></span><span></span><span></span></div>';
const filledGeographyAndDrawingPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</main>", `${filledGeographyAndDrawingMarkup}</main>`) }
    : route),
  files: prepared.files.map((file) => {
    if (file.path === "index.html") {
      return { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</main>", `${filledGeographyAndDrawingMarkup}</main>`)) };
    }
    return file.path === "site.css"
      ? { ...file, bytes: Buffer.from(`${file.bytes.toString("utf8")}
.filled-geography-circle{display:grid;place-items:center;width:300px;height:300px;border-radius:50%;background:#df8b50;font-size:64px}.filled-geography-circle span{font-size:18px}.ant-drawing-fixture{position:relative;width:320px;height:240px;border:1px solid #1266a6}.ant-drawing-fixture span{position:absolute;width:16px;height:16px;border-radius:50%;background:#df8b50}.ant-drawing-fixture span:nth-child(1){left:20px;top:30px}.ant-drawing-fixture span:nth-child(2){left:80px;top:80px}.ant-drawing-fixture span:nth-child(3){left:150px;top:110px}.ant-drawing-fixture span:nth-child(4){left:230px;top:160px}`) }
      : file;
  })
};
const filledGeographyAndDrawingBrowser = await runArtifactBrowserGate({
  prepared: filledGeographyAndDrawingPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-filled-geography-drawing",
  routePaths: ["/"]
});
const filledGeographyFinding = filledGeographyAndDrawingBrowser.findings.find((finding) =>
  finding.id === "render.geography_circle" && finding.message.includes("filled-geography-circle"));
assert(
  filledGeographyFinding?.severity === "warning" && filledGeographyFinding.message.includes("NC Triangle"),
  "A large filled circle framing a geographic token escaped the geography-device advisory."
);
const positionedDrawingFinding = filledGeographyAndDrawingBrowser.findings.find((finding) =>
  finding.id === "render.decorative_diagram" && finding.message.includes("ant-drawing-fixture"));
assert(
  positionedDrawingFinding?.severity === "warning" && positionedDrawingFinding.message.includes("positioned CSS layers"),
  "An aria-hidden CSS drawing with positioned decorative layers escaped the diagram advisory."
);
const duplicateHeaderActionFinding = syntheticIdentityAndRepeatedImageBrowser.findings.find((finding) =>
  finding.id === "render.duplicate_header_action");
assert(
  duplicateHeaderActionFinding?.severity === "warning"
    && duplicateHeaderActionFinding.message.includes("header-cta-fixture")
    && duplicateHeaderActionFinding.message.includes("Contact")
    && !isTechnicalReleaseBlocker(duplicateHeaderActionFinding),
  "A duplicated header action with the same label and destination escaped the conversion-hierarchy advisory."
);
const utilityDuplicateMarkup = '<div class="utility-duplicate-fixture"><a href="/contact">Contact</a></div>';
const utilityDuplicatePrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("<header", `${utilityDuplicateMarkup}<header`) }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("<header", `${utilityDuplicateMarkup}<header`)) }
    : file)
};
const utilityDuplicateBrowser = await runArtifactBrowserGate({
  prepared: utilityDuplicatePrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-utility-duplicate",
  routePaths: ["/"],
  viewports: [{ name: "desktop", width: 1280, height: 900 }]
});
const utilityDuplicateFinding = utilityDuplicateBrowser.findings.find((finding) =>
  finding.id === "render.duplicate_header_action");
assert(
  utilityDuplicateFinding?.severity === "warning" && utilityDuplicateFinding.message.includes("Contact"),
  `A utility-bar action duplicated in primary navigation escaped the masthead hierarchy advisory: ${JSON.stringify(utilityDuplicateBrowser.findings)}`
);
const falseAffordanceFinding = syntheticIdentityAndRepeatedImageBrowser.findings.find((finding) =>
  finding.id === "render.false_affordance");
assert(
  falseAffordanceFinding?.severity === "warning"
    && falseAffordanceFinding.message.includes("service-row-fixture")
    && falseAffordanceFinding.message.includes("3 repeated peers")
    && !isTechnicalReleaseBlocker(falseAffordanceFinding),
  "Repeated plus symbols on non-interactive service rows escaped the false-affordance advisory."
);
const noninteractiveControlFinding = syntheticIdentityAndRepeatedImageBrowser.findings.find((finding) =>
  finding.id === "functional.noninteractive_control");
assert(
  noninteractiveControlFinding?.severity === "error"
    && noninteractiveControlFinding.message.includes("fake-search-fixture")
    && isTechnicalReleaseBlocker(noninteractiveControlFinding),
  "A field-like search affordance without interactive behavior escaped the functional release gate."
);
const repeatedSourceImageFinding = syntheticIdentityAndRepeatedImageBrowser.findings.find((finding) =>
  finding.id === "render.repeated_source_image");
assert(
  repeatedSourceImageFinding?.severity === "warning"
    && repeatedSourceImageFinding.message.includes("2 times across 2 sections")
    && !isTechnicalReleaseBlocker(repeatedSourceImageFinding),
  "The same non-logo photograph reused as major media in separate sections escaped the repetition advisory."
);

const collapsedDisclosurePrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</main>", '<details class="faq-fixture"><summary>What should I expect?</summary><p class="faq-answer">A clear explanation of the service and next steps.</p></details></main>') }
    : route),
  files: prepared.files.map((file) => {
    if (file.path === "index.html") {
      return { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</main>", '<details class="faq-fixture"><summary>What should I expect?</summary><p class="faq-answer">A clear explanation of the service and next steps.</p></details></main>')) };
    }
    return file.path === "site.css"
      ? { ...file, bytes: Buffer.from(`${file.bytes.toString("utf8")}\n.faq-fixture{padding:40px}.faq-answer{font-size:15px}`) }
      : file;
  })
};
const collapsedDisclosureBrowser = await runArtifactBrowserGate({
  prepared: collapsedDisclosurePrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-collapsed-disclosure",
  routePaths: ["/"]
});
const collapsedDisclosureFinding = collapsedDisclosureBrowser.findings.find((finding) =>
  finding.id === "render.disclosure_text");
assert(
  collapsedDisclosureFinding?.severity === "warning"
    && collapsedDisclosureFinding.message.includes("p.faq-answer")
    && collapsedDisclosureFinding.message.includes("15px")
    && !isTechnicalReleaseBlocker(collapsedDisclosureFinding),
  "Collapsed FAQ answer copy below the body-text launch floor escaped the disclosure advisory."
);

const belowFoldControlPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</main>", '<div class="below-fold-control"><a class="button" href="/contact">Below-fold action</a></div></main>') }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</main>", '<div class="below-fold-control"><a class="button" href="contact/">Below-fold action</a></div></main>')) }
    : file.path === "site.css"
      ? { ...file, bytes: Buffer.from(`${file.bytes.toString("utf8")}\n.below-fold-control{margin-top:200vh}`) }
      : file)
};
const belowFoldControlBrowser = await runArtifactBrowserGate({
  prepared: belowFoldControlPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-below-fold-control",
  routePaths: ["/"]
});
assert(
  !belowFoldControlBrowser.findings.some((finding) =>
    finding.id === "render.clipping_overlap"
    && /[1-9]\d* essential control\(s\) failed center-point hit-testing/.test(finding.message)),
  "An offscreen below-fold control was incorrectly center-hit-tested against the viewport edge."
);

const visuallyHiddenHeadingMarkup = '<h2 class="visually-hidden-fixture">Accessible section label</h2>';
const visuallyHiddenHeadingPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</main>", `${visuallyHiddenHeadingMarkup}</main>`) }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</main>", `${visuallyHiddenHeadingMarkup}</main>`)) }
    : file.path === "site.css"
      ? { ...file, bytes: Buffer.from(`${file.bytes.toString("utf8")}\n.visually-hidden-fixture{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}`) }
      : file)
};
const visuallyHiddenHeadingBrowser = await runArtifactBrowserGate({
  prepared: visuallyHiddenHeadingPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-visually-hidden-heading",
  routePaths: ["/"],
  viewports: [{ name: "mobile", width: 390, height: 844 }]
});
assert(
  !visuallyHiddenHeadingBrowser.findings.some((finding) =>
    ["render.heading_overflow", "render.clipping_overlap", "render.text_clipping"].includes(finding.id)
    && finding.message.includes("Accessible section label")),
  "A conventional screen-reader-only heading was misclassified as visible clipping or overflow."
);

const adjacentDuplicateTextMarkup = '<div class="service-area-label"><span>Raleigh NC</span> <span>NC</span></div>';
const adjacentDuplicateTextPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</main>", `${adjacentDuplicateTextMarkup}</main>`) }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</main>", `${adjacentDuplicateTextMarkup}</main>`)) }
    : file)
};
const adjacentDuplicateTextBrowser = await runArtifactBrowserGate({
  prepared: adjacentDuplicateTextPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-adjacent-duplicate-text",
  routePaths: ["/"]
});
const adjacentDuplicateTextFinding = adjacentDuplicateTextBrowser.findings.find((finding) =>
  finding.id === "render.adjacent_duplicate_text");
assert(
  adjacentDuplicateTextFinding?.severity === "warning"
    && adjacentDuplicateTextFinding.message.includes('div.service-area-label "Raleigh NC NC"')
    && !isTechnicalReleaseBlocker(adjacentDuplicateTextFinding),
  `A redundant authored suffix beside canonical text escaped advisory browser feedback: ${adjacentDuplicateTextFinding?.message ?? "missing finding"}`
);

const sentenceBoundaryRepeatMarkup = '<p class="sentence-boundary-repeat">Tell us how to reach you. You can also call directly.</p>';
const sentenceBoundaryRepeatPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</main>", `${sentenceBoundaryRepeatMarkup}</main>`) }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</main>", `${sentenceBoundaryRepeatMarkup}</main>`)) }
    : file)
};
const sentenceBoundaryRepeatBrowser = await runArtifactBrowserGate({
  prepared: sentenceBoundaryRepeatPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-sentence-boundary-repeat",
  routePaths: ["/"]
});
assert(
  !sentenceBoundaryRepeatBrowser.findings.some((finding) =>
    finding.id === "render.adjacent_duplicate_text" && finding.message.includes("sentence-boundary-repeat")),
  "A natural sentence-boundary pronoun repeat was misclassified as duplicated authored text."
);

const adjacentDuplicateContentMarkup = '<section class="duplicate-content-fixture" style="min-height:180px;padding:32px"><h2>Ready when you are</h2><p>Tell us what is happening and we will help you find the right next step.</p><a href="/contact">Contact us</a></section><section class="duplicate-content-fixture" style="min-height:180px;padding:32px"><h2>Ready when you are</h2><p>Tell us what is happening and we will help you find the right next step.</p><a href="/contact">Contact us</a></section>';
const adjacentDuplicateContentPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</main>", `${adjacentDuplicateContentMarkup}</main>`) }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</main>", `${adjacentDuplicateContentMarkup}</main>`)) }
    : file)
};
const adjacentDuplicateContentBrowser = await runArtifactBrowserGate({
  prepared: adjacentDuplicateContentPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-adjacent-duplicate-content",
  routePaths: ["/"],
  viewports: [{ name: "desktop", width: 1280, height: 900 }]
});
const adjacentDuplicateContentFinding = adjacentDuplicateContentBrowser.findings.find((finding) =>
  finding.id === "functional.adjacent_duplicate_content");
assert(
  adjacentDuplicateContentFinding?.severity === "error"
    && adjacentDuplicateContentFinding.message.includes("duplicate-content-fixture")
    && adjacentDuplicateContentFinding.message.includes("ready when you are")
    && isTechnicalReleaseBlocker(adjacentDuplicateContentFinding),
  `Two substantial adjacent sections with identical visible content escaped the functional release gate: ${adjacentDuplicateContentFinding?.message ?? "missing finding"}`
);

const duplicateHeaderIdentityMarkup = `<span data-lodesta-business-name data-lodesta-identity-status="verified" data-lodesta-fact-id="${name.id}">${name.value}</span>`;
const duplicateHeaderIdentityPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</header>", `${duplicateHeaderIdentityMarkup}</header>`) }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</header>", `${duplicateHeaderIdentityMarkup}</header>`)) }
    : file)
};
const duplicateHeaderIdentityBrowser = await runArtifactBrowserGate({
  prepared: duplicateHeaderIdentityPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-duplicate-header-identity",
  routePaths: ["/"],
  viewports: [{ name: "desktop", width: 1280, height: 900 }]
});
const duplicateHeaderIdentityFinding = duplicateHeaderIdentityBrowser.findings.find((finding) =>
  finding.id === "identity.duplicate_header_identity");
assert(
  duplicateHeaderIdentityFinding?.severity === "error"
    && duplicateHeaderIdentityFinding.message.includes(String(name.value))
    && isTechnicalReleaseBlocker(duplicateHeaderIdentityFinding),
  `Two visible copies of the canonical business identity escaped the release gate: ${duplicateHeaderIdentityFinding?.message ?? "missing finding"}`
);

const internalProvenanceMarkup = '<section class="internal-provenance"><p>The retained mission is relationship-based service.</p><p>Comment text and related information are retained indefinitely for follow-up.</p><p>Our Georgetown service page lists common household pests.</p><details><summary>What do you treat?</summary><p>The Georgetown page recommends service every two months.</p><p>The service language includes ants and termites.</p><p>The source service describes its products as family friendly.</p><p>The products are described as family friendly.</p><p>The company describes bi-monthly residential visits.</p><p>Kind Pest Control describes its work as environmentally kind.</p><p>This site turns those ideas into a clear next step.</p><p>Choose a city for local service information.</p><p>Our public story is built around careful service.</p><p>Our source material emphasizes friendly technicians.</p><p>The service guidance emphasizes a focused response.</p><p>The service material centers eco-friendly approaches.</p><p>Our residential service material focuses on careful treatment.</p><p>The company centers family-conscious methods.</p></details></section>';
const internalProvenancePrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</main>", `${internalProvenanceMarkup}</main>`) }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</main>", `${internalProvenanceMarkup}</main>`)) }
    : file)
};
const internalProvenanceBrowser = await runArtifactBrowserGate({
  prepared: internalProvenancePrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-internal-provenance",
  routePaths: ["/"]
});
const internalProvenanceFinding = internalProvenanceBrowser.findings.find((finding) =>
  finding.id === "render.internal_provenance_copy");
assert(
  internalProvenanceFinding?.severity === "warning"
    && internalProvenanceFinding.message.includes("15 customer-facing text block(s)")
    && internalProvenanceFinding.message.includes("retained mission")
    && internalProvenanceFinding.message.includes("service page lists")
    && internalProvenanceFinding.message.includes("Georgetown page recommends")
    && !isTechnicalReleaseBlocker(internalProvenanceFinding),
  `Internal source provenance escaped advisory browser feedback: ${internalProvenanceFinding?.message ?? "missing finding"}`
);
const vagueProcessCopyFinding = internalProvenanceBrowser.findings.find((finding) =>
  finding.id === "render.vague_process_copy");
assert(
  vagueProcessCopyFinding?.severity === "warning"
    && vagueProcessCopyFinding.message.includes("clear next step")
    && vagueProcessCopyFinding.message.includes("local service information")
    && !isTechnicalReleaseBlocker(vagueProcessCopyFinding),
  `Vague process copy escaped advisory browser feedback: ${vagueProcessCopyFinding?.message ?? "missing finding"}`
);

const unrenderedVagueCopyPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/contact"
    ? { ...route, html: route.html.replace("</main>", "<p>Readable place names and local service information.</p><p>We can shape the service conversation around your property.</p></main>") }
    : route),
  files: prepared.files.map((file) => file.path === "contact/index.html"
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</main>", "<p>Readable place names and local service information.</p><p>We can shape the service conversation around your property.</p></main>")) }
    : file)
};
const unrenderedVagueCopyBrowser = await runArtifactBrowserGate({
  prepared: unrenderedVagueCopyPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-unrendered-vague-copy",
  captureMode: "review",
  routePaths: ["/"]
});
const unrenderedVagueCopyFinding = unrenderedVagueCopyBrowser.findings.find((finding) =>
  finding.id === "render.vague_process_copy" && finding.route === "/contact");
assert(
  unrenderedVagueCopyFinding?.severity === "warning"
    && unrenderedVagueCopyFinding.message.includes("2 customer-facing text block(s)")
    && unrenderedVagueCopyFinding.message.includes("service conversation")
    && unrenderedVagueCopyFinding.message.includes("local service information")
    && !isTechnicalReleaseBlocker(unrenderedVagueCopyFinding),
  `Vague process copy on an unrendered route escaped advisory feedback: ${unrenderedVagueCopyFinding?.message ?? "missing finding"}`
);

const clippedComponentMarkup = '<img class="clipped-logo" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="Official business logo"><div class="clipped-service-row"><span>General pest control</span><a href="/contact" aria-label="Request general pest control">→</a></div>';
const clippedComponentPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</main>", `${clippedComponentMarkup}</main>`) }
    : route),
  files: prepared.files.map((file) => {
    if (file.path === "index.html") {
      return { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</main>", `${clippedComponentMarkup}</main>`)) };
    }
    return file.path === "site.css"
      ? { ...file, bytes: Buffer.from(`${file.bytes.toString("utf8")}\n.clipped-logo{position:fixed;left:10px;top:-20px;width:100px;height:60px}.clipped-service-row{display:grid;grid-template-columns:minmax(0,1fr) 24px;width:100vw;margin-left:calc(50% - 50vw)}.clipped-service-row>a{display:grid;place-items:center;min-width:44px;min-height:44px}`) }
      : file;
  })
};
const clippedComponentBrowser = await runArtifactBrowserGate({
  prepared: clippedComponentPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-clipped-component",
  routePaths: ["/"],
  viewports: [{ name: "mobile", width: 390, height: 844 }]
});
const clippedComponentFinding = clippedComponentBrowser.findings.find((finding) => finding.id === "render.clipping_overlap");
assert(
  clippedComponentFinding?.severity === "error" && isTechnicalReleaseBlocker(clippedComponentFinding),
  "Clipped important content did not block candidate finalization."
);
assert(
  clippedComponentFinding?.message.includes('a "Request general pest control"')
    && clippedComponentFinding.message.includes("beyond right")
    && clippedComponentFinding.message.includes("within div.clipped-service-row (grid"),
  `Clipping feedback did not identify the visible control, bounds, and shared layout context: ${clippedComponentFinding?.message ?? "missing finding"}`
);
assert(
  clippedComponentFinding?.message.includes('img.clipped-logo "Official business logo"')
    && clippedComponentFinding.message.includes("20px beyond top"),
  `Clipping feedback did not identify an image shifted above the natural viewport: ${clippedComponentFinding?.message ?? "missing finding"}`
);

const tabletShellMarkup = '<a class="tablet-only-clipped" href="/contact">Request an estimate</a>';
const tabletShellPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</header>", `${tabletShellMarkup}</header>`) }
    : route),
  files: prepared.files.map((file) => {
    if (file.path === "index.html") {
      return { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</header>", `${tabletShellMarkup}</header>`)) };
    }
    return file.path === "site.css"
      ? { ...file, bytes: Buffer.from(`${file.bytes.toString("utf8")}\n.tablet-only-clipped{display:none}@media(min-width:700px) and (max-width:800px){.tablet-only-clipped{display:flex;position:fixed;right:-18px;top:12px;width:180px;min-height:48px;align-items:center;background:#9b2c20;color:#fff}}`) }
      : file;
  })
};
const tabletShellBrowser = await runArtifactBrowserGate({
  prepared: tabletShellPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-tablet-shell",
  routePaths: ["/"]
});
const tabletShellFinding = tabletShellBrowser.findings.find((finding) =>
  finding.id === "render.clipping_overlap" && finding.message.includes("tablet"));
assert(
  tabletShellFinding?.severity === "error"
    && tabletShellFinding.message.includes('a.tablet-only-clipped "Request an estimate"')
    && isTechnicalReleaseBlocker(tabletShellFinding),
  `Final verification did not exercise the homepage tablet shell: ${tabletShellFinding?.message ?? "missing finding"}`
);

const seriousOverflowMarkup = '<div class="serious-overflow-fixture">Important launch content</div>';
const seriousOverflowPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</main>", `${seriousOverflowMarkup}</main>`) }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</main>", `${seriousOverflowMarkup}</main>`)) }
    : file.path === "site.css"
      ? { ...file, bytes: Buffer.from(`${file.bytes.toString("utf8")}\n.serious-overflow-fixture{width:calc(100vw + 24px);min-height:44px}`) }
      : file)
};
const seriousOverflowBrowser = await runArtifactBrowserGate({
  prepared: seriousOverflowPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-serious-overflow",
  routePaths: ["/"],
  viewports: [{ name: "mobile", width: 390, height: 844 }]
});
const seriousOverflowFinding = seriousOverflowBrowser.findings.find((finding) => finding.id === "render.horizontal_overflow");
assert(
  seriousOverflowFinding?.severity === "error"
    && /Horizontal overflow is (?:1[6-9]|[2-9]\d|\d{3,})px/.test(seriousOverflowFinding.message)
    && isTechnicalReleaseBlocker(seriousOverflowFinding),
  `Serious viewport overflow did not block candidate finalization: ${seriousOverflowFinding?.message ?? "missing finding"}`
);

const reviewBrowser = await runArtifactBrowserGate({
  prepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-review",
  routePaths: ["/"],
  captureMode: "review"
});
assert.equal(reviewBrowser.routesChecked, 1);
assert.equal(reviewBrowser.allRoutesChecked, 1, "Focused author review performed work outside its selected visual route.");
assert(!reviewBrowser.findings.some((finding) => finding.id === "accessibility.axe.complete"), "Focused author review ran the release-only accessibility suite.");
assert.equal(reviewBrowser.captures.length, 9, "Author review did not retain natural and extended visual evidence.");
assert.equal(reviewBrowser.captures.filter((capture) => capture.stage === "natural").length, 2, "Author review did not retain desktop and mobile natural-load evidence.");
assert.equal(reviewBrowser.captures.filter((capture) => capture.stage === "settled").length, 7, "Author review did not retain full settled route evidence.");

const focusedBrowser = await runArtifactBrowserGate({
  prepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-focused",
  routePaths: ["/"],
  focusSelector: ".hero"
});
const focusedCaptures = focusedBrowser.captures.filter((capture) => capture.frame === "focus");
assert.equal(focusedBrowser.routesChecked, 1);
assert.equal(focusedBrowser.allRoutesChecked, prepared.routes.length, "Focused verification skipped the cheap all-route verification.");
assert.equal(focusedCaptures.length, 3, "Selection-aware homepage verification did not capture desktop, tablet, and mobile.");
assert(focusedCaptures.every((capture) => capture.focusSelector === ".hero"));
assert(!focusedBrowser.findings.some((finding) => finding.id === "render.inspection_selection_missing"));

const axeSabotage = `<script>window.axe=undefined;Object.defineProperty(window,"axe",{value:undefined,writable:false,configurable:false});</script>`;
const axeUnavailablePrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => ({
    ...route,
    html: route.html.replace("</head>", `${axeSabotage}</head>`)
  })),
  files: prepared.files.map((file) => file.contentType.startsWith("text/html")
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</head>", `${axeSabotage}</head>`)) }
    : file)
};
await assert.rejects(
  () => runArtifactBrowserGate({
    prepared: axeUnavailablePrepared,
    buildInput,
    blobStore: new MemoryBlobStore(),
    capturePrefix: "verification/site-authoring-render-axe-unavailable"
  }),
  (error) => error instanceof BrowserVerificationUnavailableError
    && error.details.attempt === 2
    && error.details.stage === "readiness"
    && error.details.route === "/",
  "A missing canonical axe-core runtime did not receive exactly one fresh-browser retry and a typed failure."
);

const lowContrastPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("Collision care, clearly handled.", "Collision care&amp;#x2019;s next step.") }
    : route),
  files: prepared.files.map((file) => {
    if (file.path === "index.html") {
      return { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("Collision care, clearly handled.", "Collision care&amp;#x2019;s next step.")) };
    }
    return file.path === "site.css"
      ? { ...file, bytes: Buffer.from("*{box-sizing:border-box}body{margin:0;color:#aaa;background:#fff;font:16px/1.5 Arial,sans-serif}header,main,footer{padding:24px}a,button,input,textarea{color:#aaa;background:#fff;font:inherit}") }
      : file;
  })
};
const lowContrastBrowser = await runArtifactBrowserGate({
  prepared: lowContrastPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-low-contrast"
});
const contrastFinding = lowContrastBrowser.findings.find((finding) => finding.id === "render.contrast");
assert(contrastFinding?.message.includes("Examples:") && contrastFinding.message.includes("rgb("), "contrast findings do not identify actionable elements and computed colors");
assert.equal(contrastFinding?.severity, "error", "Reliable solid-color body/control contrast did not block release.");
assert(lowContrastBrowser.findings.some((finding) => finding.id === "render.escaped_entity" && finding.message.includes("&#x2019;")), "visible escaped HTML entity source was not rejected");

const shortInteractiveContrastMarkup = '<section class="short-interactive-contrast"><a href="tel:+15125550100">Call</a></section>';
const shortInteractiveContrastPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</main>", `${shortInteractiveContrastMarkup}</main>`) }
    : route),
  files: prepared.files.map((file) => {
    if (file.path === "index.html") {
      return { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</main>", `${shortInteractiveContrastMarkup}</main>`)) };
    }
    return file.path === "site.css"
      ? { ...file, bytes: Buffer.concat([file.bytes, Buffer.from('.short-interactive-contrast{background:#08283e}.short-interactive-contrast a{color:#102b40}')]) }
      : file;
  })
};
const shortInteractiveContrastBrowser = await runArtifactBrowserGate({
  prepared: shortInteractiveContrastPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-short-interactive-contrast",
  routePaths: ["/"]
});
assert(
  shortInteractiveContrastBrowser.findings.some((finding) =>
    finding.id === "render.contrast" && finding.message.includes('a "Call"')),
  "A short interactive label with transparent background escaped ancestor-surface contrast verification."
);

const translucentContrastMarkup = '<section class="translucent-contrast"><p>Translucent hero copy must remain readable.</p></section>';
const translucentContrastPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</main>", `${translucentContrastMarkup}</main>`) }
    : route),
  files: prepared.files.map((file) => {
    if (file.path === "index.html") {
      return { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</main>", `${translucentContrastMarkup}</main>`)) };
    }
    return file.path === "site.css"
      ? { ...file, bytes: Buffer.concat([file.bytes, Buffer.from('.translucent-contrast{background:#f7f8f4}.translucent-contrast p{color:rgba(255,255,255,.79)}')]) }
      : file;
  })
};
const translucentContrastBrowser = await runArtifactBrowserGate({
  prepared: translucentContrastPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-translucent-contrast",
  routePaths: ["/"]
});
const translucentContrastFinding = translucentContrastBrowser.findings.find((finding) =>
  finding.id === "render.contrast" && finding.message.includes("Translucent hero copy must remain readable."));
assert(
  translucentContrastFinding?.severity === "error" && translucentContrastFinding.message.includes("rgba("),
  "Translucent light text on a light solid surface escaped deterministic contrast verification."
);

const translucentSafeMarkup = '<section class="translucent-safe"><p>Translucent light copy on a dark surface.</p></section>';
const translucentSafePrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</main>", `${translucentSafeMarkup}</main>`) }
    : route),
  files: prepared.files.map((file) => {
    if (file.path === "index.html") {
      return { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</main>", `${translucentSafeMarkup}</main>`)) };
    }
    return file.path === "site.css"
      ? { ...file, bytes: Buffer.concat([file.bytes, Buffer.from('.translucent-safe{background:#091522}.translucent-safe p{color:rgba(255,255,255,.79)}')]) }
      : file;
  })
};
const translucentSafeBrowser = await runArtifactBrowserGate({
  prepared: translucentSafePrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-translucent-safe",
  routePaths: ["/"]
});
assert(
  !translucentSafeBrowser.findings.some((finding) =>
    finding.id === "render.contrast" && finding.message.includes("Translucent light copy on a dark surface.")),
  "Readable translucent light text on a dark solid surface was incorrectly rejected."
);

const decorativeBoundaryMarkup = '<section class="decorative-boundary"><p>Responsive prose must stay on one stable color field.</p></section>';
const decorativeBoundaryPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</main>", `${decorativeBoundaryMarkup}</main>`) }
    : route),
  files: prepared.files.map((file) => {
    if (file.path === "index.html") {
      return { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</main>", `${decorativeBoundaryMarkup}</main>`)) };
    }
    return file.path === "site.css"
      ? { ...file, bytes: Buffer.concat([file.bytes, Buffer.from('.decorative-boundary{position:relative;height:80px;background:#f7f8f4}.decorative-boundary:before{content:"";position:absolute;inset:40px 0 0;background:#285be8}.decorative-boundary p{position:relative;margin:0;padding-top:28px;line-height:24px;color:#101b2d}')]) }
      : file;
  })
};
const decorativeBoundaryBrowser = await runArtifactBrowserGate({
  prepared: decorativeBoundaryPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-decorative-boundary",
  routePaths: ["/"]
});
const decorativeBoundaryFinding = decorativeBoundaryBrowser.findings.find((finding) =>
  finding.id === "render.text_surface_boundary" && finding.message.includes("Responsive prose must stay on one stable color field."));
assert.equal(
  decorativeBoundaryFinding?.severity,
  "warning",
  "Meaningful text crossing a positioned decorative color boundary escaped responsive composition review."
);

const escapedSequenceText = String.raw`Contact \n Get quote`;
const escapedSequencePrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</main>", `<p>${escapedSequenceText}</p></main>`) }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</main>", `<p>${escapedSequenceText}</p></main>`)) }
    : file)
};
const escapedSequenceBrowser = await runArtifactBrowserGate({
  prepared: escapedSequencePrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-escaped-sequence",
  routePaths: ["/"]
});
const escapedSequenceFinding = escapedSequenceBrowser.findings.find((finding) => finding.id === "render.escaped_sequence");
assert(
  escapedSequenceFinding?.severity === "error" && isTechnicalReleaseBlocker(escapedSequenceFinding),
  "Visible literal escaped source text was not treated as a deterministic release failure."
);

const missingGlyphMarkup = '<p class="portable-symbols">Portable symbols: ↗ ↯ ✓ ✳</p><p class="unsupported-glyph">Unsupported emoji: 📞</p>';
const missingGlyphPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</main>", `${missingGlyphMarkup}</main>`) }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</main>", `${missingGlyphMarkup}</main>`)) }
    : file.path === "site.css"
      ? { ...file, bytes: Buffer.concat([file.bytes, Buffer.from('.portable-symbols,.unsupported-glyph{font-family:"Lodesta Inter"}')]) }
      : file)
};
const missingGlyphBrowser = await runArtifactBrowserGate({
  prepared: missingGlyphPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-missing-glyph",
  routePaths: ["/"]
});
const missingGlyphFinding = missingGlyphBrowser.findings.find((finding) => finding.id === "render.missing_glyph");
assert(
  missingGlyphFinding?.severity === "error" && isTechnicalReleaseBlocker(missingGlyphFinding),
  "An unsupported emoji was not treated as a deterministic portable-font release failure."
);
assert(
  missingGlyphFinding.message.includes("U+1F4DE")
  && missingGlyphFinding.message.includes("ordinary supported text")
  && missingGlyphFinding.message.includes("inline SVG"),
  "The missing-glyph diagnostic did not identify the codepoint and portable alternatives."
);
assert(
  !["U+2197", "U+21AF", "U+2713", "U+2733"].some((codepoint) => missingGlyphFinding.message.includes(codepoint)),
  "A guaranteed portable symbol was incorrectly rejected."
);

const functionalDefectsPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? {
        ...route,
        html: route.html
          .replace("</nav>", `<a class="blank-call" href="tel:${phone.value}" aria-label="Call ${name.value}"><span>${phone.value}</span></a></nav>`)
          .replace("<main>", `<main><img class="lazy-hero" loading="lazy" src="/_lodesta/assets/missing-fixture" alt="plumber-near-me-austin-tx.jpg">`)
      }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? {
        ...file,
        bytes: Buffer.from(file.bytes.toString("utf8")
          .replace("</nav>", `<a class="blank-call" href="tel:${phone.value}" aria-label="Call ${name.value}"><span>${phone.value}</span></a></nav>`)
          .replace("<main>", `<main><img class="lazy-hero" loading="lazy" src="/_lodesta/assets/missing-fixture" alt="plumber-near-me-austin-tx.jpg">`))
      }
    : file.path === "site.css"
      ? {
          ...file,
          bytes: Buffer.from(`${file.bytes.toString("utf8")}
[data-lodesta-map]{height:225px;overflow:hidden}.lazy-hero{display:block;width:320px;height:180px}
@media(max-width:480px){.blank-call span{display:none}.blank-call{display:inline-flex;width:48px;height:48px;background:#9b2c20}}`)
        }
      : file)
};
const functionalDefectsBrowser = await runArtifactBrowserGate({
  prepared: functionalDefectsPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-functional-defects"
});
assert(
  functionalDefectsBrowser.findings.some((finding) => finding.id === "render.managed_content_clipped" && finding.severity === "error"),
  "A managed capability block with unreachable clipped content did not block release."
);
assert(
  functionalDefectsBrowser.findings.some((finding) => finding.id === "render.empty_control" && finding.severity === "error"),
  "A visible mobile control with only an aria-label did not block release when its visible label disappeared."
);
assert(
  functionalDefectsBrowser.findings.some((finding) => finding.id === "render.lazy_above_fold_image" && finding.severity === "warning"),
  "An above-fold lazy image did not produce an advisory from the natural-load inspection."
);
assert(
  functionalDefectsBrowser.findings.some((finding) => finding.id === "render.image_alt_quality" && finding.severity === "warning"),
  "Filename/keyword-style image alt text did not produce an advisory."
);

const textCollisionPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? {
        ...route,
        html: route.html.replace(
          `<h1>${name.value}</h1>`,
          `<div class="collision-fixture"><h1>${name.value}</h1><span class="collision-proof">12 years serving Austin</span></div>`
        )
      }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? {
        ...file,
        bytes: Buffer.from(file.bytes.toString("utf8").replace(
          `<h1>${name.value}</h1>`,
          `<div class="collision-fixture"><h1>${name.value}</h1><span class="collision-proof">12 years serving Austin</span></div>`
        ))
      }
    : file.path === "site.css"
      ? {
          ...file,
          bytes: Buffer.from(`${file.bytes.toString("utf8")}
.collision-fixture{position:relative}.collision-proof{position:absolute;left:8px;top:28px;padding:8px;background:#fff;color:#111;z-index:2}`)
        }
      : file)
};
const textCollisionBrowser = await runArtifactBrowserGate({
  prepared: textCollisionPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-text-collision"
});
const textCollisionFinding = textCollisionBrowser.findings.find((finding) =>
  finding.id === "render.text_occlusion");
assert(
  textCollisionFinding
    && textCollisionFinding.severity === "warning"
    && textCollisionFinding.message.includes("12 years serving Austin"),
  "A positioned proof label covering headline text did not produce actionable advisory guidance."
);
assert(
  !isTechnicalReleaseBlocker(textCollisionFinding),
  "A subjective text-occlusion heuristic still blocks candidate finalization."
);

const headerControlCollisionMarkup = '<a class="header-control-collision-a" href="/services">Services</a><a class="header-control-collision-b" href="/contact">Contact</a>';
const headerControlCollisionPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</header>", `${headerControlCollisionMarkup}</header>`) }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</header>", `${headerControlCollisionMarkup}</header>`)) }
    : file.path === "site.css"
      ? { ...file, bytes: Buffer.from(`${file.bytes.toString("utf8")}
.header-control-collision-a,.header-control-collision-b{position:absolute;top:24px;right:32px;display:inline-flex;align-items:center;min-height:44px;padding:8px 14px;background:#fff}`) }
      : file)
};
const headerControlCollisionBrowser = await runArtifactBrowserGate({
  prepared: headerControlCollisionPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-header-control-collision"
});
const headerControlCollisionFinding = headerControlCollisionBrowser.findings.find((finding) =>
  finding.id === "functional.header_control_collision");
assert(
  headerControlCollisionFinding
    && headerControlCollisionFinding.severity === "error"
    && headerControlCollisionFinding.message.includes("Services")
    && headerControlCollisionFinding.message.includes("Contact"),
  "Two distinct visible header controls sharing the same pixels escaped functional collision detection."
);
assert(
  isTechnicalReleaseBlocker(headerControlCollisionFinding),
  "A deterministic header-control collision did not block candidate finalization."
);

const headerControlWrapMarkup = '<a class="header-wrap-a" href="/services">Service areas</a><a class="header-wrap-b" href="/contact">Customer login</a>';
const headerControlWrapPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</header>", `${headerControlWrapMarkup}</header>`) }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</header>", `${headerControlWrapMarkup}</header>`)) }
    : file.path === "site.css"
      ? { ...file, bytes: Buffer.from(`${file.bytes.toString("utf8")}
@media(min-width:700px) and (max-width:800px){.header-wrap-a,.header-wrap-b{display:inline-block;width:68px;margin-left:8px;white-space:normal}}`) }
      : file)
};
const headerControlWrapBrowser = await runArtifactBrowserGate({
  prepared: headerControlWrapPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-header-control-wrap"
});
const headerControlWrapFinding = headerControlWrapBrowser.findings.find((finding) =>
  finding.id === "render.header_control_wrap" && finding.message.includes("tablet"));
assert(
  headerControlWrapFinding
    && headerControlWrapFinding.severity === "warning"
    && headerControlWrapFinding.message.includes("Service areas")
    && headerControlWrapFinding.message.includes("Customer login"),
  "Multiple wrapped tablet header controls did not produce focused responsive-navigation guidance."
);
assert(
  !isTechnicalReleaseBlocker(headerControlWrapFinding),
  "The responsive header-wrap heuristic unexpectedly became a release blocker."
);

const joinedFooterLinksPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? {
        ...route,
        html: route.html.replace("</footer>", '<div class="joined-links"><a href="/">Services</a><a href="/contact">Contact</a></div></footer>')
      }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? {
        ...file,
        bytes: Buffer.from(file.bytes.toString("utf8").replace("</footer>", '<div class="joined-links"><a href="./">Services</a><a href="contact/">Contact</a></div></footer>'))
      }
    : file.path === "site.css"
      ? {
          ...file,
          bytes: Buffer.from(`${file.bytes.toString("utf8")}
.joined-links>a{display:inline-flex;align-items:center;min-height:44px}.joined-links>a:last-child{border-bottom:2px solid currentColor}`)
        }
      : file)
};
const joinedFooterLinksBrowser = await runArtifactBrowserGate({
  prepared: joinedFooterLinksPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-joined-footer-links",
  routePaths: ["/"]
});
const joinedFooterLinksFinding = joinedFooterLinksBrowser.findings.find((finding) =>
  finding.id === "render.inline_link_spacing");
assert(
  joinedFooterLinksFinding?.severity === "warning"
    && joinedFooterLinksFinding.message.includes("Services")
    && joinedFooterLinksFinding.message.includes("Contact"),
  "Adjacent unseparated links, including an underlined text CTA, did not produce actionable spacing guidance."
);
assert(
  joinedFooterLinksFinding && !isTechnicalReleaseBlocker(joinedFooterLinksFinding),
  "A subjective adjacent-link spacing heuristic became a release blocker."
);

const joinedFooterMetaPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? {
        ...route,
        html: route.html.replace("</footer>", '<div class="joined-meta"><span>© Northstar Collision</span><a href="#top">Back to top ↑</a></div></footer>')
      }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? {
        ...file,
        bytes: Buffer.from(file.bytes.toString("utf8").replace("</footer>", '<div class="joined-meta"><span>© Northstar Collision</span><a href="#top">Back to top ↑</a></div></footer>'))
      }
    : file.path === "site.css"
      ? {
          ...file,
          bytes: Buffer.from(`${file.bytes.toString("utf8")}
.joined-meta>a,.joined-meta>span{display:inline-flex;align-items:center;min-height:44px}`)
        }
      : file)
};
const joinedFooterMetaBrowser = await runArtifactBrowserGate({
  prepared: joinedFooterMetaPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-joined-footer-meta",
  routePaths: ["/"]
});
const joinedFooterMetaFinding = joinedFooterMetaBrowser.findings.find((finding) =>
  finding.id === "render.inline_link_spacing"
  && finding.message.includes("Northstar Collision")
  && finding.message.includes("Back to top"));
assert(
  joinedFooterMetaFinding?.severity === "warning" && !isTechnicalReleaseBlocker(joinedFooterMetaFinding),
  "Unseparated footer copyright text and navigation did not produce advisory spacing guidance."
);

const mobileNavigationOverflowPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? {
        ...route,
        html: route.html.replace(
          "</nav>",
          `<a href="/contact">Emergency</a><a href="/">Services</a><a href="/contact">About</a><a href="/">Locations</a></nav>`
        )
      }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? {
        ...file,
        bytes: Buffer.from(file.bytes.toString("utf8").replace(
          "</nav>",
          `<a href="/contact">Emergency</a><a href="/">Services</a><a href="/contact">About</a><a href="/">Locations</a></nav>`
        ))
      }
    : file.path === "site.css"
      ? {
          ...file,
          bytes: Buffer.from(`${file.bytes.toString("utf8")}
@media(max-width:640px){header nav{width:100%;flex-wrap:nowrap;overflow-x:auto}header nav a{flex:0 0 120px}}`)
        }
      : file)
};
const mobileNavigationOverflowBrowser = await runArtifactBrowserGate({
  prepared: mobileNavigationOverflowPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-mobile-navigation-overflow"
});
assert(
  mobileNavigationOverflowBrowser.findings.some((finding) =>
    finding.id === "render.mobile_navigation_overflow"
    && finding.severity === "warning"
    && finding.message.includes("nav")),
  "Horizontally scrolling primary navigation did not produce an actionable mobile advisory."
);
assert(
  !browser.findings.some((finding) => finding.id === "render.mobile_navigation_overflow"),
  "A fully visible wrapping mobile navigation was incorrectly treated as overflowing."
);

const missingMobileNavigationPrepared = {
  ...prepared,
  files: prepared.files.map((file) => file.path === "site.css"
    ? {
        ...file,
        bytes: Buffer.from(`${file.bytes.toString("utf8")}
@media(max-width:640px){header nav{display:none}}`)
      }
    : file)
};
const missingMobileNavigationBrowser = await runArtifactBrowserGate({
  prepared: missingMobileNavigationPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-missing-mobile-navigation",
  routePaths: ["/"]
});
assert(
  missingMobileNavigationBrowser.findings.some((finding) =>
    finding.id === "render.mobile_navigation"
    && finding.severity === "error"
    && isTechnicalReleaseBlocker(finding)),
  "A desktop navigation hidden on mobile without an equivalent control was not made a functional release blocker."
);

const disclosureNavigationPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? {
        ...route,
        html: route.html.replace("<nav>", "<details><summary>Menu</summary><nav>").replace("</nav>", "</nav></details>")
      }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? {
        ...file,
        bytes: Buffer.from(file.bytes.toString("utf8").replace("<nav>", "<details><summary>Menu</summary><nav>").replace("</nav>", "</nav></details>"))
      }
    : file)
};
const disclosureNavigationBrowser = await runArtifactBrowserGate({
  prepared: disclosureNavigationPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-disclosure-navigation"
});
assert(
  !disclosureNavigationBrowser.findings.some((finding) => finding.id === "render.mobile_navigation"),
  "A visible native disclosure controlling primary navigation was not recognized as a mobile menu."
);
assert(
  !disclosureNavigationBrowser.findings.some((finding) => finding.id === "render.empty_control"),
  "Links inside a closed native navigation disclosure were incorrectly treated as visible blank controls."
);
assert(
  disclosureNavigationBrowser.findings.some((finding) =>
    finding.id === "functional.navigation_reachability"
    && finding.severity === "info"
    && /All \d+ primary destination/.test(finding.message)),
  "A valid disclosure menu did not reveal hit-testable primary destinations."
);
assert(
  !disclosureNavigationBrowser.findings.some((finding) => finding.id === "render.mobile_navigation_trigger"),
  "A native navigation disclosure with a visible text label was incorrectly treated as indiscernible."
);

const paintedDisclosureNavigationPrepared = {
  ...disclosureNavigationPrepared,
  routes: disclosureNavigationPrepared.routes.map((route) => route.path === "/"
    ? {
        ...route,
        html: route.html.replace("<summary>Menu</summary>", '<summary aria-label="Open navigation"><span></span><span></span><span></span></summary>')
      }
    : route),
  files: disclosureNavigationPrepared.files.map((file) => file.path === "index.html"
    ? {
        ...file,
        bytes: Buffer.from(file.bytes.toString("utf8").replace("<summary>Menu</summary>", '<summary aria-label="Open navigation"><span></span><span></span><span></span></summary>'))
      }
    : file.path === "site.css"
      ? {
          ...file,
          bytes: Buffer.from(`${file.bytes.toString("utf8")}\n@media(max-width:640px){details>summary{list-style:none}details>summary::-webkit-details-marker{display:none}details>summary span{display:block;width:18px;height:2px;margin:4px;background:#17211b}}`)
        }
      : file)
};
const paintedDisclosureNavigationBrowser = await runArtifactBrowserGate({
  prepared: paintedDisclosureNavigationPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-painted-disclosure-navigation",
  routePaths: ["/"]
});
assert(
  !paintedDisclosureNavigationBrowser.findings.some((finding) => finding.id === "render.empty_control"),
  "A navigation trigger with authored CSS-painted artwork was incorrectly treated as an empty control."
);
assert(
  !paintedDisclosureNavigationBrowser.findings.some((finding) => finding.id === "render.mobile_navigation_trigger"),
  "A navigation trigger with authored CSS-painted artwork was incorrectly treated as indiscernible."
);

const indiscernibleDisclosureNavigationPrepared = {
  ...disclosureNavigationPrepared,
  routes: disclosureNavigationPrepared.routes.map((route) => route.path === "/"
    ? {
        ...route,
        html: route.html.replace("<summary>Menu</summary>", "<summary aria-label=\"Open navigation\"><span></span><span></span><span></span></summary>")
      }
    : route),
  files: disclosureNavigationPrepared.files.map((file) => file.path === "index.html"
    ? {
        ...file,
        bytes: Buffer.from(file.bytes.toString("utf8").replace("<summary>Menu</summary>", "<summary aria-label=\"Open navigation\"><span></span><span></span><span></span></summary>"))
      }
    : file.path === "site.css"
      ? {
          ...file,
          bytes: Buffer.from(`${file.bytes.toString("utf8")}\n@media(max-width:640px){details>summary{list-style:none}details>summary::-webkit-details-marker{display:none}details>summary span{display:block;width:18px;height:2px;background:var(--missing-navigation-color)}}`)
        }
      : file)
};
const indiscernibleDisclosureNavigationBrowser = await runArtifactBrowserGate({
  prepared: indiscernibleDisclosureNavigationPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-indiscernible-disclosure-navigation",
  routePaths: ["/"]
});
assert(
  indiscernibleDisclosureNavigationBrowser.findings.some((finding) =>
    finding.id === "render.mobile_navigation_trigger"
    && finding.severity === "error"
    && isTechnicalReleaseBlocker(finding)),
  `A blank native navigation trigger with only an accessible label escaped the functional release gate. Findings: ${indiscernibleDisclosureNavigationBrowser.findings.map((finding) => `${finding.id}:${finding.message}`).join(" | ")}`
);

const siblingDisclosureNavigationPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? {
        ...route,
        html: route.html.replace(
          "</nav>",
          '</nav><details class="native-mobile-menu"><summary>Menu</summary><div><a href="./">Home</a><a href="contact/">Contact</a></div></details>'
        )
      }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? {
        ...file,
        bytes: Buffer.from(file.bytes.toString("utf8").replace(
          "</nav>",
          '</nav><details class="native-mobile-menu"><summary>Menu</summary><div><a href="./">Home</a><a href="contact/">Contact</a></div></details>'
        ))
      }
    : file.path === "site.css"
      ? {
          ...file,
          bytes: Buffer.from(`${file.bytes.toString("utf8")}
.native-mobile-menu{display:none}@media(max-width:640px){header>nav{display:none}.native-mobile-menu{display:block}.native-mobile-menu a{display:block;min-height:44px}}`)
        }
      : file)
};
const siblingDisclosureNavigationBrowser = await runArtifactBrowserGate({
  prepared: siblingDisclosureNavigationPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-sibling-disclosure-navigation",
  routePaths: ["/"]
});
assert(
  !siblingDisclosureNavigationBrowser.findings.some((finding) => finding.id === "render.mobile_navigation"),
  "A native disclosure with direct destination links but no nested nav landmark was incorrectly rejected."
);
assert(
  siblingDisclosureNavigationBrowser.findings.some((finding) =>
    finding.id === "functional.navigation_reachability"
    && finding.severity === "info"
    && /All \d+ primary destination/.test(finding.message)),
  "Direct links in a native disclosure were not recognized as reachable navigation destinations."
);

const labeledDesktopNavigationPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? {
        ...route,
        html: route.html.replace("<nav>", '<div aria-label="Primary navigation">').replace("</nav>", "</div>")
      }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? {
        ...file,
        bytes: Buffer.from(file.bytes.toString("utf8").replace("<nav>", '<div aria-label="Primary navigation">').replace("</nav>", "</div>"))
      }
    : file)
};
const labeledDesktopNavigationBrowser = await runArtifactBrowserGate({
  prepared: labeledDesktopNavigationPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-labeled-desktop-navigation",
  routePaths: ["/"]
});
assert(
  labeledDesktopNavigationBrowser.findings.some((finding) =>
    finding.id === "functional.navigation_reachability"
    && finding.severity === "info"
    && finding.message.includes("All 2 primary destination")),
  "Visible hit-testable links in a generically labeled desktop navigation wrapper were incorrectly reported as unreachable."
);

const ownerDrawerMarkup = '<div class="owner-drawer" data-lodesta-navigation-disclosure="owner-navigation" data-lodesta-navigation-behavior="modal"><button type="button" data-lodesta-menu-toggle aria-controls="owner-navigation" aria-expanded="false" aria-label="Open navigation" data-lodesta-open-label="Open navigation" data-lodesta-close-label="Close navigation">Menu</button><div id="owner-navigation" class="owner-drawer-panel" data-lodesta-menu data-lodesta-navigation-panel role="dialog" aria-modal="true" aria-label="Primary" tabindex="-1" hidden><nav aria-label="Primary"><a href="./">Home</a><a href="contact/">Contact</a></nav></div></div>';
const ownerDrawerPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</nav>", `</nav>${ownerDrawerMarkup}`) }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</nav>", `</nav>${ownerDrawerMarkup}`)) }
    : file.path === "site.css"
      ? {
          ...file,
          bytes: Buffer.from(`${file.bytes.toString("utf8")}
.owner-drawer{display:none}@media(max-width:640px){header>nav{display:none}.owner-drawer{display:block}.owner-drawer-panel{right:0;left:auto;width:min(22rem,100%);background:#fff;padding:2rem}.owner-drawer-panel nav{display:grid}}`)
        }
      : file)
};
const ownerDrawerBrowser = await runArtifactBrowserGate({
  prepared: ownerDrawerPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-owner-drawer",
  routePaths: ["/"]
});
assert(
  !ownerDrawerBrowser.findings.some((finding) => finding.route === "/" && finding.id === "render.mobile_navigation"),
  "An owner-selected visible Menu drawer was treated as missing mobile navigation."
);
assert(
  ownerDrawerBrowser.findings.some((finding) => finding.route === "/" && finding.id === "functional.navigation_reachability" && finding.severity === "info"),
  "An owner-selected Menu drawer did not expose reachable navigation destinations."
);
assert(
  ownerDrawerBrowser.findings.some((finding) =>
    finding.route === "/"
    && finding.id === "render.mobile_navigation_toggle_alignment"
    && finding.severity === "warning"),
  "A mobile navigation trigger stranded on the left side of a wide header escaped the alignment advisory."
);
assert(
  !ownerDrawerBrowser.findings.some((finding) => finding.route === "/" && isTechnicalReleaseBlocker(finding)),
  `An owner-selected Menu drawer was incorrectly made a technical release blocker: ${ownerDrawerBrowser.findings
    .filter((finding) => finding.route === "/" && isTechnicalReleaseBlocker(finding))
    .map((finding) => `${finding.id}: ${finding.message}`)
    .join("; ")}`
);

const openedDrawerCallSpacingPrepared = {
  ...ownerDrawerPrepared,
  routes: ownerDrawerPrepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("</nav></div></div>", '<a href="tel:+18049148120">Call<span>(804) 914-8120</span></a></nav></div></div>') }
    : route),
  files: ownerDrawerPrepared.files.map((file) => file.path === "index.html"
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</nav></div></div>", '<a href="tel:+18049148120">Call<span>(804) 914-8120</span></a></nav></div></div>')) }
    : file)
};
const openedDrawerCallSpacingBrowser = await runArtifactBrowserGate({
  prepared: openedDrawerCallSpacingPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-open-navigation-call-spacing",
  routePaths: ["/"],
  viewports: [{ name: "mobile", width: 390, height: 844 }]
});
assert(
  openedDrawerCallSpacingBrowser.findings.some((finding) =>
    finding.route === "/"
    && finding.id === "render.call_action_label_spacing"
    && finding.severity === "warning"
    && finding.message.includes("opened mobile navigation")),
  "A Call/phone label joined only inside the opened mobile navigation escaped the existing spacing advisory."
);

const edgeAnchoredDrawerPrepared = {
  ...ownerDrawerPrepared,
  files: ownerDrawerPrepared.files.map((file) => file.path === "site.css"
    ? {
        ...file,
        bytes: Buffer.from(`${file.bytes.toString("utf8")}
.owner-drawer{position:absolute;left:320px;width:70px}
.owner-drawer-panel{position:absolute;left:0;right:0;width:320px}`)
      }
    : file)
};
const edgeAnchoredDrawerBrowser = await runArtifactBrowserGate({
  prepared: edgeAnchoredDrawerPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-edge-anchored-navigation",
  routePaths: ["/"],
  viewports: [{ name: "mobile", width: 390, height: 844 }]
});
assert(
  edgeAnchoredDrawerBrowser.findings.some((finding) =>
    finding.route === "/"
    && finding.id === "functional.navigation_toggle"
    && isTechnicalReleaseBlocker(finding)),
  `A drawer positioned from a narrow edge wrapper escaped the technical release gate: ${edgeAnchoredDrawerBrowser.findings
    .map((finding) => `${finding.id}: ${finding.message}`)
    .join("; ")}`
);

const clippedDrawerPrepared = {
  ...ownerDrawerPrepared,
  files: ownerDrawerPrepared.files.map((file) => file.path === "site.css"
    ? {
        ...file,
        bytes: Buffer.from(`${file.bytes.toString("utf8")}
.owner-drawer-panel nav{display:flex;flex-wrap:nowrap;overflow-x:hidden}
.owner-drawer-panel nav a{flex:0 0 220px}`)
      }
    : file)
};
const clippedDrawerBrowser = await runArtifactBrowserGate({
  prepared: clippedDrawerPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-clipped-navigation",
  routePaths: ["/"],
  viewports: [{ name: "mobile", width: 390, height: 844 }]
});
assert(
  clippedDrawerBrowser.findings.some((finding) =>
    finding.route === "/"
    && finding.id === "functional.navigation_toggle"
    && isTechnicalReleaseBlocker(finding)
    && /clips or horizontally overflows|outside the phone viewport|document overflow/.test(finding.message)),
  "A clipped, horizontally overflowing opened mobile navigation escaped the technical release gate."
);

const rawDrawerPrepared = {
  ...ownerDrawerPrepared,
  files: ownerDrawerPrepared.files.map((file) => file.path === "site.css"
    ? {
        ...file,
        bytes: Buffer.from(`${file.bytes.toString("utf8")}
.owner-drawer-panel{padding:0;background:#fff}.owner-drawer-panel nav{gap:0;padding:0}
.owner-drawer-panel nav a{padding:0;background:transparent;border:0;font-weight:400}
.owner-drawer button{appearance:auto;background:rgb(239,239,239);color:#111;border:2px outset ButtonBorder;border-radius:2px;padding:1px 6px}`)
      }
    : file)
};
const rawDrawerBrowser = await runArtifactBrowserGate({
  prepared: rawDrawerPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-raw-navigation",
  routePaths: ["/"]
});
const rawDrawerFinding = rawDrawerBrowser.findings.find((finding) =>
  finding.route === "/" && finding.id === "render.mobile_navigation_design");
assert(
  rawDrawerFinding?.severity === "warning" && /browser-default control styling/.test(rawDrawerFinding.message),
  `A technically functional but visually raw managed mobile menu did not produce actionable design guidance: ${JSON.stringify(rawDrawerBrowser.findings)}`
);
assert(
  rawDrawerFinding && !isTechnicalReleaseBlocker(rawDrawerFinding),
  "A subjective mobile-menu design heuristic became a release blocker."
);

const flushDrawerPrepared = {
  ...ownerDrawerPrepared,
  files: ownerDrawerPrepared.files.map((file) => file.path === "site.css"
    ? {
        ...file,
        bytes: Buffer.from(`${file.bytes.toString("utf8")}
.owner-drawer-panel{padding:0;background:#123f32;color:#fff}.owner-drawer-panel nav{gap:4px;padding:0}
.owner-drawer-panel nav a{display:flex;align-items:center;min-height:48px;padding:8px 0;color:#fff;font-weight:750}`)
      }
    : file)
};
const flushDrawerBrowser = await runArtifactBrowserGate({
  prepared: flushDrawerPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-flush-navigation",
  routePaths: ["/"],
  viewports: [{ name: "mobile", width: 390, height: 844 }]
});
assert(
  flushDrawerBrowser.findings.some((finding) =>
    finding.route === "/"
    && finding.id === "render.mobile_navigation_design"
    && finding.message.includes("flush against the panel edge")),
  "A branded mobile link stack flush against the viewport edge escaped the design advisory."
);

const rawToggleAuthoredPanelPrepared = {
  ...ownerDrawerPrepared,
  files: ownerDrawerPrepared.files.map((file) => file.path === "site.css"
    ? {
        ...file,
        bytes: Buffer.from(`${file.bytes.toString("utf8")}\n.owner-drawer button{appearance:auto;background:rgb(239,239,239);color:#111;border:2px outset ButtonBorder;border-radius:2px;padding:1px 6px}`)
      }
    : file)
};
const rawToggleAuthoredPanelBrowser = await runArtifactBrowserGate({
  prepared: rawToggleAuthoredPanelPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-raw-toggle-authored-panel",
  routePaths: ["/"],
  viewports: [{ name: "mobile", width: 390, height: 844 }]
});
assert(
  rawToggleAuthoredPanelBrowser.findings.some((finding) =>
    finding.route === "/"
    && finding.id === "render.mobile_navigation_design"
    && finding.message.includes("trigger retains browser-default control styling")),
  "An otherwise authored mobile panel hid a browser-default navigation trigger from the design advisory."
);

const rawSubmitPrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/contact"
    ? { ...route, html: route.html.replace("</form>", '<button class="raw-submit" type="button">Second action</button></form>') }
    : route),
  files: prepared.files.map((file) => file.path === "contact/index.html"
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("</form>", '<button class="raw-submit" type="button">Second action</button></form>')) }
    : file.path === "site.css"
      ? { ...file, bytes: Buffer.from(`${file.bytes.toString("utf8")}\n.raw-submit{appearance:auto;background:#9b2c20;color:#fff;border:2px outset ButtonBorder;border-radius:999px}`) }
      : file)
};
const rawSubmitBrowser = await runArtifactBrowserGate({
  prepared: rawSubmitPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-raw-submit",
  routePaths: ["/contact"],
  viewports: [{ name: "mobile", width: 390, height: 844 }]
});
const rawSubmitFinding = rawSubmitBrowser.findings.find((finding) => finding.id === "render.browser_default_control_chrome");
assert(
  rawSubmitFinding?.severity === "warning"
    && rawSubmitFinding.message.includes('button.raw-submit "Second action"')
    && !isTechnicalReleaseBlocker(rawSubmitFinding),
  "A branded action with native browser border chrome escaped the visual-finish advisory."
);

const duplicateManagedNavigationIconPrepared = {
  ...ownerDrawerPrepared,
  routes: ownerDrawerPrepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace(">Menu</button>", '><span data-lodesta-navigation-icon aria-hidden="true"><span></span><span></span><span></span></span></button>') }
    : route),
  files: ownerDrawerPrepared.files.map((file) => file.path === "index.html"
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace(">Menu</button>", '><span data-lodesta-navigation-icon aria-hidden="true"><span></span><span></span><span></span></span></button>')) }
    : file.path === "site.css"
      ? { ...file, bytes: Buffer.from(`${file.bytes.toString("utf8")}\n.owner-drawer button::before{content:"";display:block;width:21px;height:13px;border-top:2px solid currentColor;border-bottom:2px solid currentColor}`) }
      : file)
};
const duplicateManagedNavigationIconBrowser = await runArtifactBrowserGate({
  prepared: duplicateManagedNavigationIconPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-duplicate-managed-navigation-icon",
  routePaths: ["/"]
});
const duplicateManagedNavigationIconFinding = duplicateManagedNavigationIconBrowser.findings.find((finding) =>
  finding.id === "render.duplicate_navigation_icon");
assert(
  duplicateManagedNavigationIconFinding?.severity === "warning"
    && duplicateManagedNavigationIconFinding.message.includes("::before/::after artwork")
    && !isTechnicalReleaseBlocker(duplicateManagedNavigationIconFinding),
  "Authored pseudo-element artwork obscuring the managed hamburger/X escaped advisory visual feedback."
);

const transparentDrawerPrepared = {
  ...ownerDrawerPrepared,
  files: ownerDrawerPrepared.files.map((file) => file.path === "site.css"
    ? { ...file, bytes: Buffer.from(`${file.bytes.toString("utf8")}\n.owner-drawer-panel{background:var(--undefined-navigation-surface)}`) }
    : file)
};
const transparentDrawerBrowser = await runArtifactBrowserGate({
  prepared: transparentDrawerPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-transparent-navigation",
  routePaths: ["/"]
});
assert(
  transparentDrawerBrowser.findings.some((finding) =>
    finding.route === "/"
    && finding.id === "functional.navigation_toggle"
    && isTechnicalReleaseBlocker(finding)
    && /reading surface/.test(finding.message)),
  "A transparent modal navigation with an unresolved background token did not fail the technical release gate."
);

const obscuringDrawerPrepared = {
  ...ownerDrawerPrepared,
  files: ownerDrawerPrepared.files.map((file) => file.path === "site.css"
    ? { ...file, bytes: Buffer.from(`${file.bytes.toString("utf8")}\n.owner-drawer-panel{transform:translateY(-100px)}`) }
    : file)
};
const obscuringDrawerBrowser = await runArtifactBrowserGate({
  prepared: obscuringDrawerPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-obscuring-navigation",
  routePaths: ["/"]
});
assert(
  obscuringDrawerBrowser.findings.some((finding) =>
    finding.route === "/"
    && finding.id === "functional.navigation_toggle"
    && isTechnicalReleaseBlocker(finding)
    && /close control|before the header ends/.test(finding.message)),
  "A modal navigation that obscures its close control did not fail the technical release gate."
);

const collapsedManagedDrawerPrepared = {
  ...ownerDrawerPrepared,
  files: ownerDrawerPrepared.files.map((file) => file.path === "site.css"
    ? {
        ...file,
        bytes: Buffer.from(`${file.bytes.toString("utf8")}
.owner-drawer-panel{position:static;width:0;height:0;padding:0;background:transparent}
.owner-drawer-panel>nav{position:fixed;top:5rem;left:0;width:100vw;min-height:20rem;background:#fff}`)
      }
    : file)
};
const collapsedManagedDrawerBrowser = await runArtifactBrowserGate({
  prepared: collapsedManagedDrawerPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-collapsed-managed-navigation",
  routePaths: ["/"]
});
assert(
  collapsedManagedDrawerBrowser.findings.some((finding) =>
    finding.route === "/"
    && finding.id === "functional.navigation_toggle"
    && isTechnicalReleaseBlocker(finding)),
  "A zero-area managed modal whose child is independently positioned did not fail the technical release gate."
);

const defaultIconDrawerMarkup = ownerDrawerMarkup.replace(
  ">Menu</button>",
  '><span data-lodesta-navigation-icon aria-hidden="true"><span></span><span></span><span></span></span></button>'
);
const managedIconDrawerPrepared = {
  ...ownerDrawerPrepared,
  routes: ownerDrawerPrepared.routes.map((route) => ({
    ...route,
    html: route.html.replace(ownerDrawerMarkup, defaultIconDrawerMarkup)
  })),
  files: ownerDrawerPrepared.files.map((file) => file.contentType.startsWith("text/html")
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace(ownerDrawerMarkup, defaultIconDrawerMarkup)) }
    : file)
};
const managedIconDrawerBrowser = await runArtifactBrowserGate({
  prepared: managedIconDrawerPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-managed-navigation-icon",
  routePaths: ["/"]
});
assert(
  !managedIconDrawerBrowser.findings.some((finding) => finding.route === "/" && finding.id === "render.empty_control"),
  "The visible managed navigation icon was incorrectly treated as an empty control."
);
const duplicatedIconDrawerPrepared = {
  ...ownerDrawerPrepared,
  routes: ownerDrawerPrepared.routes.map((route) => ({
    ...route,
    html: route.html.replace(ownerDrawerMarkup, defaultIconDrawerMarkup)
  })),
  files: ownerDrawerPrepared.files.map((file) => file.contentType.startsWith("text/html")
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace(ownerDrawerMarkup, defaultIconDrawerMarkup)) }
    : file.path === "site.css"
      ? { ...file, bytes: Buffer.from(`${file.bytes.toString("utf8")}\n.owner-drawer button::before{content:"";display:block;width:18px;height:2px;background:#111;box-shadow:0 -6px #111,0 6px #111}`) }
      : file)
};
const duplicatedIconDrawerBrowser = await runArtifactBrowserGate({
  prepared: duplicatedIconDrawerPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-duplicated-navigation-icon",
  routePaths: ["/"]
});
assert(
  duplicatedIconDrawerBrowser.findings.some((finding) =>
    finding.route === "/"
    && finding.id === "functional.navigation_toggle"
    && isTechnicalReleaseBlocker(finding)
    && /competing generated icon/.test(finding.message)),
  "A second generated hamburger drawn over the managed navigation icon did not fail the technical release gate."
);

const siblingDisclosurePrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? {
        ...route,
        html: route.html.replace(
          /<nav>([\s\S]*?)<\/nav>/,
          '<nav style="display:none">$1</nav><details><summary>Menu</summary><div>$1</div></details>'
        )
      }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? {
        ...file,
        bytes: Buffer.from(file.bytes.toString("utf8").replace(
          /<nav>([\s\S]*?)<\/nav>/,
          '<nav style="display:none">$1</nav><details><summary>Menu</summary><div>$1</div></details>'
        ))
      }
    : file)
};
const siblingDisclosureBrowser = await runArtifactBrowserGate({
  prepared: siblingDisclosurePrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-sibling-disclosure-navigation"
});
assert(
  siblingDisclosureBrowser.findings.some((finding) =>
    finding.id === "functional.navigation_reachability"
    && finding.severity === "info"
    && /All \d+ primary destination/.test(finding.message)),
  "A header disclosure whose links are siblings of the desktop nav did not reveal hit-testable primary destinations."
);

const nestedManagedNavigationMarkup = `<nav class="nested-desktop-navigation"><a href="/">Home</a><details><summary>Services</summary><div><a href="/contact">Contact</a></div></details></nav><div class="nested-mobile-navigation" data-lodesta-navigation-disclosure="nested-navigation" data-lodesta-navigation-behavior="modal"><button type="button" aria-controls="nested-navigation" aria-expanded="false" aria-label="Open navigation" data-lodesta-menu-toggle data-lodesta-open-label="Open navigation" data-lodesta-close-label="Close navigation">Menu</button><div id="nested-navigation" class="nested-navigation-panel" role="dialog" aria-modal="true" aria-label="Primary" hidden data-lodesta-menu data-lodesta-navigation-panel><nav aria-label="Primary"><a href="/">Home</a><details><summary>Services</summary><div class="nested-navigation-links"><span>Ant control</span><span>Rodent control</span><span>Termite control</span><span>Mosquito control</span><span>Spider control</span><span>Commercial pest control</span><a href="/contact">Contact</a></div></details></nav></div></div>`;
const nestedDisclosurePrepared = {
  ...prepared,
  routes: prepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace(/<nav>[\s\S]*?<\/nav>/, nestedManagedNavigationMarkup) }
    : route),
  files: prepared.files.map((file) => file.path === "index.html"
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace(/<nav>[\s\S]*?<\/nav>/, nestedManagedNavigationMarkup)) }
    : file.path === "site.css"
      ? { ...file, bytes: Buffer.from(`${file.bytes.toString("utf8")}\n.nested-mobile-navigation{display:none}.nested-desktop-navigation details[open]::after{content:"";position:fixed;inset:0;background:#f00;z-index:999;pointer-events:none}.nested-navigation-panel{background:#fff;color:#17211b;padding:24px;overflow:auto}.nested-navigation-panel nav{display:block}.nested-navigation-links{display:grid;gap:20px}.nested-navigation-links span,.nested-navigation-links a{display:block;min-height:80px}@media(max-width:640px){.nested-desktop-navigation{display:none}.nested-mobile-navigation{display:block}}`) }
      : file)
};
const nestedDisclosureBrowser = await runArtifactBrowserGate({
  prepared: nestedDisclosurePrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-nested-disclosure-navigation",
  routePaths: ["/"],
  captureMode: "review",
  viewports: [
    { name: "desktop", width: 1280, height: 900 },
    { name: "mobile", width: 390, height: 844 }
  ]
});
assert(
  nestedDisclosureBrowser.findings.filter((finding) =>
    finding.id === "functional.navigation_reachability").every((finding) => finding.severity === "info"),
  `Nested desktop and mobile disclosures did not reveal every destination: ${nestedDisclosureBrowser.findings.filter((finding) => finding.id === "functional.navigation_reachability").map((finding) => finding.message).join(" | ")}`
);
const nestedDesktopTop = nestedDisclosureBrowser.captures.find((capture) =>
  capture.viewport === "desktop" && capture.frame === "top");
assert(nestedDesktopTop, "The nested-disclosure regression did not retain its desktop top frame.");
const nestedDesktopPixels = await sharp(nestedDesktopTop.bytes).removeAlpha().raw().toBuffer({ resolveWithObject: true });
let nestedRedPixelCount = 0;
for (let offset = 0; offset < nestedDesktopPixels.data.length; offset += nestedDesktopPixels.info.channels) {
  if (nestedDesktopPixels.data[offset] === 255
    && nestedDesktopPixels.data[offset + 1] === 0
    && nestedDesktopPixels.data[offset + 2] === 0) nestedRedPixelCount += 1;
}
assert.equal(nestedRedPixelCount, 0, "Navigation reachability left the desktop Services disclosure open and contaminated later visual evidence.");

const unreachableDisclosurePrepared = {
  ...disclosureNavigationPrepared,
  routes: disclosureNavigationPrepared.routes.map((route) => route.path === "/"
    ? { ...route, html: route.html.replace("<summary>Menu</summary>", '<summary style="display:none">Menu</summary>') }
    : route),
  files: disclosureNavigationPrepared.files.map((file) => file.path === "index.html"
    ? { ...file, bytes: Buffer.from(file.bytes.toString("utf8").replace("<summary>Menu</summary>", '<summary style="display:none">Menu</summary>')) }
    : file)
};
const unreachableDisclosureBrowser = await runArtifactBrowserGate({
  prepared: unreachableDisclosurePrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-unreachable-disclosure"
});
assert(
  unreachableDisclosureBrowser.findings.some((finding) =>
    finding.id === "functional.navigation_reachability"
    && finding.severity === "error"
    && isTechnicalReleaseBlocker(finding)
    && /not reachable/.test(finding.message)),
  "A closed navigation disclosure with no visible control did not block release as unreachable navigation."
);
assert(
  browser.findings.some((finding) =>
    finding.id === "functional.navigation_reachability"
    && finding.severity === "info"),
  "Visible horizontal navigation did not pass the general reachability assertion."
);

const intentionalScrollPrepared = {
  ...prepared,
  files: prepared.files.map((file) => file.path === "site.css"
    ? { ...file, bytes: Buffer.from(`${file.bytes.toString("utf8")}[data-lodesta-map]{height:225px;overflow:auto}`) }
    : file)
};
const intentionalScrollBrowser = await runArtifactBrowserGate({
  prepared: intentionalScrollPrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-render-intentional-scroll"
});
assert(
  !intentionalScrollBrowser.findings.some((finding) => finding.id === "render.managed_content_clipped"),
  "An intentionally scrollable managed block was incorrectly treated as unreachable content."
);
const scrollTable = '<table><thead><tr><th scope="col">Name</th><th scope="col">Purpose</th><th scope="col">Duration</th></tr></thead><tbody><tr><th scope="row">Preferences</th><td><span class="cookie-purpose">This cookie remembers the preferences selected by visitors when they use the website.</span></td><td>Thirty days</td></tr></tbody></table>';
const scrollTablePrepared = prepareSiteArtifact({
  buildInput,
  runtimeSeriesId: "site-runtime-v4",
  authoredArtifact: {
    kind: "agent-authored-artifact",
    compilerManifest: expectedSiteSandboxManifest,
    siteName: String(name.value),
    sharedCss: 'body{margin:0;padding:20px;font:18px/1.6 Arial;color:#111;background:#fff}*{box-sizing:border-box}h1{font-size:28px}table{width:850px;border-collapse:collapse}td,th{padding:12px;text-align:left}th:first-child{width:150px}td:last-child{width:150px}.table-scroll{width:320px;overflow:auto}.clipped-cell .cookie-purpose{display:block;width:100px;overflow:hidden;white-space:nowrap}.clipped-scrollport{width:140px;overflow:hidden}',
    routes: [
      { path: "/", title: "Scrollable table", description: "A complete table reached by horizontal scrolling.", bodyHtml: `<main><h1>Cookie information</h1><div class="table-scroll" tabindex="0" role="region" aria-label="Cookie information">${scrollTable}</div></main>` },
      { path: "/clipped-cell", title: "Clipped table cell", description: "A cell that hides text inside an otherwise scrollable table.", bodyHtml: `<main class="clipped-cell"><h1>Cookie information</h1><div class="table-scroll" tabindex="0" role="region" aria-label="Cookie information">${scrollTable}</div></main>` },
      { path: "/clipped-scrollport", title: "Clipped scrollport", description: "An enclosing box makes part of the scrollport unavailable.", bodyHtml: `<main><h1>Cookie information</h1><div class="clipped-scrollport"><div class="table-scroll" tabindex="0" role="region" aria-label="Cookie information">${scrollTable}</div></div></main>` }
    ],
    capabilityBindings: []
  }
});
const scrollTableBrowser = await runArtifactBrowserGate({
  prepared: scrollTablePrepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/site-authoring-scrollable-table",
  routePaths: ["/", "/clipped-cell", "/clipped-scrollport"],
  viewports: [{ name: "mobile", width: 375, height: 812 }]
});
assert(
  !scrollTableBrowser.findings.some((finding) => finding.route === "/" && finding.id === "render.text_clipping"),
  "Text reachable by scrolling an intact table was incorrectly classified as permanently clipped."
);
for (const path of ["/clipped-cell", "/clipped-scrollport"]) {
  assert(
    scrollTableBrowser.findings.some((finding) => finding.route === path && finding.id === "render.text_clipping"),
    `Genuinely hidden table text escaped clipping verification at ${path}.`
  );
}
console.log(JSON.stringify({ ok: true, routes: browser.routesChecked, captures: browser.captures.length, links: browser.linksChecked }));

async function canonicalLogoFixture(
  bytes: Buffer,
  origin: "source_website" | "owner_upload",
  suffix: string
) {
  const revisionId = `asset_revision_logo_${suffix.replace(/[^a-z0-9_-]/gi, "_")}`;
  const storageKey = `verification/assets/${revisionId}.png`;
  const contentHash = sha256(bytes);
  const metadata = await sharp(bytes).metadata();
  assert(metadata.width && metadata.height);
  const fixtureBuildInput = {
    ...buildInput,
    business: {
      ...buildInput.business,
      assets: [{
        assetId: `asset_logo_${suffix.replace(/[^a-z0-9_-]/gi, "_")}`,
        revisionId,
        kind: "logo" as const,
        contentHash,
        storageKey,
        mimeType: "image/png" as const,
        alt: "Arbitrary retained description",
        width: metadata.width,
        height: metadata.height,
        origin,
        sourceFactIds: [],
        activeForFutureBuilds: true
      }]
    },
    assetRevisionIds: [revisionId]
  };
  const blobStore = new MemoryBlobStore();
  await blobStore.putImmutable({ key: storageKey, bytes, contentType: "image/png", contentHash });
  return { revisionId, buildInput: fixtureBuildInput, blobStore };
}

async function retainedPhotoFixture(bytes: Buffer, suffix: string) {
  const normalizedSuffix = suffix.replace(/[^a-z0-9_-]/gi, "_");
  const revisionId = `asset_revision_photo_${normalizedSuffix}`;
  const storageKey = `verification/assets/${revisionId}.png`;
  const contentHash = sha256(bytes);
  const metadata = await sharp(bytes).metadata();
  assert(metadata.width && metadata.height);
  const fixtureBuildInput = {
    ...buildInput,
    business: {
      ...buildInput.business,
      assets: [{
        assetId: `asset_photo_${normalizedSuffix}`,
        revisionId,
        kind: "photo" as const,
        contentHash,
        storageKey,
        mimeType: "image/png" as const,
        alt: "Finished wallcovering installation",
        width: metadata.width,
        height: metadata.height,
        origin: "source_website" as const,
        sourceFactIds: [],
        activeForFutureBuilds: true
      }]
    },
    assetRevisionIds: [revisionId]
  };
  const blobStore = new MemoryBlobStore();
  await blobStore.putImmutable({ key: storageKey, bytes, contentType: "image/png", contentHash });
  return { revisionId, buildInput: fixtureBuildInput, blobStore };
}
