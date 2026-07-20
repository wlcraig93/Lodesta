import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";

const runtime = await readFile("packages/trusted-runtime/site-runtime-v1.js");
new Function(runtime.toString("utf8"));
const analytics: Array<Record<string, unknown>> = [];
const forms: Array<Record<string, unknown>> = [];
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/_lodesta/runtime/site-runtime-v1.js") return send(response, 200, runtime, "application/javascript; charset=utf-8");
  if (request.method === "POST" && url.pathname === "/api/analytics") {
    analytics.push(await jsonBody(request));
    return send(response, 204, Buffer.alloc(0), "application/json");
  }
  if (request.method === "POST" && url.pathname === "/api/forms/submit") {
    forms.push(await jsonBody(request));
    return send(response, 200, Buffer.from('{"accepted":true}'), "application/json");
  }
  if (["/", "/preview/token", "/api/site-versions/version/artifact/", "/analytics-off"].includes(url.pathname)) {
    return send(response, 200, Buffer.from(documentHtml(url.pathname !== "/analytics-off")), "text/html; charset=utf-8", {
      "content-security-policy": "default-src 'none'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'"
    });
  }
  return send(response, 404, Buffer.alloc(0), "text/plain");
});
await new Promise<void>((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
if (!address || typeof address === "string") throw new Error("Runtime verification server did not bind.");
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(origin, { waitUntil: "networkidle" });
  assert.equal(errors.length, 0, errors.join("\n"));
  assert(analytics.some((event) => event.eventType === "pageview" && event.siteId === "site_runtime_test"), "public pageview was not recorded");
  await page.fill('input[name="name"]', "Test visitor");
  await page.click('form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector("[data-lodesta-form-status]")?.textContent === "Sent.");
  assert.equal(forms.length, 1, "managed form did not submit exactly once");
  assert.equal(forms[0].siteId, "site_runtime_test");
  assert.equal(forms[0].formId, "form_runtime_test");
  await page.click("[data-lodesta-map-fallback]");
  await page.waitForTimeout(50);
  assert(analytics.some((event) => event.eventType === "places_ui"), "managed map fallback telemetry was not recorded");
  await page.click('[data-lodesta-gallery-direction="next"]');
  assert.equal(await page.getAttribute('[data-lodesta-menu-toggle]', "aria-expanded"), "false");
  await page.click("[data-lodesta-menu-toggle]");
  assert.equal(await page.getAttribute('[data-lodesta-menu-toggle]', "aria-expanded"), "true");

  const previewRequestsBefore = analytics.length + forms.length;
  const preview = await browser.newPage();
  await preview.goto(`${origin}/preview/token`, { waitUntil: "networkidle" });
  assert(await preview.locator('form[data-lodesta-disabled="true"] button').isDisabled(), "token preview form controls remained enabled");
  assert.equal(analytics.length + forms.length, previewRequestsBefore, "token preview emitted analytics or form traffic");

  const artifactPreview = await browser.newPage();
  await artifactPreview.goto(`${origin}/api/site-versions/version/artifact/`, { waitUntil: "networkidle" });
  assert(await artifactPreview.locator('form[data-lodesta-disabled="true"] input').isDisabled(), "authenticated artifact preview form remained enabled");
  assert.equal(analytics.length + forms.length, previewRequestsBefore, "authenticated artifact preview emitted analytics or form traffic");

  const analyticsOff = await browser.newPage();
  await analyticsOff.goto(`${origin}/analytics-off`, { waitUntil: "networkidle" });
  assert.equal(analytics.length + forms.length, previewRequestsBefore, "analytics-disabled page emitted tracking traffic");
  console.log(JSON.stringify({ ok: true, pageviews: analytics.filter((event) => event.eventType === "pageview").length, formSubmissions: forms.length, previewIsolation: "pass", interactions: "pass" }));
} finally {
  await browser.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function documentHtml(analyticsEnabled: boolean) {
  return `<!doctype html><html data-lodesta-site-id="site_runtime_test" data-lodesta-analytics="${analyticsEnabled}"><head><meta charset="utf-8"><script src="/_lodesta/runtime/site-runtime-v1.js" defer></script></head><body><button type="button" data-lodesta-menu-toggle aria-controls="menu" aria-expanded="false">Menu</button><nav id="menu"></nav><div data-lodesta-gallery="gallery"><button type="button" aria-controls="gallery-track" data-lodesta-gallery-direction="previous">Previous</button><div id="gallery-track"></div><button type="button" aria-controls="gallery-track" data-lodesta-gallery-direction="next">Next</button></div><section data-lodesta-map="location_primary"><a href="#directions" data-lodesta-map-fallback>Directions</a></section><form data-lodesta-form-id="form_runtime_test" data-lodesta-success-message="Sent."><label>Name<input name="name" required></label><button type="submit">Send</button><p data-lodesta-form-status></p></form></body></html>`;
}

async function jsonBody(request: import("node:http").IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function send(
  response: import("node:http").ServerResponse,
  status: number,
  body: Buffer,
  contentType: string,
  headers: Record<string, string> = {}
) {
  response.writeHead(status, { "content-type": contentType, "cache-control": "no-store", ...headers });
  response.end(body);
}
