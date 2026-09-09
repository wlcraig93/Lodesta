import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build, type Plugin } from "esbuild";
import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { chromium, type Page } from "playwright";

// This fixture exercises the real workspace through SSR and browser hydration.
// It stays entirely on a loopback server: no auth, hosted site, or API is used.
const component = resolve("components/SiteAgentWorkspace.tsx");
const css = (await Promise.all(["app/product-tokens.css", "app/globals.css"].map((path) => readFile(path, "utf8")))).join("\n");
const navigation: Plugin = {
  name: "workspace-fixture-navigation",
  setup(builder) {
    builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: "link", namespace: "fixture" }));
    builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
      resolveDir: process.cwd(),
      contents: `import {createElement} from "react"; export default function Link({href, ...props}) { return createElement("a", {...props, href: typeof href === "string" ? href : ""}); }`
    }));
  }
};

const initialSite = {
  id: "site_fixture", slug: "fixture", status: "draft", publishedVersionId: undefined
} as any;
const initialInput = {
  business: { name: "Fixture Heating", offerings: [], contacts: {} },
  intent: { pageRequirements: [] }
} as any;
const candidate = (id = "candidate_fixture", number = 7) => ({
  id, number, status: "candidate", workspaceRevisionId: "revision_fixture"
} as any);
const published = { id: "published_fixture", number: 6, status: "published", workspaceRevisionId: "revision_published" } as any;
const captureScreenshots = process.env.LODESTA_FIXTURE_CAPTURE !== "false";

let workspace = makeWorkspace();
let clientScript = "";
let artifactMode: "hidden" | "visible" = "hidden";
let publishMode: "failure" | "success" = "failure";
let sessionMode: "success" | "failure" = "success";
const publishRequests: Array<{ path: string; mode: string }> = [];

function makeWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    site: { ...initialSite },
    session: { id: "session_fixture" },
    input: initialInput,
    versions: [candidate()],
    versionRoutes: { candidate_fixture: [{ path: "/", title: "Fixture candidate" }] },
    messages: [],
    runs: [],
    candidateIntegrity: { status: "current", issues: [] },
    ...overrides
  };
}

const serverBuild = await build({
  stdin: { contents: `export {SiteAgentWorkspace} from ${JSON.stringify(component)}`, resolveDir: process.cwd(), loader: "tsx" },
  bundle: true, write: false, platform: "node", format: "cjs", jsx: "automatic",
  external: ["react", "react/jsx-runtime"], plugins: [navigation]
});
const serverModule = { exports: {} as { SiteAgentWorkspace: ComponentType<any> } };
new Function("require", "module", "exports", serverBuild.outputFiles[0].text)(createRequire(import.meta.url), serverModule, serverModule.exports);
const markup = renderToString(createElement(serverModule.exports.SiteAgentWorkspace, {
  initialSite, initialInput, initialVersions: [candidate()]
}));
const clientBuild = await build({
  stdin: { contents: `import {hydrateRoot} from "react-dom/client"; import {SiteAgentWorkspace} from ${JSON.stringify(component)}; hydrateRoot(document.getElementById("root"), <SiteAgentWorkspace initialSite={${JSON.stringify(initialSite)}} initialInput={${JSON.stringify(initialInput)}} initialVersions={${JSON.stringify([candidate()])}}/>);`, resolveDir: process.cwd(), loader: "tsx" },
  bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", plugins: [navigation]
});
clientScript = clientBuild.outputFiles[0].text;

const canarySource = await readFile("scripts/canary-owner-journey.ts", "utf8");
const helperMatch = canarySource.match(/async function waitForCandidatePreview[\s\S]*?\n}\n\nasync function cleanupCanaryState/);
assert(helperMatch, "The canary preview helper was not found for the browser fixture.");
const helperSource = helperMatch[0].replace(/\nasync function cleanupCanaryState$/, "");
const helperBuild = await build({
  stdin: { contents: `import assert from "node:assert/strict"; import type {Page} from "playwright"; ${helperSource}; export {waitForCandidatePreview};`, resolveDir: process.cwd(), loader: "ts" },
  bundle: true, write: false, platform: "node", format: "cjs", external: ["node:assert/strict"]
});
const helperModule = { exports: {} as { waitForCandidatePreview: (targetPage: Page, input: { versionId: string; routeTitle: string }) => Promise<{ h1Text: string }> } };
new Function("require", "module", "exports", helperBuild.outputFiles[0].text)(createRequire(import.meta.url), helperModule, helperModule.exports);
const waitForCandidatePreview = helperModule.exports.waitForCandidatePreview;

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/fixture.js") {
    response.writeHead(200, { "content-type": "application/javascript" });
    response.end(clientScript);
    return;
  }
  if (url.pathname === "/api/site-agent/sessions") {
    if (sessionMode === "failure") {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ message: "Fixture editor refresh unavailable." }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(workspace));
    return;
  }
  if (url.pathname === "/api/site-versions/candidate_fixture/artifact/") {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(artifactMode === "visible"
      ? "<!doctype html><title>Fixture candidate</title><main><h1>Fixture authored heading</h1></main>"
      : "<!doctype html><title>Fixture candidate</title><main style=\"visibility:hidden\"><h1>Hidden candidate heading</h1></main>");
    return;
  }
  if (url.pathname === "/api/site-versions/stale_fixture/artifact/") {
    response.writeHead(200, { "content-type": "text/html" });
    response.end("<!doctype html><title>Stale candidate</title><main><h1>Stale preview</h1></main>");
    return;
  }
  if (url.pathname === "/api/site-versions/candidate_fixture/publish" && request.method === "POST") {
    publishRequests.push({ path: url.pathname, mode: publishMode });
    if (publishMode === "failure") {
      response.writeHead(422, { "content-type": "application/json" });
      response.end(JSON.stringify({ message: "Fixture promotion denied." }));
      return;
    }
    workspace = makeWorkspace({
      site: { ...initialSite, publishedVersionId: "candidate_fixture" },
      versions: [{ ...candidate(), status: "published" }]
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, version: { ...candidate(), status: "published" } }));
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root">${markup}</div><script src="/fixture.js"></script></body></html>`);
});

await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
assert(address && typeof address !== "string");
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
try {
  const screenshots = resolve(".design/owner-publication/screenshots");
  await mkdir(screenshots, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  const desktopPublish = page.locator(".site-agent-publish-desktop");
  await desktopPublish.waitFor({ state: "visible" });
  assert(await desktopPublish.isEnabled(), "The fixture candidate should be publishable after hydration.");

  await verifyCandidatePreview(page, origin);

  await desktopPublish.click();
  await assertDialog(page, "This makes this reviewed draft public.");
  assert(await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).evaluate((button) => document.activeElement === button), "ConfirmDialog must focus Cancel first.");
  assert.equal(publishRequests.length, 0, "Opening desktop confirmation made a publish request.");
  await capture(page, resolve(screenshots, "publish-confirm-first-light-desktop.png"));
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await capture(page, resolve(screenshots, "publish-confirm-first-dark-desktop.png"));
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.activeElement?.classList.contains("site-agent-publish-desktop"));
  assert.equal(publishRequests.length, 0, "Escaping desktop confirmation made a publish request.");

  await page.setViewportSize({ width: 768, height: 1024 });
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  const mobilePublish = page.locator(".site-agent-publish-mobile");
  await mobilePublish.click();
  await assertDialog(page, "This makes this reviewed draft public.");
  assert.equal(publishRequests.length, 0, "Opening phone confirmation made a publish request.");
  await capture(page, resolve(screenshots, "publish-confirm-first-tablet.png"));
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await capture(page, resolve(screenshots, "publish-confirm-first-dark-tablet.png"));
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.classList.contains("site-agent-publish-mobile"));
  assert.equal(publishRequests.length, 0, "Cancelling phone confirmation made a publish request.");

  await page.setViewportSize({ width: 375, height: 812 });
  await mobilePublish.click();
  await assertDialog(page, "This makes this reviewed draft public.");
  await capture(page, resolve(screenshots, "publish-confirm-first-phone.png"));
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await capture(page, resolve(screenshots, "publish-confirm-first-dark-phone.png"));
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.activeElement?.classList.contains("site-agent-publish-mobile"));

  await page.setViewportSize({ width: 1280, height: 800 });
  await desktopPublish.click();
  await assertDialog(page, "This makes this reviewed draft public.");
  await page.getByRole("dialog").getByRole("button", { name: "Publish website", exact: true }).click();
  await page.getByRole("dialog").locator(".product-dialog-error").waitFor({ state: "visible" });
  assert.equal((await page.getByRole("dialog").innerText()).includes("Fixture promotion denied."), true);
  assert.equal(publishRequests.length, 1, "A failed confirmation did not make the exact publish request.");
  assert.deepEqual(publishRequests[0], { path: "/api/site-versions/candidate_fixture/publish", mode: "failure" });
  await capture(page, resolve(screenshots, "publish-confirm-failure-light-desktop.png"));
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();

  workspace = makeWorkspace({
    site: { ...initialSite, publishedVersionId: published.id },
    versions: [candidate(), published]
  });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".site-agent-publish-desktop").waitFor({ state: "visible" });
  await page.locator(".site-agent-publish-desktop").click();
  await assertDialog(page, "This replaces the current live website with this reviewed draft.");
  await capture(page, resolve(screenshots, "publish-confirm-replacement-light-desktop.png"));
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();

  workspace = makeWorkspace({ versions: [candidate(), { ...candidate("candidate_previous", 6), status: "stale" }] });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".site-agent-publish-desktop").click();
  await assertDialog(page, "This makes this reviewed draft public.");
  // Fault-inject a selected-version change through the real component handler.
  // A normal user cannot click through the modal's inert background. This tests
  // the captured-target guard, not an idle polling capability (none exists).
  await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>(".site-agent-more-trigger")?.click();
  });
  await page.waitForFunction(() => document.querySelectorAll(".site-agent-version-list button").length === 2);
  await page.evaluate(() => {
    [...document.querySelectorAll<HTMLButtonElement>(".site-agent-version-list button")]
      .find(button => button.textContent?.includes("Version 6"))?.click();
  });
  await page.getByRole("dialog").getByRole("button", { name: "Publish website", exact: true }).click();
  await page.getByRole("dialog").locator(".product-dialog-error").waitFor({ state: "visible" });
  assert.equal((await page.getByRole("dialog").innerText()).includes("A newer candidate is available."), true);
  assert.equal(publishRequests.length, 1, "Changing the selected candidate during confirmation made a publish request.");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();

  workspace = makeWorkspace({ runs: [{ id: "run_fixture", status: "running", kind: "edit", stage: "authoring", progress: { label: "Updating", detail: "Fixture update" } }] });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".site-agent-publish-desktop").waitFor({ state: "visible" });
  assert(await page.locator(".site-agent-publish-desktop").isDisabled(), "An active run must block desktop publication.");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  assert(await page.locator(".site-agent-publish-mobile").isDisabled(), "Active authoring must aria-disable phone publication.");
  // aria-disabled remains focusable so the owner can read why publication is
  // unavailable; a keyboard activation must expose the reason, never publish.
  await page.locator(".site-agent-publish-mobile").focus();
  await page.keyboard.press("Enter");
  await page.locator(".site-agent-mobile-notice").waitFor({ state: "visible" });
  assert.equal(await page.locator(".site-agent-mobile-notice").innerText(), "Finish the current website update before publishing.");
  assert.equal(publishRequests.length, 1, "An active run made a publish request.");

  workspace = makeWorkspace({ candidateIntegrity: { status: "stale_owner_authority", issues: [] } });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.locator(".site-agent-publish-desktop").waitFor({ state: "visible" });
  assert(await page.locator(".site-agent-publish-desktop").isDisabled(), "A stale candidate must block desktop publication.");

  workspace = makeWorkspace();
  publishMode = "success";
  sessionMode = "success";
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".site-agent-publish-desktop").waitFor({ state: "visible" });
  await page.locator(".site-agent-publish-desktop").click();
  await assertDialog(page, "This makes this reviewed draft public.");
  assert.equal(publishRequests.length, 1, "A request was made before final confirmation.");
  await page.getByRole("dialog").getByRole("button", { name: "Publish website", exact: true }).click();
  await page.waitForFunction(() => document.body.textContent?.includes("Published version is live."), undefined, { timeout: 5_000, polling: 50 });
  await page.waitForFunction(() => document.activeElement?.classList.contains("site-agent-more-trigger"));
  assert.equal(publishRequests.filter((request) => request.mode === "success").length, 1, "Desktop confirmation did not make exactly one promotion request.");

  workspace = makeWorkspace();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole("button", { name: "Preview", exact: true }).click();
  await page.locator(".site-agent-publish-mobile").click();
  await assertDialog(page, "This makes this reviewed draft public.");
  await page.getByRole("dialog").getByRole("button", { name: "Publish website", exact: true }).click();
  await page.waitForFunction(() => document.body.textContent?.includes("Published version is live."), undefined, { timeout: 5_000, polling: 50 });
  await page.locator(".site-agent-mobile-notice").getByText("Published version is live.", { exact: true }).waitFor();
  await page.waitForFunction(() => document.activeElement?.classList.contains("site-agent-mobile-more"));
  await capture(page, resolve(screenshots, "publish-success-phone.png"));
  assert.equal(publishRequests.filter((request) => request.mode === "success").length, 2, "Phone confirmation did not make exactly one promotion request.");

  workspace = makeWorkspace();
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload({ waitUntil: "domcontentloaded" });
  sessionMode = "failure";
  await page.locator(".site-agent-publish-desktop").click();
  await assertDialog(page, "This makes this reviewed draft public.");
  await page.getByRole("dialog").getByRole("button", { name: "Publish website", exact: true }).click();
  await page.locator(".site-agent-inline-notice").getByText("Published version is live. The editor could not refresh; reload to see the latest workspace.", { exact: true }).waitFor();
  await capture(page, resolve(screenshots, "publish-success-editor-refresh-failure-desktop.png"));
  assert.equal(await page.getByRole("dialog").count(), 0, "A successful promotion with a failed editor refresh kept the confirmation open.");
  assert.equal(await page.locator(".site-agent-publish-desktop").count(), 0, "A successful promotion with a failed editor refresh offered a repeat publish control.");
  assert.equal(publishRequests.filter((request) => request.mode === "success").length, 3, "Editor refresh failure made an additional promotion request.");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, desktop: "Escape focus + successful More focus + no preconfirm POST", phone: "Cancel/Escape focus + successful Preview-options focus + no preconfirm POST", failure: "dialog retained", staleSelection: "blocked in open confirmation", activeRun: "blocked", staleCandidate: "blocked", publish: "one exact confirmed POST", refreshFailure: "successful promotion remains closed and non-repeatable", preview: "actual canary helper rejects about:blank, stale URL, and hidden ancestor" }));
} finally {
  await browser.close();
  await new Promise<void>((done) => server.close(() => done()));
}

async function verifyCandidatePreview(page: Page, origin: string) {
  const expectedUrl = `${origin}/api/site-versions/candidate_fixture/artifact/`;
  const input = { versionId: "candidate_fixture", routeTitle: "Fixture candidate" };
  await setPreviewUrl(page, "about:blank");
  await assertPreviewRejected(page, input, "about:blank");
  await setPreviewUrl(page, `${origin}/api/site-versions/stale_fixture/artifact/`);
  await assertPreviewRejected(page, input, "stale candidate URL");
  artifactMode = "hidden";
  await setPreviewUrl(page, expectedUrl);
  await assertPreviewRejected(page, input, "hidden ancestor");
  artifactMode = "visible";
  await setPreviewUrl(page, expectedUrl);
  const evidence = await waitForCandidatePreview(page, input);
  assert.equal(evidence.h1Text, "Fixture authored heading");
}

async function setPreviewUrl(page: Page, url: string) {
  await page.evaluate((nextUrl) => {
    const frame = document.querySelector('iframe[title="Website preview"]');
    if (!(frame instanceof HTMLIFrameElement)) throw new Error("The fixture workspace has no preview iframe.");
    frame.src = nextUrl;
  }, url);
  await page.waitForFunction((expectedUrl) => {
    const frame = document.querySelector('iframe[title="Website preview"]');
    return frame instanceof HTMLIFrameElement && frame.src === expectedUrl && frame.contentWindow?.location.href === expectedUrl;
  }, url, { timeout: 5_000, polling: 50 });
}

async function assertPreviewRejected(page: Page, input: { versionId: string; routeTitle: string }, label: string) {
  const oneShotPage = {
    url: () => page.url(),
    waitForFunction: async (predicate: Parameters<Page["waitForFunction"]>[0], argument: unknown) => {
      const ready = await page.evaluate(predicate as never, argument);
      assert.equal(ready, false, `The actual canary helper incorrectly accepted ${label}.`);
      throw new Error(`fixture not ready: ${label}`);
    }
  } as unknown as Page;
  await assert.rejects(() => waitForCandidatePreview(oneShotPage, input), new RegExp(`fixture not ready: ${label}`));
}

async function assertDialog(page: Page, description: string) {
  const dialog = page.getByRole("dialog");
  assert.equal(await dialog.count(), 1);
  assert.equal(await dialog.getByRole("heading", { name: "Publish version 7?" }).count(), 1);
  assert.equal(await dialog.getByText(description, { exact: true }).count(), 1);
}

async function capture(page: Page, path: string) {
  if (captureScreenshots) await page.screenshot({ path, fullPage: true });
}
