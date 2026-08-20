import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { chromium } from "playwright";
import { platformCapabilityStyles, platformCapabilityStylesFor } from "../workers/site-sandbox/scaffold/platform/capability-styles";
import { buildSiteRuntimeBytes } from "../packages/trusted-runtime";

const runtimeV1 = await readFile("packages/trusted-runtime/site-runtime-v1.js");
const runtime = await buildSiteRuntimeBytes("site-runtime-v2");
const runtimeV4 = await buildSiteRuntimeBytes("site-runtime-v4");
const v4CapabilityStyles = platformCapabilityStylesFor("site-runtime-v4");
new Function(runtimeV1.toString("utf8"));
new Function(runtime.toString("utf8"));
new Function(runtimeV4.toString("utf8"));
assert.match(v4CapabilityStyles, /navigation-panel\]\[hidden\].*display:\s*none\s*!important/s);
assert.match(v4CapabilityStyles, /navigation-behavior="modal".*position:\s*fixed/s);
assert.match(v4CapabilityStyles, /inset:\s*var\(--lodesta-navigation-top, 0px\) 0 0/);
assert.match(v4CapabilityStyles, /height:\s*calc\(100dvh - var\(--lodesta-navigation-top, 0px\)\)/);
assert.match(v4CapabilityStyles, /background:\s*var\(--site-color-background, Canvas\)/);
assert(!v4CapabilityStyles.includes("navigation-icon"), "V4 retained platform trigger artwork.");
assert(!/navigation-panel[^}]*\b(?:display:\s*(?:flex|grid)|align-items|min-height)/s.test(v4CapabilityStyles), "V4 imposed inner navigation-link layout.");
assert(!v4CapabilityStyles.includes("transition:"), "V4 retained platform trigger motion.");
assert(!/\b(?:inset|height|width|position)[^;]*!important/.test(v4CapabilityStyles), "V4 modal containment is not author-overridable.");
assert(
  platformCapabilityStyles.includes('[data-lodesta-navigation-panel]:not([hidden])')
    && platformCapabilityStyles.includes('inset: var(--lodesta-navigation-top, 0px) 0 0;')
    && platformCapabilityStyles.includes('height: calc(100dvh - var(--lodesta-navigation-top, 0px));')
    && !/\b(?:inset|height|width|position)[^;]*!important/.test(platformCapabilityStyles),
  "Navigation geometry is not author-overridable."
);
assert(
  !platformCapabilityStyles.includes("data-lodesta-map")
    && !runtime.includes(Buffer.from("data-lodesta-gallery-direction")),
  "Kernel-B retained removed map presentation or gallery behavior."
);
const analytics: Array<Record<string, unknown>> = [];
const forms: Array<Record<string, unknown>> = [];
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/_lodesta/runtime/site-runtime-v1.js") return send(response, 200, runtimeV1, "application/javascript; charset=utf-8");
  if (url.pathname === "/_lodesta/runtime/site-runtime-v2.js") return send(response, 200, runtime, "application/javascript; charset=utf-8");
  if (url.pathname === "/_lodesta/runtime/site-runtime-v4.js") return send(response, 200, runtimeV4, "application/javascript; charset=utf-8");
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
      "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'"
    });
  }
  if (url.pathname === "/v4") {
    return send(response, 200, Buffer.from(v4DocumentHtml()), "text/html; charset=utf-8", {
      "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'"
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
  const noScriptContext = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const noScriptPage = await noScriptContext.newPage();
  await noScriptPage.goto(origin, { waitUntil: "domcontentloaded" });
  assert(await noScriptPage.locator("#primary-navigation").isHidden(), "managed navigation covered the homepage before the trusted runtime loaded");
  assert(await noScriptPage.locator("main").isVisible(), "homepage content was not visible without JavaScript");
  await noScriptContext.close();

  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(origin, { waitUntil: "networkidle" });
  assert.equal(errors.length, 0, errors.join("\n"));
  assert(analytics.some((event) => event.eventType === "page_view" && event.siteId === "site_runtime_test"), "public page view was not recorded");
  const pageView = analytics.find((event) => event.eventType === "page_view");
  assert.equal(typeof pageView?.eventId, "string");
  assert.equal(typeof pageView?.visitorId, "string");
  assert.equal(typeof pageView?.visitId, "string");
  assert.equal(pageView?.versionId, "version_runtime_test");
  await page.fill('input[name="name"]', "Test visitor");
  await page.click('form button[type="submit"]');
  await page.waitForFunction(() => document.querySelector("[data-lodesta-form-status]")?.textContent === "Sent.");
  assert.equal(forms.length, 1, "lead form did not submit exactly once");
  assert.equal(forms[0].siteId, "site_runtime_test");
  assert.equal(forms[0].formId, "form_runtime_test");
  assert.equal(typeof forms[0].eventId, "string");
  assert.equal(analytics.filter((event) => event.eventType === "form_submit").length, 0, "browser emitted a duplicate form submission event");
  await page.click("[data-lodesta-directions]");
  await page.waitForTimeout(50);
  assert(analytics.some((event) => event.eventType === "directions_click"), "managed directions telemetry was not recorded");
  const modalToggle = page.locator('[data-lodesta-navigation-disclosure="primary-navigation"] [data-lodesta-menu-toggle]');
  const modalPanel = page.locator("#primary-navigation");
  const inlineToggle = page.locator('[data-lodesta-navigation-disclosure="inline-navigation"] [data-lodesta-menu-toggle]');
  assert.equal(await modalToggle.getAttribute("aria-expanded"), "false");
  assert.equal(await modalToggle.getAttribute("aria-label"), "Open navigation");
  assert(await modalPanel.isHidden(), "modal navigation did not initialize closed");
  await modalToggle.click();
  assert.equal(await modalToggle.getAttribute("aria-expanded"), "true");
  assert.equal(await modalToggle.getAttribute("aria-label"), "Close navigation");
  assert(await modalPanel.isVisible(), "modal navigation did not reveal its panel");
  assert(await modalPanel.getAttribute("data-lodesta-open") !== null, "modal navigation did not expose its open styling hook");
  await page.waitForTimeout(220);
  const openModalState = await page.evaluate(() => {
    const header = document.querySelector("header");
    const panel = document.querySelector<HTMLElement>("#primary-navigation");
    return {
      headerBottom: header?.getBoundingClientRect().bottom,
      navigationTop: panel?.style.getPropertyValue("--lodesta-navigation-top"),
      rootOverflow: document.documentElement.style.overflow,
      bodyOverflow: document.body.style.overflow,
      mainInert: document.querySelector("main")?.hasAttribute("inert"),
      activeLabel: document.activeElement?.getAttribute("aria-label"),
      panelBounds: panel ? { left: panel.getBoundingClientRect().left, top: panel.getBoundingClientRect().top, width: panel.getBoundingClientRect().width } : null,
      viewportWidth: innerWidth,
      toggleHeight: document.querySelector("[data-lodesta-navigation-icon]")?.parentElement?.getBoundingClientRect().height,
      linkHeights: [...document.querySelectorAll("#primary-navigation a")].map((link) => link.getBoundingClientRect().height),
      firstIconTransform: getComputedStyle(document.querySelector("[data-lodesta-navigation-icon] > span:first-child")!).transform,
      middleIconOpacity: getComputedStyle(document.querySelector("[data-lodesta-navigation-icon] > span:nth-child(2)")!).opacity
    };
  });
  assert.equal(openModalState.navigationTop, `${Math.round(Number(openModalState.headerBottom) * 100) / 100}px`, "modal navigation was not positioned below the persistent header");
  assert(Math.abs(Number(openModalState.panelBounds?.top) - Number(openModalState.headerBottom)) <= 1, "the default modal panel did not begin directly below the persistent header");
  assert.equal(openModalState.panelBounds?.left, 0, "the default modal panel did not reach the left viewport edge");
  assert.equal(openModalState.panelBounds?.width, openModalState.viewportWidth, "the default modal panel was not full viewport width");
  assert(Number(openModalState.toggleHeight) >= 44, "the default hamburger target is smaller than 44px");
  assert(openModalState.linkHeights.every((height) => height >= 44), "the default navigation links are smaller than 44px");
  assert.notEqual(openModalState.firstIconTransform, "none", "the default hamburger did not transform toward an X while open");
  assert.equal(openModalState.middleIconOpacity, "0", "the middle hamburger line remained visible while open");
  assert.equal(openModalState.rootOverflow, "hidden");
  assert.equal(openModalState.bodyOverflow, "hidden");
  assert.equal(openModalState.mainInert, true, "modal navigation did not suppress background interaction");
  assert.equal(openModalState.activeLabel, "Close navigation", "modal navigation did not place focus inside the active disclosure");
  await page.locator("#primary-navigation a").last().focus();
  await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Close navigation", "modal navigation did not contain keyboard focus");
  await page.keyboard.press("Escape");
  assert.equal(await modalToggle.getAttribute("aria-expanded"), "false");
  assert.equal(await modalToggle.getAttribute("aria-label"), "Open navigation");
  assert(await modalPanel.isHidden(), "Escape did not close modal navigation");
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Open navigation", "closing navigation did not restore trigger focus");
  assert.deepEqual(await page.evaluate(() => ({
    rootOverflow: document.documentElement.style.overflow,
    bodyOverflow: document.body.style.overflow,
    mainInert: document.querySelector("main")?.hasAttribute("inert")
  })), { rootOverflow: "", bodyOverflow: "", mainInert: false }, "closing modal navigation did not restore document interaction");

  await inlineToggle.click();
  assert.equal(await inlineToggle.getAttribute("aria-expanded"), "true");
  assert.deepEqual(await page.evaluate(() => ({
    rootOverflow: document.documentElement.style.overflow,
    mainInert: document.querySelector("main")?.hasAttribute("inert")
  })), { rootOverflow: "", mainInert: false }, "inline navigation incorrectly applied modal document behavior");
  await modalToggle.click();
  assert.equal(await inlineToggle.getAttribute("aria-expanded"), "false", "opening another navigation did not close the existing disclosure");
  assert.equal(await modalToggle.getAttribute("aria-expanded"), "true");
  await page.locator("#primary-navigation a").first().click();
  assert.equal(await modalToggle.getAttribute("aria-expanded"), "false", "an internal destination did not close modal navigation");

  await modalToggle.click();
  await page.evaluate(() => {
    const wrapper = document.querySelector<HTMLElement>('[data-lodesta-navigation-disclosure="primary-navigation"]');
    if (wrapper) wrapper.style.display = "none";
    dispatchEvent(new Event("resize"));
  });
  await page.waitForFunction(() => document.documentElement.style.overflow === "");
  assert.deepEqual(await page.evaluate(() => ({
    expanded: document.querySelector('[data-lodesta-navigation-disclosure="primary-navigation"] [data-lodesta-menu-toggle]')?.getAttribute("aria-expanded"),
    rootOverflow: document.documentElement.style.overflow,
    bodyOverflow: document.body.style.overflow,
    mainInert: document.querySelector("main")?.hasAttribute("inert")
  })), { expanded: "false", rootOverflow: "", bodyOverflow: "", mainInert: false }, "a breakpoint-hidden modal retained lock or inert state");
  await page.evaluate(() => {
    const wrapper = document.querySelector<HTMLElement>('[data-lodesta-navigation-disclosure="primary-navigation"]');
    if (wrapper) wrapper.style.display = "";
  });

  await inlineToggle.click();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Escape");
  assert.equal(await inlineToggle.getAttribute("aria-expanded"), "false", "Escape did not close inline navigation");
  assert.equal(await page.evaluate(() => document.activeElement?.textContent), "Menu", "inline navigation did not restore focus to its custom trigger");
  await page.evaluate(() => {
    const style = document.createElement("style");
    style.id = "authored-navigation-geometry";
    document.head.appendChild(style);
  });
  await page.evaluate(() => {
    document.querySelector<HTMLStyleElement>("#authored-navigation-geometry")!.textContent = "#inline-navigation{position:absolute;width:240px}";
  });
  await inlineToggle.click();
  assert.deepEqual(await page.locator("#inline-navigation").evaluate((element) => ({
    position: getComputedStyle(element).position,
    width: Math.round(element.getBoundingClientRect().width)
  })), { position: "absolute", width: 240 }, "inline navigation did not accept authored dropdown geometry");
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    document.querySelector<HTMLStyleElement>("#authored-navigation-geometry")!.textContent = "#primary-navigation{inset:var(--lodesta-navigation-top,0px) 0 0 auto;width:320px}";
  });
  await modalToggle.click();
  const drawerBounds = await modalPanel.evaluate((element) => ({
    left: Math.round(element.getBoundingClientRect().left),
    right: Math.round(element.getBoundingClientRect().right),
    width: Math.round(element.getBoundingClientRect().width)
  }));
  assert.deepEqual(drawerBounds, { left: 70, right: 390, width: 320 }, "modal navigation did not accept authored drawer geometry");
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    document.querySelector<HTMLStyleElement>("#authored-navigation-geometry")!.textContent = "#primary-navigation{inset:auto 0 0;height:40dvh;max-height:40dvh}";
  });
  await modalToggle.click();
  const sheetBounds = await modalPanel.evaluate((element) => ({
    bottom: Math.round(element.getBoundingClientRect().bottom),
    height: Math.round(element.getBoundingClientRect().height)
  }));
  assert.equal(sheetBounds.bottom, 844, "modal navigation did not accept an authored bottom-sheet position");
  assert(Math.abs(sheetBounds.height - 338) <= 1, "modal navigation did not accept an authored sheet height");
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.querySelector("#authored-navigation-geometry")?.remove());
  await page.emulateMedia({ reducedMotion: "reduce" });
  await modalToggle.click();
  assert.equal(await page.locator("[data-lodesta-navigation-icon] > span").first().evaluate((element) => getComputedStyle(element).transitionDuration), "0s", "the default navigation motion ignored prefers-reduced-motion");
  await page.keyboard.press("Escape");
  const legacyToggle = page.locator("#legacy-navigation-toggle");
  await legacyToggle.click();
  assert.equal(await legacyToggle.getAttribute("aria-expanded"), "true", "the trusted runtime no longer supports retained raw menu-toggle markup");
  assert(await page.locator("#legacy-navigation").getAttribute("data-lodesta-open") !== null, "retained raw menu markup did not receive its open styling hook");
  await page.keyboard.press("Escape");
  assert.equal(await legacyToggle.getAttribute("aria-expanded"), "false", "retained raw menu markup did not close with Escape");

  const previewRequestsBefore = analytics.length + forms.length;
  const preview = await browser.newPage();
  await preview.goto(`${origin}/preview/token`, { waitUntil: "networkidle" });
  await preview.fill('input[name="name"]', "Preview visitor");
  await preview.click('form button[type="submit"]');
  await preview.getByText("Preview successful. This form is valid and no lead was created.").waitFor();
  assert.equal(analytics.length + forms.length, previewRequestsBefore, "token preview emitted analytics or form traffic");

  const artifactPreview = await browser.newPage();
  await artifactPreview.goto(`${origin}/api/site-versions/version/artifact/`, { waitUntil: "networkidle" });
  await artifactPreview.fill('input[name="name"]', "Artifact preview visitor");
  await artifactPreview.click('form button[type="submit"]');
  await artifactPreview.getByText("Preview successful. This form is valid and no lead was created.").waitFor();
  assert.equal(analytics.length + forms.length, previewRequestsBefore, "authenticated artifact preview emitted analytics or form traffic");

  const analyticsOff = await browser.newPage();
  await analyticsOff.goto(`${origin}/analytics-off`, { waitUntil: "networkidle" });
  assert.equal(analytics.length + forms.length, previewRequestsBefore, "analytics-disabled page emitted tracking traffic");

  const internalBefore = analytics.length + forms.length;
  const internalContext = await browser.newContext({ userAgent: "LodestaWebsiteCrawler/1.0" });
  const internalPage = await internalContext.newPage();
  await internalPage.goto(origin, { waitUntil: "networkidle" });
  assert.equal(analytics.length + forms.length, internalBefore, "Lodesta internal agent emitted analytics or form traffic");
  await internalContext.close();
  assert.equal(errors.length, 0, errors.join("\n"));

  const v4NoScriptContext = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const v4NoScriptPage = await v4NoScriptContext.newPage();
  await v4NoScriptPage.goto(`${origin}/v4`, { waitUntil: "domcontentloaded" });
  assert(await v4NoScriptPage.locator("#v4-navigation").isHidden(), "V4 navigation covered the page without trusted JavaScript.");
  assert(await v4NoScriptPage.locator("main").isVisible(), "V4 main content was unavailable without JavaScript.");
  await v4NoScriptContext.close();

  const v4 = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await v4.goto(`${origin}/v4`, { waitUntil: "networkidle" });
  const v4Toggle = v4.locator('[aria-controls="v4-navigation"]');
  const v4Panel = v4.locator("#v4-navigation");
  assert.equal(await v4.locator("[data-lodesta-navigation-icon]").count(), 0, "V4 injected the legacy platform icon.");
  assert.deepEqual(await v4Toggle.evaluate((element) => ({
    width: Math.round(element.getBoundingClientRect().width),
    height: Math.round(element.getBoundingClientRect().height),
    authoredBars: element.querySelectorAll(".v4-menu-bar").length
  })), { width: 48, height: 48, authoredBars: 3 }, "V4 did not preserve authored trigger artwork and target size.");
  await v4Toggle.click();
  assert.equal(await v4Toggle.getAttribute("aria-expanded"), "true");
  assert(await v4Panel.isVisible(), "V4 did not open the authored panel.");
  assert.deepEqual(await v4Panel.evaluate((element) => {
    const computed = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    return {
      position: computed.position,
      top: Math.round(bounds.top),
      bottom: Math.round(bounds.bottom),
      width: Math.round(bounds.width),
      overflowY: computed.overflowY,
      overscrollBehavior: computed.overscrollBehavior,
      backgroundColor: computed.backgroundColor,
      linkDisplay: getComputedStyle(element.querySelector("a")!).display
    };
  }), {
    position: "fixed",
    top: 72,
    bottom: 844,
    width: 390,
    overflowY: "auto",
    overscrollBehavior: "contain",
    backgroundColor: "rgb(255, 255, 255)",
    linkDisplay: "grid"
  }, "V4 did not provide contained modal geometry while preserving authored link layout.");
  assert.deepEqual(await v4.evaluate(() => ({
    bodyOverflow: document.body.style.overflow,
    rootOverflow: document.documentElement.style.overflow,
    mainInert: document.querySelector("main")?.hasAttribute("inert"),
    focusedLabel: document.activeElement?.getAttribute("aria-label")
  })), { bodyOverflow: "hidden", rootOverflow: "hidden", mainInert: true, focusedLabel: "Close navigation" }, "V4 did not retain trusted modal state and focus behavior.");
  await v4.keyboard.press("Escape");
  assert.equal(await v4Toggle.getAttribute("aria-expanded"), "false");
  assert.equal(await v4.evaluate(() => document.activeElement?.getAttribute("aria-label")), "Open navigation", "V4 did not restore trigger focus.");
  const floorToggle = v4.locator('#v4-floor-toggle');
  assert.deepEqual(await floorToggle.evaluate((element) => ({
    width: Math.round(element.getBoundingClientRect().width),
    height: Math.round(element.getBoundingClientRect().height)
  })), { width: 44, height: 44 }, "V4 did not provide the functional trigger floor.");
  await floorToggle.click();
  assert.deepEqual(await v4.locator("#v4-inline").evaluate((element) => ({
    position: getComputedStyle(element).position,
    top: getComputedStyle(element).top
  })), { position: "static", top: "auto" }, "V4 imposed modal containment on an inline disclosure.");
  await floorToggle.click();
  const drawerToggle = v4.locator('[aria-controls="v4-drawer"]');
  await drawerToggle.click();
  assert.equal(await v4.locator("#v4-drawer").evaluate((element) => Math.round(element.getBoundingClientRect().width)), 312, "Authored V4 drawer geometry did not override the containment default.");
  await v4.keyboard.press("Escape");
  await v4.fill('input[name="name"]', "V4 visitor");
  const formCountBeforeV4 = forms.length;
  await v4.click('form button[type="submit"]');
  await v4.waitForFunction(() => document.querySelector("[data-lodesta-form-status]")?.textContent === "Sent.");
  assert.equal(forms.length, formCountBeforeV4 + 1, "V4 managed form did not submit exactly once.");

  console.log(JSON.stringify({ ok: true, pageviews: analytics.filter((event) => event.eventType === "page_view").length, formSubmissions: forms.length, internalExclusion: "pass", previewIsolation: "pass", interactions: "pass", v4PresentationBoundary: "pass" }));
} finally {
  await browser.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

function documentHtml(analyticsEnabled: boolean) {
  return `<!doctype html><html data-lodesta-site-id="site_runtime_test" data-lodesta-version-id="version_runtime_test" data-lodesta-analytics="${analyticsEnabled}"><head><meta charset="utf-8"><style>${platformCapabilityStyles}</style><script src="/_lodesta/runtime/site-runtime-v2.js" defer></script></head><body><header><div data-lodesta-navigation-disclosure="primary-navigation" data-lodesta-navigation-behavior="modal"><button type="button" data-lodesta-menu-toggle aria-controls="primary-navigation" aria-expanded="false" aria-label="Open navigation" data-lodesta-open-label="Open navigation" data-lodesta-close-label="Close navigation"><span data-lodesta-navigation-icon aria-hidden="true"><span></span><span></span><span></span></span></button><div id="primary-navigation" data-lodesta-menu data-lodesta-navigation-panel role="dialog" aria-modal="true" aria-label="Primary" tabindex="-1" hidden><nav aria-label="Primary"><a href="#section">Section</a><a href="#contact">Contact</a></nav></div></div><div data-lodesta-navigation-disclosure="inline-navigation" data-lodesta-navigation-behavior="inline"><button type="button" data-lodesta-menu-toggle aria-controls="inline-navigation" aria-expanded="false" aria-label="Open navigation" data-lodesta-open-label="Open navigation" data-lodesta-close-label="Close navigation">Menu</button><div id="inline-navigation" data-lodesta-menu data-lodesta-navigation-panel tabindex="-1" hidden><nav aria-label="Secondary"><a href="#section">Section</a></nav></div></div><button id="legacy-navigation-toggle" type="button" data-lodesta-menu-toggle aria-controls="legacy-navigation" aria-expanded="false">Legacy menu</button><nav id="legacy-navigation"><a href="#section">Legacy destination</a></nav></header><main><section id="section"><a href="#directions" data-lodesta-directions>Directions</a><form id="contact" data-lodesta-form-id="form_runtime_test" data-lodesta-success-message="Sent."><label>Name<input name="name" required></label><button type="submit">Send</button><p data-lodesta-form-status></p></form></section></main></body></html>`;
}

function v4DocumentHtml() {
  return `<!doctype html><html data-lodesta-site-id="site_runtime_v4_test" data-lodesta-version-id="version_runtime_v4_test" data-lodesta-analytics="false"><head><meta charset="utf-8"><style>${v4CapabilityStyles}
  :root{--site-color-primary:#173c33;--site-color-background:#fff;--site-color-text:#15201d}
  body{margin:0;color:var(--site-color-text)}.v4-header{height:72px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;background:var(--site-color-primary)}
  .v4-toggle{width:48px;height:48px;border:0;background:transparent;display:grid;place-content:center;gap:5px}.v4-menu-bar{display:block;width:24px;height:2px;background:#fff;transition:transform .2s,opacity .2s}
  .v4-toggle[aria-expanded=true] .v4-menu-bar:first-child{transform:translateY(7px) rotate(45deg)}.v4-toggle[aria-expanded=true] .v4-menu-bar:nth-child(2){opacity:0}.v4-toggle[aria-expanded=true] .v4-menu-bar:last-child{transform:translateY(-7px) rotate(-45deg)}
  .v4-panel{padding:32px}.v4-panel nav{display:grid;gap:12px}.v4-panel a{display:grid;grid-template-columns:1fr auto;min-height:48px;color:var(--site-color-text)}
  .v4-floor-toggle{box-sizing:border-box;width:1px;height:1px;padding:0}.v4-drawer-panel{width:320px;max-width:80vw;inset-inline-start:auto}
  label{display:grid;gap:6px}input,button[type=submit]{min-height:48px;font-size:16px}</style><script src="/_lodesta/runtime/site-runtime-v4.js" defer></script></head><body>
  <header class="v4-header"><a href="#top" style="color:white">Example</a><div data-lodesta-navigation-disclosure="v4-navigation" data-lodesta-navigation-behavior="modal"><button class="v4-toggle" type="button" data-lodesta-menu-toggle aria-controls="v4-navigation" aria-expanded="false" aria-label="Open navigation" data-lodesta-open-label="Open navigation" data-lodesta-close-label="Close navigation"><span class="v4-menu-bar"></span><span class="v4-menu-bar"></span><span class="v4-menu-bar"></span></button><div id="v4-navigation" class="v4-panel" data-lodesta-menu data-lodesta-navigation-panel role="dialog" aria-modal="true" aria-label="Primary" tabindex="-1" hidden><nav aria-label="Primary"><a href="#services"><span>Services</span><small>What we do</small></a><a href="#contact"><span>Contact</span><small>Start here</small></a></nav></div></div><div data-lodesta-navigation-disclosure="v4-inline" data-lodesta-navigation-behavior="inline"><button id="v4-floor-toggle" class="v4-floor-toggle" type="button" data-lodesta-menu-toggle aria-controls="v4-inline" aria-expanded="false" aria-label="Open secondary navigation" data-lodesta-open-label="Open secondary navigation" data-lodesta-close-label="Close secondary navigation">I</button><div id="v4-inline" data-lodesta-menu data-lodesta-navigation-panel tabindex="-1" hidden><nav aria-label="Secondary"><a href="#services">Inline</a></nav></div></div><div data-lodesta-navigation-disclosure="v4-drawer-disclosure" data-lodesta-navigation-behavior="modal"><button type="button" data-lodesta-menu-toggle aria-controls="v4-drawer" aria-expanded="false" aria-label="Open drawer" data-lodesta-open-label="Open drawer" data-lodesta-close-label="Close drawer">D</button><div id="v4-drawer" class="v4-drawer-panel" data-lodesta-menu data-lodesta-navigation-panel role="dialog" aria-modal="true" aria-label="Drawer" tabindex="-1" hidden><nav aria-label="Drawer"><a href="#contact">Drawer contact</a></nav></div></div></header>
  <main id="top"><section id="services"><h1>Services</h1></section><form id="contact" data-lodesta-form-id="form_runtime_test" data-lodesta-form-revision="1" data-lodesta-form-destination="lead_inbox" data-lodesta-success-message="Sent."><label for="v4-name">Name</label><input id="v4-name" name="name" required><button type="submit">Send</button><p data-lodesta-form-status role="status"></p></form></main></body></html>`;
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
