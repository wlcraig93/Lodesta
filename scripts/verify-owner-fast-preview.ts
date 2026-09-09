import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import {
  fastPreviewContentSecurityPolicy,
  resolveOwnerPreviewAsset,
  rewriteFastPreview
} from "../app/api/site-agent/sessions/[sessionId]/preview/[[...path]]/route";
import { LocalArtifactBlobStore } from "../packages/site-artifacts/blob-store";
import { sha256, stableJson } from "../packages/business-data";
import { assetRevisionRefSchema, siteAgentRunEventSchema } from "../packages/site-contracts";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build, type Plugin } from "esbuild";
import { chromium } from "playwright";

const rendered = rewriteFastPreview([
  '<a href="/">Home</a>',
  '<img src="/_lodesta/assets/asset_revision_logo" alt="Logo">',
  '<a href="/_lodesta/assets/asset_revision_download">Download</a>',
  '<a href="/services">Services</a>',
  '<a href="#contact">Contact</a>',
  '<a href="https://example.com/">External</a>',
  '</body>'
].join(""), "session owner/preview", "site-runtime-v4");

const base = "/api/site-agent/sessions/session%20owner%2Fpreview/preview";
assert.match(rendered, new RegExp(`href="${base}/"`));
assert.match(rendered, new RegExp(`src="${base}/_lodesta/assets/asset_revision_logo"`));
assert.match(rendered, new RegExp(`href="${base}/_lodesta/assets/asset_revision_download"`));
assert.match(rendered, new RegExp(`href="${base}/services"`));
assert.match(rendered, /href="#contact"/);
assert.match(rendered, /href="https:\/\/example\.com\/"/);
assert.match(rendered, /<script src="\/_lodesta\/runtime\/site-runtime-v4\.js" defer data-lodesta-runtime="site-runtime-v4"><\/script><\/body>/);
assert.match(fastPreviewContentSecurityPolicy, /script-src 'self'/);
assert.doesNotMatch(fastPreviewContentSecurityPolicy, /script-src 'none'/);
assert.match(fastPreviewContentSecurityPolicy, /font-src 'self'/);
assert.doesNotMatch(fastPreviewContentSecurityPolicy, /font-src (?!'self')/);

const retainedRuntime = rewriteFastPreview(
  '<body><script src="/_lodesta/runtime/site-runtime-v4.js" defer data-lodesta-runtime="site-runtime-v4"></script></body>',
  "session owner/preview",
  "site-runtime-v4"
);
assert.equal((retainedRuntime.match(/data-lodesta-runtime=/g) ?? []).length, 1);
assert.match(retainedRuntime, /src="\/_lodesta\/runtime\/site-runtime-v4\.js"/);

const blobRoot = await mkdtemp(join(tmpdir(), "lodesta-owner-preview-"));
const blobStore = new LocalArtifactBlobStore(blobRoot);
const assetBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const assetHash = sha256(assetBytes);
const asset = assetRevisionRefSchema.parse({
  assetId: "asset_staged",
  revisionId: "asset_revision_staged",
  kind: "logo",
  contentHash: assetHash,
  storageKey: "source-mirror/staged.bin",
  mimeType: "image/png",
  alt: "Staged logo",
  origin: "source_website",
  sourceFactIds: [],
  activeForFutureBuilds: true
});
await blobStore.putImmutable({ key: asset.storageKey, bytes: assetBytes, contentType: asset.mimeType, contentHash: assetHash });
const payloadBytes = Buffer.from(stableJson({ diagnosticResult: { ok: true, asset } }));
const payloadHash = sha256(payloadBytes);
const payloadRef = "agent-run-events/run_preview/event_asset/payload.json";
await blobStore.putImmutable({ key: payloadRef, bytes: payloadBytes, contentType: "application/json", contentHash: payloadHash });
const event = siteAgentRunEventSchema.parse({
  schemaVersion: "site-agent-run-event",
  id: "event_staged_asset",
  runId: "run_preview",
  sequence: 1,
  kind: "tool_call",
  name: "adopt_source_asset",
  status: "succeeded",
  summary: {},
  payloadRef,
  payloadHash,
  startedAt: new Date().toISOString(),
  completedAt: new Date().toISOString()
});
const staged = await resolveOwnerPreviewAsset({
  revisionId: asset.revisionId,
  businessId: "business_preview",
  runId: "run_preview",
  repository: {
    getAssetRevision: async () => undefined,
    listAgentRunEvents: async () => [event]
  },
  blobStore
});
assert.equal(staged?.mimeType, "image/png");
assert.deepEqual(staged?.bytes, assetBytes);

const denied = await resolveOwnerPreviewAsset({
  revisionId: "asset_revision_other",
  businessId: "business_preview",
  runId: "run_preview",
  repository: {
    getAssetRevision: async () => undefined,
    listAgentRunEvents: async () => [event]
  },
  blobStore
});
assert.equal(denied, undefined);

// Invoke the actual session-preview GET through a loopback bridge. The route's
// repository/auth/sandbox boundaries are local fixtures, but the CSP response
// is produced by the real route and Chromium loads a real self-hosted WOFF2.
const sandboxFont = await readFile("public/_lodesta/fonts/inter-latin-variable.woff2");
const fixtureSessionId = "session_preview_font";
const fixtureRuntimeId = "site-runtime-fixture";
const fixtureRoute = resolve("app/api/site-agent/sessions/[sessionId]/preview/[[...path]]/route.ts");
const fixtureDependencies: Plugin = {
  name: "owner-fast-preview-route-fixture-dependencies",
  setup(builder) {
    const stubs: Record<string, string> = {
      "@/packages/platform-data": `export const sitePlatformRepository = {
        getAgentSession: async () => ({ id: ${JSON.stringify(fixtureSessionId)}, siteId: "site_preview_fixture", principal: { kind: "owner", id: "owner_preview_fixture" }, sandboxId: "sandbox_preview_fixture", publicBuildInputId: "input_preview_fixture", sandboxDeploymentId: "deployment_preview_fixture" }),
        listAgentRuns: async () => ([{ id: "run_preview_fixture", status: "running", startedAt: "2026-09-09T00:00:00.000Z" }]),
        getPublicBuildInput: async () => ({ capabilityConfiguration: { trustedRuntimeSeries: ${JSON.stringify(fixtureRuntimeId)} } }),
        getRuntimeSeries: async () => ({ activePatchId: "patch_preview_fixture" }),
        getRuntimePatch: async () => ({ securityStatus: "audited", compatibilityStatus: "passed" }),
        getSandboxDeployment: async () => ({ id: "deployment_preview_fixture" }),
        getSite: async () => ({ id: "site_preview_fixture", businessId: "business_preview_fixture" }),
        getAssetRevision: async () => undefined,
        listAgentRunEvents: async () => []
      };`,
      "@/app/api/site-agent/auth": `export async function authorizedSiteActor(){ return { ok: true, actorId: "owner_preview_fixture" }; } export function canAccessAgentSession(){ return true; }`,
      "@/packages/site-sandbox": `export function configuredSiteSandboxRuntimeForDeployment(){ return { url: globalThis.__ownerPreviewFixtureSandboxUrl, token: "fixture-token" }; }`,
      "@/packages/site-artifacts": `export function configuredArtifactBlobStore(){ return { get: async () => undefined }; }`,
      "@/packages/site-contracts": `export const assetRevisionRefSchema = { safeParse: () => ({ success: false }) };`
    };
    for (const [filter, contents] of Object.entries(stubs)) {
      builder.onResolve({ filter: new RegExp(`^${filter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }, () => ({ path: filter, namespace: "owner-preview-fixture" }));
      builder.onLoad({ filter: new RegExp(`^${filter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`), namespace: "owner-preview-fixture" }, () => ({ contents, loader: "js" }));
    }
  }
};
const routeBuild = await build({
  stdin: { contents: `export { GET } from ${JSON.stringify(fixtureRoute)};`, resolveDir: process.cwd(), loader: "ts" },
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  plugins: [fixtureDependencies]
});
const routeModule = { exports: {} as { GET: (request: Request, context: { params: Promise<{ sessionId: string; path?: string[] }> }) => Promise<Response> } };
new Function("require", "module", "exports", routeBuild.outputFiles[0].text)(createRequire(import.meta.url), routeModule, routeModule.exports);

const sandboxRequests: string[] = [];
const sandboxServer = createServer((request, response) => {
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  sandboxRequests.push(pathname);
  if (pathname.endsWith("/fixture.woff2")) {
    response.writeHead(200, { "content-type": "font/woff2", "cache-control": "no-store" });
    response.end(sandboxFont);
    return;
  }
  if (pathname.includes("/_lodesta/runtime/")) {
    response.writeHead(200, { "content-type": "application/javascript" });
    response.end("");
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><html><head><style>@font-face{font-family:FixtureInter;src:url("fixture.woff2") format("woff2");font-display:block}#fixture{font-family:FixtureInter}</style></head><body><main id="fixture">Self-hosted preview font</main></body></html>`);
});
await new Promise<void>(done => sandboxServer.listen(0, "127.0.0.1", done));
const sandboxAddress = sandboxServer.address();
assert(sandboxAddress && typeof sandboxAddress !== "string");
(globalThis as typeof globalThis & { __ownerPreviewFixtureSandboxUrl?: string }).__ownerPreviewFixtureSandboxUrl = `http://127.0.0.1:${sandboxAddress.port}`;

const previewServer = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const match = url.pathname.match(/^\/api\/site-agent\/sessions\/([^/]+)\/preview\/?(.*)$/);
  if (!match) { response.writeHead(404); response.end(); return; }
  const routeResponse = await routeModule.exports.GET(new Request(url, { headers: request.headers as HeadersInit }), {
    params: Promise.resolve({ sessionId: decodeURIComponent(match[1]), path: match[2] ? match[2].split("/").map(decodeURIComponent) : undefined })
  });
  response.writeHead(routeResponse.status, Object.fromEntries(routeResponse.headers));
  response.end(Buffer.from(await routeResponse.arrayBuffer()));
});
await new Promise<void>(done => previewServer.listen(0, "127.0.0.1", done));
const previewAddress = previewServer.address();
assert(previewAddress && typeof previewAddress !== "string");
const previewOrigin = `http://127.0.0.1:${previewAddress.port}`;
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const fontFailures: string[] = [];
  const fontResponses: number[] = [];
  page.on("requestfailed", request => { if (request.resourceType() === "font") fontFailures.push(request.failure()?.errorText ?? "unknown"); });
  page.on("response", response => { if (response.request().resourceType() === "font") fontResponses.push(response.status()); });
  const previewResponse = await page.goto(`${previewOrigin}/api/site-agent/sessions/${fixtureSessionId}/preview/`, { waitUntil: "networkidle" });
  assert(previewResponse, "The local session-preview bridge returned no document response.");
  assert.equal(previewResponse.headers()["content-security-policy"], fastPreviewContentSecurityPolicy,
    "The browser fixture did not receive the real session-preview CSP response.");
  await page.waitForFunction(async () => { await document.fonts.ready; return document.fonts.check("16px FixtureInter"); });
  assert.deepEqual(fontResponses, [200], "The real session-preview route did not serve its same-origin font.");
  assert.deepEqual(fontFailures, [], "The session-preview CSP blocked its same-origin font.");
  assert(sandboxRequests.some((path) => path.endsWith("/fixture.woff2")), "The route did not proxy the font request to the local sandbox preview.");
} finally {
  await browser.close();
  delete (globalThis as typeof globalThis & { __ownerPreviewFixtureSandboxUrl?: string }).__ownerPreviewFixtureSandboxUrl;
  await new Promise<void>(done => previewServer.close(() => done()));
  await new Promise<void>(done => sandboxServer.close(() => done()));
}

console.log("Owner fast-preview URL rewriting passed.");
