import assert from "node:assert/strict";
import { chromium } from "playwright";
import { inspectNavigationReachability } from "../packages/site-verification/navigation-reachability";

const browser = await chromium.launch({ headless: true });
try {
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await desktop.setContent(`
    <style>
      header { display: flex; gap: 24px; }
      details[open]::after { content: ""; position: fixed; inset: 0; background: red; pointer-events: none; }
    </style>
    <header><a href="/">Home</a><details><summary>Services</summary><a href="/service">Service</a></details></header>
  `);
  const desktopResult = await inspectNavigationReachability(desktop);
  assert.deepEqual(desktopResult.unreachable, []);
  assert.equal(await desktop.locator("details").getAttribute("open"), null, "Desktop disclosure state leaked after inspection.");
  await desktop.close();

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.setContent(`
    <style>
      header { min-height: 72px; }
      [data-lodesta-navigation-panel] { position: fixed; inset: 72px 0 0; overflow: auto; background: white; }
      [data-lodesta-navigation-panel] nav { display: block; }
      .spacer { display: block; min-height: 130px; }
      a { display: block; min-height: 48px; }
    </style>
    <header>
      <div data-lodesta-navigation-disclosure="primary" data-lodesta-navigation-behavior="modal">
        <button type="button" aria-controls="primary" aria-expanded="false" aria-label="Open navigation" data-lodesta-menu-toggle data-lodesta-open-label="Open navigation" data-lodesta-close-label="Close navigation">Menu</button>
        <div id="primary" role="dialog" aria-modal="true" aria-label="Primary" hidden data-lodesta-menu data-lodesta-navigation-panel>
          <nav aria-label="Primary"><a href="/">Home</a><details><summary>Services</summary><div>${Array.from({ length: 8 }, (_, index) => `<span class="spacer">Service ${index + 1}</span>`).join("")}<a href="/service">Service detail</a></div></details></nav>
        </div>
      </div>
    </header>
  `);
  await mobile.addScriptTag({ path: "packages/trusted-runtime/site-runtime-v1.js" });
  const mobileResult = await inspectNavigationReachability(mobile);
  assert.deepEqual(mobileResult.unreachable, []);
  assert.equal(await mobile.locator("[data-lodesta-navigation-panel]").getAttribute("hidden"), "", "Managed mobile panel state leaked after inspection.");
  assert.equal(await mobile.locator("details").getAttribute("open"), null, "Nested mobile disclosure state leaked after inspection.");
  await mobile.close();
} finally {
  await browser.close();
}

console.log(JSON.stringify({ ok: true, disclosures: ["desktop", "nested-scrollable-mobile"], stateRestored: true }));
