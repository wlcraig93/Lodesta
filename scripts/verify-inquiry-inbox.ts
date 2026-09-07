import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build, type Plugin } from "esbuild";
import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { chromium } from "playwright";

// The real baseline row has no notification/enrichment-state columns. Exercise
// the Supabase mapper, CSV endpoint and hydrated inbox with that exact shape.
// All database and browser requests stay on this loopback fixture server.
const inquiryRow = {
  id: "inquiry_fixture", site_id: "site_fixture", source_channel: "form", status: "new",
  contact_name: "Synthetic Customer", contact_email: "fixture@example.com", contact_email_normalized: "fixture@example.com",
  contact_phone: null, contact_phone_normalized: null, ai_enrichment: null, ai_enriched_at: null,
  created_at: "2026-09-07T08:00:00.000Z", updated_at: "2026-09-07T08:00:00.000Z"
};
const eventRow = {
  id: "event_fixture", inquiry_id: inquiryRow.id, site_id: inquiryRow.site_id,
  type: "form_submission", actor: "visitor", message_text: "Synthetic inbox delivery fixture. No service requested.",
  payload: { name: "Synthetic Customer", message: "Please confirm the message is readable." },
  source_url: "https://fixture.example/contact", page_id: null, form_id: "form_fixture",
  metadata: {}, dedupe_key: "fixture_dedupe", created_at: inquiryRow.created_at
};
let markup = "";
let clientScript = "";
const css = (await Promise.all(["app/product-tokens.css", "app/globals.css"].map(path => readFile(path, "utf8")))).join("\n");
const requests: string[] = [];
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  requests.push(`${request.method} ${url.pathname}`);
  if (url.pathname === "/rest/v1/inquiries" || url.pathname === "/rest/v1/inquiry_events") {
    assert.equal(request.method, "GET");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(url.pathname.endsWith("/inquiries") ? [inquiryRow] : [eventRow]));
    return;
  }
  if (url.pathname === "/api/inquiries/status" && request.method === "POST") {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const input = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(input.siteId, inquiryRow.site_id);
    assert.equal(input.inquiryId, inquiryRow.id);
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, inquiry: { status: input.status } }));
    return;
  }
  if (url.pathname === "/fixture.js") {
    response.writeHead(200, { "content-type": "application/javascript" }); response.end(clientScript); return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><html lang="en" data-theme="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><main class="workspace-page workspace-inbox-page"><h1>Customer leads</h1><div id="root">${markup}</div></main><script src="/fixture.js"></script></body></html>`);
});
await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
const address = server.address();
assert(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;
const savedEnvironment = { ...process.env };
process.env.LODESTA_REPOSITORY = "supabase";
process.env.SUPABASE_URL = origin;
process.env.SUPABASE_SERVICE_ROLE_KEY = "inquiry-fixture-not-a-real-secret";
process.env.LODESTA_ADMIN_TOKEN = "inquiry-fixture-admin";
process.env.TZ = "UTC";
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  const { siteCapabilityRepository: repository } = await import("../packages/site-capabilities");
  const inquiries = await repository.listInquiries(inquiryRow.site_id);
  const selected = await repository.getInquiry(inquiryRow.site_id, inquiryRow.id);
  assert(selected);
  assert.deepEqual(inquiries, [selected]);
  assert.equal(selected.aiEnrichment, undefined);
  for (const phantom of ["notificationState", "aiEnrichmentState", "aiEnrichmentError"]) {
    assert(!Object.hasOwn(selected, phantom), `Repository still advertises nonexistent ${phantom}.`);
  }
  const events = await repository.listInquiryEvents(selected.id);
  assert.equal(events[0].messageText, eventRow.message_text);
  const { GET } = await import("../app/api/inquiries/export/route");
  const csvResponse = await GET(new Request(`${origin}/api/inquiries/export?siteId=site_fixture`, {
    headers: { authorization: "Bearer inquiry-fixture-admin" }
  }));
  assert.equal(csvResponse.status, 200);
  const csv = await csvResponse.text();
  assert(csv.includes("Synthetic Customer") && csv.includes("Please confirm the message is readable."));
  assert(!csv.includes("notificationState") && !csv.includes("aiEnrichmentState"));

  const navigation: Plugin = {
    name: "inbox-fixture-navigation",
    setup(builder) {
      builder.onResolve({ filter: /^next\/(navigation|link)$/ }, args => ({ path: args.path, namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, args => ({ resolveDir: process.cwd(), contents: args.path.endsWith("navigation")
        ? `export function useRouter(){return {replace(path){window.__fixturePath=path},refresh(){}}}`
        : `import {createElement} from "react"; export default function Link(props){return createElement("a",props)}` }));
    }
  };
  const component = resolve("components/OwnerInbox.tsx");
  const props = { siteId: inquiryRow.site_id, slug: "fixture", initialInquiries: inquiries,
    eventsByInquiry: { [selected.id]: events }, requestedInquiryId: selected.id,
    timeZone: "America/Chicago", renderedAt: "2026-09-07T08:00:59.999Z" };
  const ssr = await build({ stdin: { contents: `export {OwnerInbox} from ${JSON.stringify(component)}`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic", external: ["react", "react/jsx-runtime"], plugins: [navigation] });
  const module = { exports: {} as { OwnerInbox: ComponentType<typeof props> } };
  new Function("require", "module", "exports", ssr.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
  markup = renderToString(createElement(module.exports.OwnerInbox, props));
  assert(markup.includes(eventRow.message_text));
  assert(!markup.includes("Enrichment is") && !markup.includes("Lodesta triage"));
  const client = await build({ stdin: { contents: `import {hydrateRoot} from "react-dom/client"; import {OwnerInbox} from ${JSON.stringify(component)}; hydrateRoot(document.getElementById("root"), <OwnerInbox {...${JSON.stringify(props)}}/>);`, resolveDir: process.cwd(), loader: "tsx" },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", plugins: [navigation] });
  clientScript = client.outputFiles[0].text;
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, timezoneId: "America/Chicago" });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.locator(".owner-inbox-message").getByText(eventRow.message_text, { exact: true }).waitFor();
  await page.getByRole("button", { name: "Replied", exact: true }).click();
  await page.getByText("Saved.", { exact: true }).waitFor();
  assert.equal(await page.locator(".owner-inbox-detail-header").getByText("Replied", { exact: true }).count(), 1);
  const evidenceDirectory = process.env.LODESTA_INBOX_FIXTURE_EVIDENCE_DIR;
  if (evidenceDirectory) { await mkdir(evidenceDirectory, { recursive: true }); await page.screenshot({ path: resolve(evidenceDirectory, "inbox-desktop.png"), fullPage: true }); }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".owner-inbox-message").getByText(eventRow.message_text, { exact: true }).waitFor();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "Inbox overflows the phone viewport.");
  if (evidenceDirectory) await page.screenshot({ path: resolve(evidenceDirectory, "inbox-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "← Leads", exact: true }).click();
  await page.getByRole("complementary", { name: "Inquiries" }).waitFor();
  assert.deepEqual(errors, []);
  assert(requests.some(path => path === "GET /rest/v1/inquiries"));
  assert(requests.some(path => path === "POST /api/inquiries/status"));
  console.log(JSON.stringify({ ok: true, realRepositoryMapping: true, baselineRowWithoutPhantomStates: true,
    csv: "passed", ssr: "passed", hydration: "passed", statusChange: "passed", phone: "passed", externalRequests: 0 }));
} finally {
  await browser?.close();
  await new Promise<void>(done => server.close(() => done()));
  for (const key of Object.keys(process.env)) if (!(key in savedEnvironment)) delete process.env[key];
  Object.assign(process.env, savedEnvironment);
}
