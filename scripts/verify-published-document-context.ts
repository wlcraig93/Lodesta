import assert from "node:assert/strict";
import { customDomainRoutedHeader } from "../lib/host-routing";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { Parser } from "htmlparser2";
import { buildSyntheticSiteInput } from "./support/synthetic-site-input";
import { expectedSiteSandboxManifest } from "../packages/site-contracts/platform-manifest";
import { agentAuthoredArtifactSchema, normalizeAgentAuthoredArtifact, prepareSiteArtifact, finalizePreparedArtifact } from "../packages/site-verification";
import { configuredArtifactBlobStore, persistFinalArtifact, readVerifiedArtifactFile } from "../packages/site-artifacts";
import { sitePlatformRepository as repository } from "../packages/platform-data";
import { buildSiteRuntimeBytes } from "../packages/trusted-runtime";
import { bindPublishedDocumentContext } from "../packages/site-platform/public-document-context";
import { GET } from "../app/sites/[slug]/[[...path]]/route";
import { resolveAnalyticsServingContext } from "../lib/analytics-ingestion";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";
import { platformOperationsRepository } from "../packages/platform-operations";
import { POST as submitForm } from "../app/api/forms/submit/route";
import { createLocalOwnerNotificationRepository } from "../packages/owner-notifications";
import { siteCapabilityRepository } from "../packages/site-capabilities";
import { createLocalSiteMonitorRepository, createSiteMonitor } from "../packages/site-monitoring";

assert.notEqual(process.env.LODESTA_REPOSITORY, "supabase", "This fixture is local only.");
const previousCwd = process.cwd();
const runtime = await buildSiteRuntimeBytes("site-runtime-v4");
const directory = await mkdtemp(join(tmpdir(), "lodesta-public-context-"));
const previousStorage = process.env.LODESTA_ARTIFACT_STORAGE;
process.env.LODESTA_ARTIFACT_STORAGE = "local";
process.chdir(directory);
const input = buildSyntheticSiteInput();
const body = `<header><strong data-lodesta-business-name data-lodesta-identity-status="verified" data-lodesta-fact-id="business:name">Northstar Collision Repair</strong></header><main>
  <h1>Collision repair</h1><p data-lodesta-fact-id="fact_service_collision">Collision Repair</p>
  <a href="tel:+15125550142" data-lodesta-fact-id="fact_phone">(512) 555-0142</a>
  <form data-lodesta-form-id="form_estimate" data-lodesta-form-key="estimate_request" data-lodesta-form-revision="1" data-lodesta-form-destination="lead_inbox">
  <label for="name">Name</label><input id="name" data-lodesta-field-id="name" name="name" required>
  <label for="phone">Phone</label><input id="phone" data-lodesta-field-id="phone" name="phone" type="tel" required>
  <label for="message">What happened?</label><textarea id="message" data-lodesta-field-id="message" name="message"></textarea>
  <button type="submit" data-lodesta-form-submit>Request an estimate</button><p data-lodesta-form-status aria-live="polite" aria-atomic="true"></p></form></main>`;
const prepared = prepareSiteArtifact({ buildInput: input, runtimeSeriesId: "site-runtime-v4",
  authoredArtifact: agentAuthoredArtifactSchema.parse(normalizeAgentAuthoredArtifact({ kind: "agent-authored-artifact", compilerManifest: expectedSiteSandboxManifest,
    siteName: input.business.name, sharedCss: "body{font-family:Arial}input,button{min-height:48px}",
    routes: ["/", "/contact"].map(path => ({ path, title: input.business.name, description: "Collision repair in Austin.", bodyHtml: body })) })) });
const finalized = finalizePreparedArtifact({ prepared, buildInput: input, artifactId: "artifact_context_test",
  workspaceRevisionId: "workspace_context_test", runtimeSeriesId: "site-runtime-v4", runtimePatchId: "patch_context_test",
  storagePrefix: "artifacts/context-test", toolchainVersion: "test", sandboxImageDigest: `sha256:${"b".repeat(64)}`,
  browserGate: { findings: [], screenshotKeys: [], routesChecked: 2, linksChecked: 1 } });
assert.equal(finalized.artifact.qa.hardGate, "passed", JSON.stringify(finalized.artifact.qa.findings));
const store = configuredArtifactBlobStore();
await persistFinalArtifact({ ...finalized, store });
let active = true;
const version = { id: "version_context_test", siteId: input.siteId, status: "published", artifactId: finalized.artifact.id,
  artifactHash: finalized.artifact.artifactHash, publicBuildInputId: input.id, createdAt: input.createdAt };
const originals = { getSiteBySlug: repository.getSiteBySlug, getSiteVersion: repository.getSiteVersion,
  getBuildArtifact: repository.getBuildArtifact, getPublicBuildInput: repository.getPublicBuildInput, getSiteIntent: repository.getSiteIntent };
Object.assign(repository, {
  getSiteBySlug: async () => ({ id: input.siteId, slug: "context-test", status: active ? "active" : "paused", publishedVersionId: version.id }),
  getSiteVersion: async () => version, getBuildArtifact: async () => finalized.artifact,
  getPublicBuildInput: async () => input, getSiteIntent: async () => input.intent
});
const analytics: Record<string, unknown>[] = [];
const forms: Record<string, unknown>[] = [];
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (url.pathname.startsWith("/_lodesta/runtime/")) { response.writeHead(200, { "content-type": "application/javascript" }); response.end(runtime); return; }
    if (url.pathname.startsWith("/api/")) {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      (url.pathname.includes("forms") ? forms : analytics).push(JSON.parse(Buffer.concat(chunks).toString()));
      response.writeHead(200, { "content-type": "application/json" }); response.end('{"accepted":true}'); return;
    }
    const path = url.pathname.replace(/^\/sites\/context-test\/?/, "").split("/").filter(Boolean);
    const result = await GET(new Request(`http://${request.headers.host}${request.url}`), { params: Promise.resolve({ slug: "context-test", path }) });
    response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(Buffer.from(await result.arrayBuffer()));
  } catch (error) { response.writeHead(500); response.end(String(error)); }
});
await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
assert(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch();
try {
  for (const route of finalized.artifact.routes) {
    const retained = await readVerifiedArtifactFile({ artifact: finalized.artifact, path: route.htmlFile, store });
    assert(retained);
    assert(!retained.bytes.toString().includes("data-lodesta-version-id"), "Fixture bypassed the real finalizer gap.");
    for (const customDomain of [false, true]) {
      const response = await GET(new Request(`${origin}${customDomain ? "" : "/sites/context-test"}${route.path}`, {
        headers: customDomain ? { [customDomainRoutedHeader]: "1" } : {}
      }), { params: Promise.resolve({ slug: "context-test", path: route.path.split("/").filter(Boolean) }) });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-lodesta-site-version"), version.id);
      const html = await response.text();
      let attributes: Record<string, string> = {};
      new Parser({ onopentag(name, values) { if (name === "html") attributes = values; } }).end(html);
      assert.equal(attributes["data-lodesta-version-id"], version.id);
      assert.equal(attributes["data-lodesta-site-id"], input.siteId);
      assert.equal(html.slice(html.indexOf("<head>")), retained.bytes.toString().slice(retained.bytes.toString().indexOf("<head>")));
    }
    assert.deepEqual((await store.get(retained.key))?.bytes, retained.bytes);
  }
  const page = await browser.newPage();
  await page.goto(`${origin}/sites/context-test/contact`, { waitUntil: "networkidle" });
  assert(analytics.some(event => event.versionId === version.id && event.eventType === "page_view"));
  await page.fill('[name="name"]', "Synthetic visitor"); await page.fill('[name="phone"]', "5125550199");
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => document.querySelector("[data-lodesta-form-status]")?.textContent?.includes("sent"));
  assert.equal(forms.length, 1); assert.equal(forms[0].versionId, version.id);
  assert.equal(forms[0].pageViewId, analytics.find(event => event.eventType === "page_view")?.pageViewId);
  assert.deepEqual(await page.context().cookies(), []);
  assert.deepEqual(await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) })), { local: [], session: [] });
  const stale = await resolveAnalyticsServingContext(new Request("http://localhost/api/analytics", { headers: {
    host: "localhost", referer: "http://localhost/sites/context-test", "user-agent": "Mozilla/5.0 Safari/605.1.15"
  } }), input.siteId, "version_not_current");
  assert.deepEqual(stale.ok ? null : [stale.status, stale.reason], [409, "invalid"], "A stale rendered version was accepted.");
  // A form on a page loaded before a republish is served by the current
  // version; the published form references then decide acceptance.
  const staleForm = await resolveAnalyticsServingContext(new Request("http://localhost/api/forms/submit", { headers: {
    host: "localhost", referer: "http://localhost/sites/context-test", "user-agent": ""
  } }), input.siteId, "version_not_current", { requireAnalytics: false, purpose: "form" });
  assert.equal(staleForm.ok && staleForm.version.id, version.id, "A lead from a page loaded before republish was rejected.");
  // Custom domains end to end: the headers the real middleware forwards reach
  // the real page handler, which serves the page instead of redirecting to itself.
  {
    const realFetch = globalThis.fetch;
    const originalListDomains = platformOperationsRepository.listDomains;
    globalThis.fetch = (async () => Response.json({ resolved: true, slug: "context-test", siteId: input.siteId, domainStatus: "active" })) as typeof fetch;
    platformOperationsRepository.listDomains = async () => [{ siteId: input.siteId, hostname: "pilot.example.com", status: "active" }] as never;
    try {
      const routed = await middleware(new NextRequest("https://pilot.example.com/", { headers: { host: "pilot.example.com" } }));
      const rewrite = routed.headers.get("x-middleware-rewrite");
      assert(rewrite && new URL(rewrite).pathname === "/sites/context-test", `Custom domain was not rewritten to the site: ${rewrite}`);
      const forwarded = new Headers();
      for (const name of (routed.headers.get("x-middleware-override-headers") ?? "").split(",").filter(Boolean)) {
        const value = routed.headers.get(`x-middleware-request-${name}`);
        if (value !== null) forwarded.set(name, value);
      }
      const page = await GET(new Request(rewrite, { headers: forwarded }), { params: Promise.resolve({ slug: "context-test", path: [] }) });
      assert.equal(page.status, 200, "A live custom domain redirected to itself instead of serving the page.");
      const platformPath = await GET(new Request(`${origin}/sites/context-test/contact/`), { params: Promise.resolve({ slug: "context-test", path: ["contact"] }) });
      assert.equal(platformPath.status, 308);
      assert.equal(platformPath.headers.get("location"), "https://pilot.example.com/contact");

      // trailingSlash: true redirects API calls to their slashed form; both must reach the handlers.
      for (const path of ["/api/forms/submit", "/api/forms/submit/", "/api/analytics", "/api/analytics/"]) {
        const api = await middleware(new NextRequest(`https://pilot.example.com${path}`, { method: "POST", headers: { host: "pilot.example.com" } }));
        assert.notEqual(api.status, 404, `${path} was unreachable on a custom domain.`);
      }

      // Restricted pilot pages are never cacheable, even after a successful sign-in.
      process.env.LODESTA_PILOT_ACCESS_CREDENTIAL = "team:pilot-secret";
      process.env.LODESTA_PILOT_RESTRICTED_HOSTS = "pilot.example.com";
      try {
        const authorization = `Basic ${Buffer.from("team:pilot-secret").toString("base64")}`;
        const signedIn = await middleware(new NextRequest("https://pilot.example.com/", { headers: { host: "pilot.example.com", authorization } }));
        assert.equal(signedIn.headers.get("cache-control"), "private, no-store");
        assert.match(signedIn.headers.get("vary") ?? "", /Authorization/);
        forwarded.set("authorization", authorization);
        const restrictedPage = await GET(new Request(rewrite, { headers: forwarded }), { params: Promise.resolve({ slug: "context-test", path: [] }) });
        assert.equal(restrictedPage.status, 200);
        assert.equal(restrictedPage.headers.get("cache-control"), "private, no-store", "A signed-in pilot page was publicly cacheable.");
        const anonymous = await middleware(new NextRequest("https://pilot.example.com/", { headers: { host: "pilot.example.com" } }));
        assert.equal(anonymous.status, 401, "An anonymous request after a signed-in one was served.");
      } finally {
        delete process.env.LODESTA_PILOT_ACCESS_CREDENTIAL;
        delete process.env.LODESTA_PILOT_RESTRICTED_HOSTS;
      }
    } finally {
      globalThis.fetch = realFetch;
      platformOperationsRepository.listDomains = originalListDomains;
    }
  }
  // Monitoring end to end: the monitor's own requests go through the real
  // middleware, page route and form endpoint, and the synthetic inquiry must
  // land in the real inbox with the real form schema.
  {
    const originalGetPublishedForm = repository.getPublishedFormDefinition;
    repository.getPublishedFormDefinition = async (siteId: string, formId: string) => {
      const form = input.forms.find((item) => item.id === formId);
      return form && siteId === input.siteId ? { ...form, schemaVersion: 1, siteId, status: "published" } as never : undefined;
    };
    try {
      const appOrigin = "http://localhost:4330";
      const dispatch = (async (target: string | URL, init?: RequestInit) => {
        const request = new NextRequest(String(target), { ...init, headers: { host: new URL(String(target)).host, ...Object.fromEntries(new Headers(init?.headers)) } } as never);
        const routed = await middleware(request);
        if (routed.status >= 400 || routed.headers.get("location")) return routed;
        const url = new URL(String(target));
        if (url.pathname.startsWith("/api/forms/submit")) {
          return submitForm(new Request(url, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), host: url.host } }));
        }
        if (url.pathname.startsWith("/_lodesta/runtime/")) return new Response(runtime, { status: 200, headers: { "content-type": "application/javascript" } });
        const path = url.pathname.replace(/^\/sites\/context-test\/?/, "").split("/").filter(Boolean);
        return GET(new Request(url, init), { params: Promise.resolve({ slug: "context-test", path }) });
      }) as typeof fetch;
      const monitorDirectory = await mkdtemp(join(tmpdir(), "lodesta-monitor-e2e-"));
      const monitor = createSiteMonitor({
        checks: createLocalSiteMonitorRepository(join(monitorDirectory, "checks.json")),
        alerts: createLocalOwnerNotificationRepository(join(monitorDirectory, "alerts.json")),
        inquiries: siteCapabilityRepository,
        platform: {
          listSites: async () => [{ id: input.siteId, slug: "context-test", status: "active", publishedVersionId: version.id }] as never,
          getSiteVersion: async () => ({ ...version, formDefinitionIds: input.forms.map((form) => form.id) }) as never,
          getPublicBuildInput: async () => input
        },
        domains: { listDomains: async () => [] },
        fetch: dispatch,
        certificateExpiry: async () => undefined,
        appOrigin: () => appOrigin,
        syntheticFormSiteId: () => input.siteId
      });
      // Three scheduled cycles against retained state: every fresh probe must
      // pass even though the inbox deduplicates identical visitor submissions.
      for (const offsetMinutes of [0, 16, 32]) {
        const checks = await monitor.runDueChecks(new Date(Date.now() + offsetMinutes * 60_000));
        assert.deepEqual(checks.map((check) => `${check.kind}:${check.ok}`), ["site:true", "form:true"],
          `Monitoring cycle +${offsetMinutes}m failed against the real routes: ${JSON.stringify(await createLocalSiteMonitorRepository(join(monitorDirectory, "checks.json")).recent(input.siteId, "form", 1))}`);
      }
      await rm(monitorDirectory, { recursive: true, force: true });
    } finally {
      repository.getPublishedFormDefinition = originalGetPublishedForm;
    }
  }
  active = false;
  assert.equal((await GET(new Request(`${origin}/sites/context-test`), { params: Promise.resolve({ slug: "context-test" }) })).status, 404);
  const tricky = '<!-- <html> --><HTML data-lodesta-site-id="site_test" title="a > b &amp; c"><head></head><body>untouched</body></HTML>';
  const bound = bindPublishedDocumentContext(tricky, { siteId: "site_test", versionId: 'version_"<&' });
  assert(bound.includes('data-lodesta-version-id="version_&quot;&lt;&amp;"'));
  assert.equal(bindPublishedDocumentContext(bound, { siteId: "site_test", versionId: 'version_"<&' }), bound);
  assert.throws(() => bindPublishedDocumentContext(tricky, { siteId: "wrong", versionId: "version" }), /published_document_context_invalid/);
  console.log(JSON.stringify({ ok: true, finalizerToPublicRouteToRuntime: "pass", nestedAndCustomDomain: "pass",
    immutableArtifactBytes: "unchanged", formVersionBinding: "pass", browserStorage: "empty", pausedSite: "404" }));
} finally {
  Object.assign(repository, originals);
  await browser.close(); await new Promise<void>(resolve => server.close(() => resolve()));
  process.chdir(previousCwd);
  if (previousStorage === undefined) delete process.env.LODESTA_ARTIFACT_STORAGE; else process.env.LODESTA_ARTIFACT_STORAGE = previousStorage;
  await rm(directory, { recursive: true, force: true });
}
