import assert from "node:assert/strict";
import { chromium } from "playwright";
import { inspectNavigationReachability } from "../packages/site-verification/navigation-reachability";

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.setContent(`
    <style>
      body{margin:0} header{display:flex;justify-content:space-between;padding:12px;background:#173c33;color:#fff}
      button{min-width:44px;min-height:44px}.native-menu{inset:68px 8px auto 8px;width:auto;margin:0;padding:16px;border:0;background:#fff;color:#111}
      .native-menu a{display:flex;min-height:44px;align-items:center;color:#111}
    </style>
    <header><a href="#top" style="color:white">Example</a><button popovertarget="native-menu" aria-label="Menu">Menu</button></header>
    <div id="native-menu" class="native-menu" popover><nav><a href="#services">Services</a><a href="#contact">Contact</a></nav></div>
    <main id="top"><section id="services">Services</section><section id="contact">Contact</section></main>
  `);
  const nativePopover = await inspectNavigationReachability(page);
  assert.equal(nativePopover.toggleCount, 1);
  assert.deepEqual(nativePopover.brokenToggles, [], JSON.stringify(nativePopover));
  assert.equal(await page.locator("#native-menu").evaluate((element) => element.matches(":popover-open")), false, "Popover state leaked after inspection.");

  await page.setContent(`
    <header>
      <a href="#top">Logo</a>
      <button aria-label="Open navigation" aria-expanded="false">Menu</button>
    </header>
    <main id="top"><h1>Homepage</h1></main>
  `);
  const broken = await inspectNavigationReachability(page);
  assert.equal(broken.toggleCount, 1);
  assert.equal(broken.brokenToggles.length, 1);

  await page.setContent(`
    <header>
      <a href="#top">Logo</a>
      <button aria-label="Open navigation" aria-expanded="false" aria-controls="menu">Menu</button>
      <nav id="menu" hidden><a href="#services">Services</a></nav>
    </header>
    <main id="top"><h1>Homepage</h1><section id="services">Services</section></main>
    <script>
      const button = document.querySelector("button");
      const menu = document.querySelector("nav");
      button.addEventListener("click", () => {
        const open = button.getAttribute("aria-expanded") !== "true";
        button.setAttribute("aria-expanded", String(open));
        menu.hidden = !open;
      });
    </script>
  `);
  const working = await inspectNavigationReachability(page);
  assert.equal(working.toggleCount, 1);
  assert.deepEqual(working.brokenToggles, []);

  await page.setContent(`
    <style>
      .desktop-nav{display:flex}.mobile-nav{display:none}
      @media(max-width:640px){.desktop-nav{display:none}.mobile-nav{display:block}}
    </style>
    <header>
      <nav class="desktop-nav"><a href="#services">Services</a></nav>
      <div class="mobile-nav">
        <button aria-label="Open navigation" aria-expanded="false" aria-controls="mobile-panel">Menu</button>
        <div id="mobile-panel" hidden>
          <nav>
            <a href="#services">Services</a>
            <details><summary>Service categories</summary><a href="#ants">Ant control</a></details>
          </nav>
        </div>
      </div>
    </header>
    <main><section id="services">Services</section><section id="ants">Ants</section></main>
  `);
  await page.evaluate(() => {
    const button = document.querySelector("button")!;
    const panel = document.querySelector<HTMLElement>("#mobile-panel")!;
    button.addEventListener("click", () => {
      const open = button.getAttribute("aria-expanded") !== "true";
      button.setAttribute("aria-expanded", String(open));
      panel.hidden = !open;
    });
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  const desktopScoped = await inspectNavigationReachability(page);
  assert.equal(desktopScoped.destinationCount, 1, "A CSS-hidden phone menu leaked contextual destinations into desktop reachability.");
  await page.setViewportSize({ width: 390, height: 844 });
  const nestedMobile = await inspectNavigationReachability(page);
  assert.equal(nestedMobile.destinationCount, 2);
  assert.deepEqual(nestedMobile.unreachable, [], "A nested mobile disclosure could not reveal its contextual destination.");

  await page.setContent(`
    <style>body{margin:0}</style>
    <header style="height:72px;background:#173c33">
      <button aria-label="Open navigation" aria-expanded="false" aria-controls="menu">Menu</button>
      <div id="menu" role="dialog" hidden style="position:fixed;inset:72px 0 0;background:#fff">
        <nav><a href="#services" style="display:block;color:#fff;font-size:18px;padding:16px">Services</a></nav>
      </div>
    </header>
    <main><section id="services">Services</section></main>
  `);
  await page.evaluate(() => {
      const button = document.querySelector("button")!;
      const panel = document.querySelector<HTMLElement>("#menu")!;
      button.addEventListener("click", () => {
        const open = button.getAttribute("aria-expanded") !== "true";
        button.setAttribute("aria-expanded", String(open));
        panel.hidden = !open;
      });
  });
  const invisibleLinks = await inspectNavigationReachability(page);
  assert.equal(invisibleLinks.brokenToggles.length, 1);
  assert.match(invisibleLinks.brokenToggles[0] ?? "", /lack legible solid-color contrast/);

  await page.setContent(`
    <style>body{margin:0}</style>
    <header style="height:72px;background:#173c33">
      <button aria-label="Open navigation" aria-expanded="false" aria-controls="menu">Menu</button>
      <div id="menu" role="dialog" hidden style="position:fixed;inset:72px 0 0;background:#173c33">
        <nav><a href="#services" style="display:block;color:#fff;font-size:18px;padding:16px">Services</a></nav>
      </div>
    </header>
    <main><section id="services">Services</section></main>
  `);
  await page.evaluate(() => {
      const button = document.querySelector("button")!;
      const panel = document.querySelector<HTMLElement>("#menu")!;
      button.addEventListener("click", () => {
        const open = button.getAttribute("aria-expanded") !== "true";
        button.setAttribute("aria-expanded", String(open));
        panel.hidden = !open;
      });
  });
  const contrastedLinks = await inspectNavigationReachability(page);
  assert.deepEqual(contrastedLinks.brokenToggles, []);

  await page.setContent(`
    <style>body{margin:0}.brand{display:inline-block}.panel{position:fixed;inset:72px 0 0;background:#173c33}.panel nav{display:grid;gap:8px;padding:20px}.panel a{display:block;color:#fff;padding:12px}</style>
    <header style="height:72px;background:#173c33;color:#fff">
      <a class="brand" data-lodesta-business-name href="#top">Example Pest</a>
      <button aria-label="Open navigation" aria-expanded="false" aria-controls="shift-menu">Menu</button>
      <div id="shift-menu" class="panel" role="dialog" hidden><nav><a href="#services">Services</a></nav></div>
    </header>
    <main id="top"><section id="services">Services</section></main>
  `);
  await page.evaluate(() => {
    const button = document.querySelector("button")!;
    const panel = document.querySelector<HTMLElement>("#shift-menu")!;
    const brand = document.querySelector<HTMLElement>(".brand")!;
    button.addEventListener("click", () => {
      const open = button.getAttribute("aria-expanded") !== "true";
      button.setAttribute("aria-expanded", String(open));
      panel.hidden = !open;
      brand.style.transform = open ? "translateX(8px)" : "";
    });
  });
  const shiftedBrand = await inspectNavigationReachability(page);
  assert.deepEqual(shiftedBrand.brokenToggles, [], JSON.stringify(shiftedBrand));
  assert.equal(shiftedBrand.designWarnings.length, 1);
  assert.match(shiftedBrand.designWarnings[0] ?? "", /shifts, resizes, or clips the header brand/);

  await page.setContent(`
    <style>
      html,body{margin:0}
      header{display:flex;align-items:center;width:100%;height:72px}
      .brand{width:140px}
      .disclosure{margin-left:auto}
      .inline-panel{width:343px;background:#fff}
      .inline-panel a{display:block;padding:12px;color:#111}
    </style>
    <header>
      <a class="brand" data-lodesta-business-name href="#top">Example Pest</a>
      <div class="disclosure">
        <button aria-label="Open navigation" aria-expanded="false" aria-controls="wide-inline-menu">Menu</button>
        <div id="wide-inline-menu" class="inline-panel" hidden><nav><a href="#services">Services</a><a href="#contact">Contact</a></nav></div>
      </div>
    </header>
    <main id="top"><section id="services">Services</section><section id="contact">Contact</section></main>
  `);
  await page.evaluate(() => {
    const button = document.querySelector("button")!;
    const panel = document.querySelector<HTMLElement>("#wide-inline-menu")!;
    button.addEventListener("click", () => {
      const open = button.getAttribute("aria-expanded") !== "true";
      button.setAttribute("aria-expanded", String(open));
      panel.hidden = !open;
    });
  });
  const overflowingInlinePanel = await inspectNavigationReachability(page);
  assert.equal(overflowingInlinePanel.brokenToggles.length, 1, JSON.stringify(overflowingInlinePanel));
  assert.match(overflowingInlinePanel.brokenToggles[0] ?? "", /document overflow|outside the phone viewport/);

  await page.setContent(`
    <style>
      html,body{margin:0}
      header{display:flex;align-items:center;width:100%;height:72px}
      .disclosure{position:relative;margin-left:auto}
      .inline-panel{position:absolute;top:48px;right:0;width:343px;padding:14px;background:#fff}
      .inline-panel a{display:block;padding:12px;color:#111}
      .action{display:flex;justify-content:center;background:#ffc21a}
      main{padding-top:150px}
      main .action{width:343px;margin-left:auto}
    </style>
    <header>
      <a class="brand" data-lodesta-business-name href="#top">Example Pest</a>
      <div class="disclosure">
        <button aria-label="Open navigation" aria-expanded="false" aria-controls="inline-duplicate-menu">Menu</button>
        <div id="inline-duplicate-menu" class="inline-panel" hidden><nav><a href="#services">Services</a><a class="action" href="#contact">Get an estimate</a></nav></div>
      </div>
    </header>
    <main id="top"><a class="action" href="#contact">Get an estimate</a><section id="services">Services</section><section id="contact">Contact</section></main>
  `);
  await page.evaluate(() => {
    const button = document.querySelector("button")!;
    const panel = document.querySelector<HTMLElement>("#inline-duplicate-menu")!;
    button.addEventListener("click", () => {
      const open = button.getAttribute("aria-expanded") !== "true";
      button.setAttribute("aria-expanded", String(open));
      panel.hidden = !open;
    });
  });
  const adjacentDuplicateInlineAction = await inspectNavigationReachability(page);
  assert.deepEqual(adjacentDuplicateInlineAction.brokenToggles, [], JSON.stringify(adjacentDuplicateInlineAction));
  assert.equal(adjacentDuplicateInlineAction.designWarnings.length, 1, JSON.stringify(adjacentDuplicateInlineAction));
  assert.match(adjacentDuplicateInlineAction.designWarnings[0] ?? "", /repeats an identical page action across its lower boundary/);

  await page.setContent(`
    <style>
      body{margin:0}
      .panel{position:fixed;inset:72px 0 0}
      .panel nav{display:grid;gap:8px;padding:20px}
      .panel a{display:flex;align-items:center;min-height:44px;padding:8px;color:#111;font-weight:600}
      :where([data-lodesta-navigation-behavior="modal"] > [data-lodesta-navigation-panel]){background:var(--site-color-background, Canvas);color:var(--site-color-text, CanvasText)}
    </style>
    <header data-lodesta-navigation-behavior="modal" style="height:72px;background:#173c33">
      <button aria-label="Open navigation" aria-expanded="false" aria-controls="menu">Menu</button>
      <div id="menu" class="panel" data-lodesta-navigation-panel role="dialog" hidden>
        <nav><a href="#services">Services</a><a href="#contact">Contact</a></nav>
      </div>
    </header>
    <main><section id="services">Services</section><section id="contact">Contact</section></main>
  `);
  await page.evaluate(() => {
    const button = document.querySelector("button")!;
    const panel = document.querySelector<HTMLElement>("#menu")!;
    button.addEventListener("click", () => {
      const open = button.getAttribute("aria-expanded") !== "true";
      button.setAttribute("aria-expanded", String(open));
      panel.hidden = !open;
    });
  });
  const fallbackPanel = await inspectNavigationReachability(page);
  assert.equal(fallbackPanel.brokenToggles.length, 0, JSON.stringify(fallbackPanel));
  assert.equal(fallbackPanel.designWarnings.length, 1);
  assert.match(fallbackPanel.designWarnings[0] ?? "", /platform Canvas fallback/);
  await page.addStyleTag({ content: ".panel{background:#173c33;color:#fff}.panel a{color:#fff}" });
  const authoredPanel = await inspectNavigationReachability(page);
  assert.deepEqual(authoredPanel.brokenToggles, []);
  assert.equal(authoredPanel.designWarnings.length, 1);
  assert.match(authoredPanel.designWarnings[0] ?? "", /browser-default control styling/);

  await page.setContent(`
    <style>body{margin:0}.styled-toggle{appearance:none;border:0;border-radius:999px;background:#ffbf19;color:#032b4d;width:48px;height:48px}</style>
    <header style="height:72px;background:#173c33">
      <button class="styled-toggle" aria-label="Open navigation" aria-expanded="false" aria-controls="menu">×</button>
      <div id="menu" role="dialog" hidden style="position:fixed;inset:72px 0 0;background:#fff">
        <nav><a href="#services">Services</a><a href="#contact">Contact</a></nav>
      </div>
    </header>
    <main><section id="services">Services</section><section id="contact">Contact</section></main>
  `);
  await page.evaluate(() => {
    const button = document.querySelector("button")!;
    const panel = document.querySelector<HTMLElement>("#menu")!;
    button.addEventListener("click", () => {
      const open = button.getAttribute("aria-expanded") !== "true";
      button.setAttribute("aria-expanded", String(open));
      panel.hidden = !open;
    });
  });
  const styledTriggerRawPanel = await inspectNavigationReachability(page);
  assert.equal(styledTriggerRawPanel.brokenToggles.length, 0);
  assert.equal(styledTriggerRawPanel.designWarnings.length, 1);
  assert.match(styledTriggerRawPanel.designWarnings[0] ?? "", /trigger is styled.*link stack has no deliberate panel spacing/);

  await page.setContent(`
    <style>
      body{margin:0}.icon{display:flex;width:24px;height:24px;flex-direction:column;justify-content:center;gap:4px}
      .icon>span{display:block;width:100%;height:2px;background:currentColor}
    </style>
    <header style="height:72px;background:#173c33;color:#fff">
      <button data-lodesta-menu-toggle aria-label="Open navigation" aria-expanded="false" aria-controls="menu"><span class="icon" data-lodesta-navigation-icon><span></span><span></span><span></span></span></button>
      <div id="menu" role="dialog" hidden style="position:fixed;inset:72px 0 0;background:#173c33">
        <nav><a href="#services" style="display:block;color:#fff;font-size:18px;padding:16px">Services</a></nav>
      </div>
    </header>
    <main><section id="services">Services</section></main>
  `);
  await page.evaluate(() => {
    const button = document.querySelector("button")!;
    const panel = document.querySelector<HTMLElement>("#menu")!;
    button.addEventListener("click", () => {
      const open = button.getAttribute("aria-expanded") !== "true";
      button.setAttribute("aria-expanded", String(open));
      panel.hidden = !open;
    });
  });
  assert.deepEqual((await inspectNavigationReachability(page)).brokenToggles, []);

  const competingIconStyle = await page.addStyleTag({ content: "[data-lodesta-menu-toggle]::before{content:'×';display:block;font-size:24px}" });
  const competingIcon = await inspectNavigationReachability(page);
  assert.equal(competingIcon.brokenToggles.length, 1);
  assert.match(competingIcon.brokenToggles[0] ?? "", /default navigation icon is obscured by a competing generated icon/);
  await competingIconStyle.evaluate((element) => element.parentNode?.removeChild(element));

  const competingBackgroundIconStyle = await page.addStyleTag({ content: "[data-lodesta-menu-toggle]{background-image:linear-gradient(45deg,transparent 46%,currentColor 47%,currentColor 53%,transparent 54%),linear-gradient(-45deg,transparent 46%,currentColor 47%,currentColor 53%,transparent 54%)}" });
  const competingBackgroundIcon = await inspectNavigationReachability(page);
  assert.equal(competingBackgroundIcon.brokenToggles.length, 1);
  assert.match(competingBackgroundIcon.brokenToggles[0] ?? "", /default navigation icon is obscured by a competing generated icon/);
  await competingBackgroundIconStyle.evaluate((element) => element.parentNode?.removeChild(element));

  await page.addStyleTag({ content: ".icon{display:block;height:2px;background:currentColor}" });
  const collapsedIcon = await inspectNavigationReachability(page);
  assert.equal(collapsedIcon.brokenToggles.length, 1);
  assert.match(collapsedIcon.brokenToggles[0] ?? "", /managed navigation icon collapsed/);
} finally {
  await browser.close();
}

console.log("Mobile navigation-toggle verification passed.");
