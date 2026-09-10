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
const succeededHistoryRun = {
  id: "run_succeeded_history", status: "succeeded", kind: "edit", stage: "candidate_ready",
  startedAt: "2026-09-09T10:00:00.000Z", completedAt: "2026-09-09T10:02:00.000Z",
  progress: { label: "Private draft ready", detail: "The website passed its required checks and is ready for your review." }
} as any;
const failedHistoryRun = {
  id: "run_failed_history", status: "failed", kind: "edit", stage: "failed",
  startedAt: "2026-09-09T10:00:00.000Z", completedAt: "2026-09-09T10:02:00.000Z",
  progress: { label: "Website needs attention", detail: "The work stopped before it finished." }
} as any;
const runningEditRun = {
  id: "run_stop_fixture", status: "running", kind: "edit", stage: "authoring",
  startedAt: "2026-09-09T10:03:00.000Z",
  progress: { label: "Updating", detail: "Fixture update" }
} as any;
const queuedEditRun = {
  id: "run_queued_fixture", status: "queued", kind: "edit", stage: "queued",
  startedAt: "2026-09-09T10:04:00.000Z",
  progress: { label: "Preparing your website", detail: "Fixture queued update" }
} as any;
const needsInputHistoryRun = {
  id: "run_needs_input_history", status: "needs_input", kind: "edit", stage: "needs_input",
  startedAt: "2026-09-09T10:05:00.000Z",
  progress: { label: "Your answer is needed", detail: "Fixture question" }
} as any;
const cancelledHistoryRun = {
  id: "run_cancelled_history", status: "cancelled", kind: "edit", stage: "authoring",
  startedAt: "2026-09-09T10:03:00.000Z", completedAt: "2026-09-09T10:04:00.000Z",
  progress: { label: "Website update stopped", detail: "The active work was stopped. Your published website was not changed." }
} as any;
const captureScreenshots = process.env.LODESTA_FIXTURE_CAPTURE !== "false";

let workspace: any = makeWorkspace();
let clientScript = "";
let artifactMode: "hidden" | "visible" | "delayed-stylesheet" = "hidden";
let publishMode: "failure" | "success" = "failure";
let sessionMode: "success" | "failure" = "success";
const publishRequests: Array<{ path: string; mode: string }> = [];
let stopMode: "failure" | "cancelled" | "already_finished" | "unconfirmed" | "mismatched" = "failure";
const stopRequests: Array<{ path: string; sessionId: string; runId: string; mode: string }> = [];
const stopDialogActionDiagnostics: Array<{
  theme: "light" | "dark";
  viewport: string;
  label: string;
  disabled: boolean;
  opacity: string;
  color: string;
  backgroundColor: string;
}> = [];

type StylesheetGate = {
  started: Promise<void>;
  markStarted(): void;
  released: Promise<void>;
  release(): void;
};

function stylesheetGate(): StylesheetGate {
  let markStarted: () => void = () => undefined;
  let release: () => void = () => undefined;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const released = new Promise<void>((resolve) => { release = resolve; });
  return { started, markStarted, released, release };
}

let delayedStylesheet: StylesheetGate | undefined;

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

function historySnapshot(run: { id: string; startedAt: string; completedAt?: string; [key: string]: unknown }) {
  return {
    run,
    completed: [
      { key: `${run.id}-failed`, kind: "review", status: "failed", label: "Finalizing the draft.", startedAt: run.startedAt, completedAt: "2026-09-09T10:01:00.000Z" },
      { key: `${run.id}-succeeded`, kind: "review", status: "succeeded", label: "Checking the website.", startedAt: "2026-09-09T10:01:00.000Z", completedAt: run.completedAt }
    ],
    hasEarlierActivity: false
  };
}

function cancelledHistorySnapshot(run: typeof cancelledHistoryRun) {
  return { run, completed: [], hasEarlierActivity: false };
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
  if (url.pathname === `/api/site-agent/runs/${succeededHistoryRun.id}/activity`) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(historySnapshot(succeededHistoryRun)));
    return;
  }
  if (url.pathname === `/api/site-agent/runs/${failedHistoryRun.id}/activity`) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(historySnapshot(failedHistoryRun)));
    return;
  }
  if (url.pathname === `/api/site-agent/runs/${cancelledHistoryRun.id}/activity`) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(cancelledHistorySnapshot(cancelledHistoryRun)));
    return;
  }
  if (url.pathname === `/api/site-agent/runs/${needsInputHistoryRun.id}/activity`) {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(cancelledHistorySnapshot(needsInputHistoryRun)));
    return;
  }
  if (url.pathname === "/api/site-agent/runs" && request.method === "DELETE") {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { sessionId?: string; runId?: string };
    stopRequests.push({ path: url.pathname, sessionId: body.sessionId ?? "", runId: body.runId ?? "", mode: stopMode });
    if (stopMode === "failure") {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ message: "Lodesta could not stop this update. Try again or cancel." }));
      return;
    }
    const run = stopMode === "cancelled"
      ? { ...runningEditRun, status: "cancelled", completedAt: "2026-09-09T10:04:00.000Z", progress: cancelledHistoryRun.progress }
      : stopMode === "unconfirmed"
        ? { ...runningEditRun }
        : stopMode === "mismatched"
          ? { ...runningEditRun, id: "run_other_fixture", status: "cancelled", completedAt: "2026-09-09T10:04:00.000Z", progress: cancelledHistoryRun.progress }
          : { ...runningEditRun, status: "succeeded", stage: "candidate_ready", completedAt: "2026-09-09T10:04:00.000Z", progress: succeededHistoryRun.progress };
    if (["cancelled", "succeeded", "failed"].includes(run.status)) {
      workspace = {
        ...workspace,
        runs: workspace.runs.map((currentRun: any) => currentRun.id === body.runId ? run : currentRun)
      };
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ run }));
    return;
  }
  if (url.pathname === "/api/site-versions/candidate_fixture/artifact/") {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(artifactMode === "visible"
      ? "<!doctype html><title>Fixture candidate</title><main><h1>Fixture authored heading</h1></main>"
      : artifactMode === "delayed-stylesheet"
        ? "<!doctype html><title>Fixture candidate</title><link rel=\"stylesheet\" href=\"/fixture-delayed.css\"><main><h1>Fixture authored heading</h1></main>"
      : "<!doctype html><title>Fixture candidate</title><main style=\"visibility:hidden\"><h1>Hidden candidate heading</h1></main>");
    return;
  }
  if (url.pathname === "/fixture-delayed.css") {
    if (delayedStylesheet) {
      delayedStylesheet.markStarted();
      await delayedStylesheet.released;
    }
    response.writeHead(200, { "content-type": "text/css" });
    response.end("main { color: rgb(20, 35, 31); }");
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

  const stopFeedbackScreenshots = resolve(".design/owner-run-feedback/screenshots");
  await mkdir(stopFeedbackScreenshots, { recursive: true });
  workspace = makeWorkspace({ runs: [runningEditRun] });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload({ waitUntil: "domcontentloaded" });
  const stopUpdate = page.getByRole("button", { name: "Stop update", exact: true });
  await stopUpdate.waitFor({ state: "visible" });
  await stopUpdate.click();
  await assertStopDialog(page);
  assert(await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).evaluate((button) => document.activeElement === button), "Stop confirmation must focus Cancel first.");
  await page.getByRole("dialog").getByRole("button", { name: "Stop", exact: true }).click();
  const stopError = page.getByRole("dialog").getByRole("alert");
  await stopError.waitFor({ state: "visible" });
  assert.equal(await stopError.innerText(), "Lodesta could not stop this update. Try again or cancel.");
  assert.deepEqual(stopRequests, [{ path: "/api/site-agent/runs", sessionId: "session_fixture", runId: "run_stop_fixture", mode: "failure" }]);
  assert.equal(await page.getByRole("dialog").count(), 1, "A failed Stop request closed its confirmation.");
  await page.getByRole("dialog").getByRole("button", { name: "Stop", exact: true }).click();
  await stopError.waitFor({ state: "visible" });
  assert.equal(stopRequests.length, 2, "A Stop failure did not allow a deliberate retry.");
  for (const viewport of [
    { label: "desktop-1280", width: 1280, height: 800 },
    { label: "tablet-768", width: 768, height: 1024 },
    { label: "phone-375", width: 375, height: 812 }
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await settleStopDialogTheme(page, "light");
    await assertEnabledStopDialogActions(page, "light", viewport.label);
    await capture(page, resolve(stopFeedbackScreenshots, `stop-failure-light-${viewport.label}.png`));
    await assertDangerHoverContrast(page, "light", viewport.label);
    await settleStopDialogTheme(page, "dark");
    await assertEnabledStopDialogActions(page, "dark", viewport.label);
    await capture(page, resolve(stopFeedbackScreenshots, `stop-failure-dark-${viewport.label}.png`));
    await assertDangerHoverContrast(page, "dark", viewport.label);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `Stop failure dialog overflows ${viewport.label}.`);
  }
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.activeElement?.textContent === "Stop update");
  assert.equal(stopRequests.length, 2, "Closing a failed Stop confirmation retried the request.");

  stopMode = "cancelled";
  workspace = makeWorkspace({ runs: [runningEditRun] });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await stopUpdate.click();
  await assertStopDialog(page);
  sessionMode = "failure";
  await page.getByRole("dialog").getByRole("button", { name: "Stop", exact: true }).click();
  await page.locator(".site-agent-inline-notice").getByText("The website update was stopped. The editor could not refresh; reload to see the latest workspace. Your published website was not changed.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("dialog").count(), 0, "A confirmed Stop remained open after only its refresh failed.");
  assert.equal(await page.getByRole("button", { name: "Stop update", exact: true }).count(), 0, "A confirmed Stop offered a duplicate stop action after refresh failure.");
  assert.equal(stopRequests.length, 3, "A confirmed Stop did not make exactly one request.");
  sessionMode = "success";

  stopMode = "already_finished";
  workspace = makeWorkspace({ runs: [runningEditRun] });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Stop update", exact: true }).click();
  await assertStopDialog(page);
  await page.getByRole("dialog").getByRole("button", { name: "Stop", exact: true }).click();
  await page.locator(".site-agent-inline-notice").getByText("This website update had already finished. Reload to see the latest workspace.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("dialog").count(), 0, "A terminal-race Stop response kept the confirmation open.");
  assert.equal(await page.locator(".site-agent-inline-notice").getByText(/was stopped/).count(), 0, "A terminal-race Stop response falsely reported a stop.");
  assert.equal(stopRequests.length, 4, "A terminal-race Stop response made more than one request.");
  assert.equal(await page.getByRole("button", { name: "Stop update", exact: true }).count(), 0, "A successful workspace refresh resurrected a terminal Stop target.");

  stopMode = "unconfirmed";
  workspace = makeWorkspace({ runs: [runningEditRun] });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Stop update", exact: true }).click();
  await assertStopDialog(page);
  await page.getByRole("dialog").getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByRole("dialog").getByRole("alert").getByText("Stopping the website update could not be confirmed.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("dialog").count(), 1, "A nonterminal cancellation response closed the confirmation.");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();

  stopMode = "mismatched";
  workspace = makeWorkspace({ runs: [runningEditRun] });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Stop update", exact: true }).click();
  await assertStopDialog(page);
  await page.getByRole("dialog").getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByRole("dialog").getByRole("alert").getByText("Stopping the website update could not be confirmed.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("dialog").count(), 1, "A mismatched cancellation response closed the confirmation.");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();

  stopMode = "failure";
  workspace = makeWorkspace({ runs: [queuedEditRun, runningEditRun] });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("Build in progress", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Stop update", exact: true }).click();
  await assertStopDialog(page);
  await page.getByRole("dialog").getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByRole("dialog").getByRole("alert").waitFor({ state: "visible" });
  assert.equal(stopRequests.at(-1)?.runId, "run_stop_fixture", "A newer queued run displaced the active running update as the Stop target.");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();

  workspace = makeWorkspace({ runs: [cancelledHistoryRun] });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload({ waitUntil: "domcontentloaded" });
  const cancelledCard = page.locator(".site-agent-activity-card.is-cancelled");
  await cancelledCard.waitFor({ state: "visible" });
  assert.equal(await cancelledCard.locator(".site-agent-activity-header .site-agent-activity-dot.is-cancelled").count(), 1, "Expanded cancelled activity is incorrectly marked successful.");
  const cancelledGuidance = cancelledCard.getByText("The active work was stopped. Your published website was not changed.", { exact: true });
  await cancelledGuidance.waitFor({ state: "visible" });
  assert.equal(await cancelledGuidance.count(), 1, "Cancelled activity does not explain the safe outcome.");
  for (const viewport of [
    { label: "desktop-1280", width: 1280, height: 800 },
    { label: "tablet-768", width: 768, height: 1024 },
    { label: "phone-375", width: 375, height: 812 }
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
    await capture(page, resolve(stopFeedbackScreenshots, `cancelled-update-light-${viewport.label}.png`));
    await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
    await capture(page, resolve(stopFeedbackScreenshots, `cancelled-update-dark-${viewport.label}.png`));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `Cancelled activity overflows ${viewport.label}.`);
  }
  workspace = makeWorkspace({ runs: [succeededHistoryRun, cancelledHistoryRun] });
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  await page.reload({ waitUntil: "domcontentloaded" });
  const collapsedCancelledCard = page.locator(".site-agent-activity-card.is-cancelled");
  await collapsedCancelledCard.waitFor({ state: "visible" });
  assert.equal(await collapsedCancelledCard.locator(".site-agent-activity-summary .site-agent-activity-dot.is-cancelled").count(), 1, "Collapsed cancelled activity is incorrectly marked successful.");

  workspace = makeWorkspace({ runs: [needsInputHistoryRun] });
  await page.reload({ waitUntil: "domcontentloaded" });
  const needsInputCard = page.locator(".site-agent-activity-card.is-needs_input");
  await needsInputCard.waitFor({ state: "visible" });
  assert.equal(await needsInputCard.locator(".site-agent-activity-header .site-agent-activity-dot.is-needs_input").count(), 1, "Needs-input activity is incorrectly marked successful.");
  assert.equal(await needsInputCard.locator(".site-agent-activity-dot.is-succeeded").count(), 0, "Needs-input activity retains a success dot.");
  for (const viewport of [
    { label: "desktop-1280", width: 1280, height: 800 },
    { label: "tablet-768", width: 768, height: 1024 },
    { label: "phone-375", width: 375, height: 812 }
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
    await capture(page, resolve(stopFeedbackScreenshots, `needs-input-light-${viewport.label}.png`));
    await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
    await capture(page, resolve(stopFeedbackScreenshots, `needs-input-dark-${viewport.label}.png`));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `Needs-input activity overflows ${viewport.label}.`);
  }

  workspace = makeWorkspace();
  publishMode = "success";
  sessionMode = "success";
  await page.setViewportSize({ width: 1280, height: 800 });
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

  sessionMode = "success";
  workspace = makeWorkspace({ runs: [succeededHistoryRun] });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText("Private draft ready", { exact: true }).waitFor();
  const succeededFailedRow = page.locator(".site-agent-activity-list li.is-failed").filter({ hasText: "Finalizing the draft." });
  await succeededFailedRow.waitFor({ state: "visible" });
  assert.equal(await succeededFailedRow.getByText("Earlier attempt", { exact: true }).count(), 1, "A recovered failed step in a succeeded run needs an explicit Earlier attempt label.");
  assert.equal(await page.locator(".site-agent-activity-list li.is-succeeded").filter({ hasText: "Checking the website." }).count(), 1, "The later completed step disappeared from a succeeded run.");
  await capture(page, resolve(screenshots, "succeeded-run-earlier-attempt-desktop.png"));
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await succeededFailedRow.getByText("Earlier attempt", { exact: true }).isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, "Earlier-attempt history must not overflow the phone viewport.");
  await capture(page, resolve(screenshots, "succeeded-run-earlier-attempt-phone.png"));

  workspace = makeWorkspace({ runs: [failedHistoryRun] });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.reload({ waitUntil: "domcontentloaded" });
  const failedRunRow = page.locator(".site-agent-activity-list li.is-failed").filter({ hasText: "Finalizing the draft." });
  await failedRunRow.waitFor({ state: "visible" });
  assert.equal(await failedRunRow.getByText("Earlier attempt", { exact: true }).count(), 0, "A currently failed run must not be labelled as an earlier attempt.");
  await capture(page, resolve(screenshots, "failed-run-no-earlier-attempt-desktop.png"));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, desktop: "Escape focus + successful More focus + no preconfirm POST", phone: "Cancel/Escape focus + successful Preview-options focus + no preconfirm POST", failure: "dialog retained", stopFailure: "failed Stop stays in dialog, can retry or close safely", stopDialogActionDiagnostics, cancelledActivity: "expanded and collapsed rows use neutral cancelled state", staleSelection: "blocked in open confirmation", activeRun: "blocked", staleCandidate: "blocked", publish: "one exact confirmed POST", refreshFailure: "successful promotion remains closed and non-repeatable", activityHistory: "succeeded-run failed step marked earlier; failed enclosing run unmarked", preview: "actual canary helper rejects about:blank, stale URL, hidden ancestor, and stylesheet-loading interactive document before accepting complete" }));
} finally {
  delayedStylesheet?.release();
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

  delayedStylesheet = stylesheetGate();
  artifactMode = "delayed-stylesheet";
  await setPreviewUrl(page, expectedUrl);
  let stylesheetStartTimeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      delayedStylesheet.started,
      new Promise<never>((_, reject) => {
        stylesheetStartTimeout = setTimeout(() => reject(new Error("The fixture stylesheet request never started.")), 5_000);
      })
    ]);
  } finally {
    clearTimeout(stylesheetStartTimeout);
  }
  await page.waitForFunction(oldPreviewPredicateAccepts, inputToExpected(page, input), {
    timeout: 5_000,
    polling: 25
  });
  assert.equal(await page.evaluate(() => {
    const frame = document.querySelector('iframe[title="Website preview"]');
    return frame instanceof HTMLIFrameElement ? frame.contentDocument?.readyState : undefined;
  }), "interactive",
    "The stylesheet gate must hold the preview before document completion.");
  assert.equal(await oldPreviewPredicateAccepted(page, input), true,
    "The prior canary predicate must demonstrate the false-ready condition.");
  await assertPreviewRejected(page, input, "stylesheet still loading");
  const pendingPreview = waitForCandidatePreview(page, input);
  let previewSettled = false;
  void pendingPreview.then(
    () => { previewSettled = true; },
    () => { previewSettled = true; }
  );
  await page.evaluate(() => Promise.resolve());
  assert.equal(previewSettled, false, "The canonical helper accepted before the stylesheet completed.");
  delayedStylesheet.release();
  const stylesheetEvidence = await pendingPreview;
  assert.equal(stylesheetEvidence.h1Text, "Fixture authored heading");
  assert.equal(await page.evaluate(() => {
    const frame = document.querySelector('iframe[title="Website preview"]');
    return frame instanceof HTMLIFrameElement ? frame.contentDocument?.readyState : undefined;
  }), "complete");
  delayedStylesheet = undefined;
  artifactMode = "visible";
}

function inputToExpected(page: Page, input: { versionId: string; routeTitle: string }) {
  return { expectedUrl: `${new URL(page.url()).origin}/api/site-versions/${encodeURIComponent(input.versionId)}/artifact/`, routeTitle: input.routeTitle };
}

function oldPreviewPredicateAccepts({ expectedUrl, routeTitle }: { expectedUrl: string; routeTitle: string }) {
  const frame = document.querySelector('iframe[title="Website preview"]');
  if (!(frame instanceof HTMLIFrameElement) || frame.src !== expectedUrl) return false;
  const previewDocument = frame.contentDocument;
  const previewWindow = frame.contentWindow;
  if (!previewDocument || !previewWindow || previewWindow.location.href !== expectedUrl || previewDocument.title !== routeTitle) return false;
  const heading = previewDocument.querySelector("main h1");
  if (!heading || !heading.textContent?.trim() || !heading.getClientRects().length) return false;
  for (let element: Element | null = heading; element; element = element.parentElement) {
    const style = previewWindow.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse" || Number.parseFloat(style.opacity) === 0) return false;
  }
  return true;
}

async function oldPreviewPredicateAccepted(page: Page, input: { versionId: string; routeTitle: string }) {
  return page.evaluate(oldPreviewPredicateAccepts, inputToExpected(page, input));
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

async function assertStopDialog(page: Page) {
  const dialog = page.getByRole("dialog");
  assert.equal(await dialog.count(), 1);
  assert.equal(await dialog.getByRole("heading", { name: "Stop this website update?" }).count(), 1);
  assert.equal(await dialog.getByText("Your published website will not be changed.", { exact: true }).count(), 1);
}

async function assertEnabledStopDialogActions(page: Page, theme: "light" | "dark", viewport: string) {
  const actions = await page.getByRole("dialog").evaluate((dialog) => {
    const currentTheme = document.documentElement.dataset.theme;
    return [...dialog.querySelectorAll("button")]
      .filter((button) => button.textContent === "Cancel" || button.textContent === "Stop")
      .map((button) => {
        const style = getComputedStyle(button);
        return {
          label: button.textContent,
          disabled: button.disabled,
          opacity: style.opacity,
          color: style.color,
          backgroundColor: style.backgroundColor,
          currentTheme
        };
      });
  });
  assert.deepEqual(actions.map((action) => action.label), ["Cancel", "Stop"], `Stop dialog actions changed at ${theme} ${viewport}.`);
  for (const action of actions) {
    assert.equal(action.currentTheme, theme, `Stop dialog did not settle in the ${theme} theme at ${viewport}.`);
    assert.equal(action.disabled, false, `${action.label} remained disabled after a failed Stop at ${theme} ${viewport}.`);
    assert.equal(action.opacity, "1", `${action.label} retained disabled opacity after a failed Stop at ${theme} ${viewport}.`);
    assert.notEqual(action.color, action.backgroundColor, `${action.label} text matched its background after a failed Stop at ${theme} ${viewport}.`);
    assert(actionContrast(action.color, action.backgroundColor) >= 4.5, `${action.label} contrast is below 4.5:1 after a failed Stop at ${theme} ${viewport}.`);
    stopDialogActionDiagnostics.push({ theme, viewport, ...action });
  }
}

async function assertDangerHoverContrast(page: Page, theme: "light" | "dark", viewport: string) {
  const stop = page.getByRole("dialog").getByRole("button", { name: "Stop", exact: true });
  await stop.hover();
  await page.waitForFunction(`(() => {
    const stop = [...document.querySelectorAll('.product-dialog-actions .button')].find((button) => button.textContent === 'Stop');
    if (!stop) return false;
    const probe = document.createElement('span');
    probe.style.backgroundColor = 'var(--product-color-error-text)';
    document.documentElement.appendChild(probe);
    const expected = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return getComputedStyle(stop).backgroundColor === expected;
  })()`);
  const colors = await stop.evaluate((button) => {
    const style = getComputedStyle(button);
    return { color: style.color, backgroundColor: style.backgroundColor };
  });
  assert(actionContrast(colors.color, colors.backgroundColor) >= 4.5, `Hovered Stop contrast is below 4.5:1 at ${theme} ${viewport}.`);
  await page.mouse.move(0, 0);
  await settleStopDialogTheme(page, theme);
}

function actionContrast(foreground: string, background: string) {
  const parse = (value: string) => {
    const match = value.match(/^rgb\((\d+), (\d+), (\d+)\)$/);
    assert(match, `Expected an opaque rgb color, received ${value}.`);
    return match.slice(1).map((part) => Number(part) / 255).map((channel) => channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4);
  };
  const luminance = (channels: number[]) => channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  const [first, second] = [luminance(parse(foreground)), luminance(parse(background))];
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

async function settleStopDialogTheme(page: Page, theme: "light" | "dark") {
  await page.evaluate((value) => { document.documentElement.dataset.theme = value; }, theme);
  await page.waitForFunction(() => {
    let cancel: HTMLButtonElement | undefined;
    let stop: HTMLButtonElement | undefined;
    for (const button of document.querySelectorAll<HTMLButtonElement>(".product-dialog-actions .button")) {
      if (button.textContent === "Cancel") cancel = button;
      if (button.textContent === "Stop") stop = button;
    }
    if (!cancel || !stop) return false;
    const cancelStyle = getComputedStyle(cancel);
    const stopStyle = getComputedStyle(stop);
    const probe = document.createElement("span");
    probe.style.color = "var(--product-color-text)";
    probe.style.backgroundColor = "var(--product-color-surface)";
    document.documentElement.appendChild(probe);
    const cancelColor = getComputedStyle(probe).color;
    const cancelBackground = getComputedStyle(probe).backgroundColor;
    probe.style.color = "var(--product-color-danger-action-text)";
    probe.style.backgroundColor = "var(--product-color-error)";
    const stopColor = getComputedStyle(probe).color;
    const stopBackground = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return cancelStyle.color === cancelColor
      && cancelStyle.backgroundColor === cancelBackground
      && stopStyle.color === stopColor
      && stopStyle.backgroundColor === stopBackground;
  }, undefined, { timeout: 1_000, polling: 25 });
}

async function capture(page: Page, path: string) {
  if (captureScreenshots) await page.screenshot({ path, fullPage: true, animations: "disabled" });
}
