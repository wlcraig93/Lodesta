import assert from "node:assert/strict";
import type { ArtifactBlobStore, BlobListInput, ImmutableBlob } from "../packages/site-artifacts/blob-store";
import { prepareSiteArtifact, runArtifactBrowserGate } from "../packages/site-verification";
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
  runtimeSeriesId: "site-runtime-v1",
  authoredArtifact: {
    schemaVersion: "agent-authored-artifact-v1",
    siteName: String(name.value),
    sharedCss: `*{box-sizing:border-box}body{margin:0;color:#17211b;background:#f7f4ee;font:18px/1.55 Arial,sans-serif}header,main,footer{padding:28px max(20px,calc((100% - 1080px)/2))}header{display:flex;justify-content:space-between;gap:24px;background:#fff}nav{display:flex;gap:20px;flex-wrap:wrap}a{color:inherit}.hero{padding-block:100px}h1{font:700 clamp(46px,7vw,88px)/1.02 Georgia,serif;letter-spacing:0;max-width:900px}h2{font:700 40px/1.1 Georgia,serif;letter-spacing:0}.button{display:inline-flex;min-height:48px;align-items:center;padding:10px 18px;background:#9b2c20;color:#fff;text-decoration:none}.panel{border-top:1px solid #bbb;padding-block:60px}[data-lodesta-map-surface]{background:#17211b;color:#fff}form,label{display:grid;gap:10px}input,textarea,button{font:inherit;min-height:48px;padding:10px}button{background:#17211b;color:#fff;border:0}@media(max-width:640px){header{align-items:flex-start;flex-direction:column}.hero{padding-block:64px}h1{font-size:48px}}`,
    routes: [
      {
        path: "/",
        title: String(name.value),
        description: "Local collision repair and body work.",
        bodyHtml: `<header><strong data-lodesta-fact-id="${name.id}">${name.value}</strong><nav><a href="/">Home</a><a href="/contact">Contact</a></nav></header><main><section class="hero"><p>Collision care, clearly handled.</p><p>A customer&#x2019;s next step &#x2192;</p><h1 data-lodesta-fact-id="${name.id}">${name.value}</h1><p data-lodesta-fact-id="${service.id}">${service.value}</p><a class="button" href="/contact">Request help</a></section><section data-lodesta-map="location_primary" data-lodesta-place-id="ChIJ-synthetic-location"><div data-lodesta-map-surface><div data-lodesta-location-heading><span data-lodesta-location-verified>Verified location</span><strong data-lodesta-location-name>Main shop</strong></div><address data-lodesta-location-address data-lodesta-fact-id="${address.id}">${address.value}</address><dl data-lodesta-location-hours data-lodesta-fact-id="${hours.id}"><div><dt>Monday</dt><dd>8:00 AM-5:30 PM</dd></div><div><dt>Saturday</dt><dd>Closed</dd></div><div><dt>By appointment</dt><dd>Evenings</dd></div></dl></div><a href="https://www.google.com/maps/search/?api=1&amp;query=place_id%3AChIJ-synthetic-location" target="_blank" rel="noopener noreferrer" data-lodesta-map-fallback>Get directions</a></section></main><footer><a href="tel:${phone.value}" data-lodesta-fact-id="${phone.id}">${phone.value}</a></footer>`
      },
      {
        path: "/contact",
        title: `Contact ${name.value}`,
        description: "Request collision repair help.",
        bodyHtml: `<header><strong data-lodesta-fact-id="${name.id}">${name.value}</strong><nav><a href="/">Home</a><a href="/contact">Contact</a></nav></header><main><section class="hero"><h1>Request repair help</h1><p data-lodesta-fact-id="${phone.id}">Call ${phone.value}</p></section><section class="panel"><h2>Tell us what happened</h2><form data-lodesta-form-id="${form.id}"><label>Name<input name="name" required></label><label>Phone<input name="phone" type="tel" required></label><label>Details<textarea name="message"></textarea></label><button type="submit">${form.submitLabel}</button><p data-lodesta-form-status></p></form></section></main>`
      }
    ],
    claims: [],
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

const browser = await runArtifactBrowserGate({
  prepared,
  buildInput,
  blobStore: new MemoryBlobStore(),
  capturePrefix: "verification/agentic-render"
});
const browserErrors = browser.findings.filter((finding) => finding.severity === "error");
assert.equal(browserErrors.length, 0, browserErrors.map((finding) => `${finding.route ?? "/"} ${finding.id}: ${finding.message}`).join("\n"));
assert(!browser.findings.some((finding) => finding.id === "render.escaped_entity"), "A normal React numeric-entity round trip became visible entity source.");
assert.equal(browser.routesChecked, 2);
assert.equal(browser.captures.length, 6);

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
  capturePrefix: "verification/agentic-render-low-contrast"
});
const contrastFinding = lowContrastBrowser.findings.find((finding) => finding.id === "render.contrast");
assert(contrastFinding?.message.includes("Examples:") && contrastFinding.message.includes("rgb("), "contrast findings do not identify actionable elements and computed colors");
assert(lowContrastBrowser.findings.some((finding) => finding.id === "render.escaped_entity" && finding.message.includes("&#x2019;")), "visible escaped HTML entity source was not rejected");
console.log(JSON.stringify({ ok: true, routes: browser.routesChecked, captures: browser.captures.length, links: browser.linksChecked }));
