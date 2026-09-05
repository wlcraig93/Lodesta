import type { Locator, Page } from "playwright";

const probeActionTimeoutMs = 750;

const primaryLinkSelector = [
  "header a[href]",
  "header nav a[href]",
  "header [role=navigation] a[href]",
  "header details a[href]",
  "header [data-lodesta-menu] a[href]",
  "header [aria-label*=primary i] a[href]",
  "header [aria-label*=main i] a[href]",
  "nav[aria-label*=primary i] a[href]",
  "nav[aria-label*=main i] a[href]"
].join(",");

export type NavigationReachabilityResult = {
  destinationCount: number;
  unreachable: string[];
  toggleCount: number;
  brokenToggles: string[];
  designWarnings: string[];
};

type NavigationSurfaceResult = {
  readable: boolean;
  detail?: string;
  designWarning?: string;
};

type HeaderBrandGeometry = {
  left: number;
  top: number;
  width: number;
  height: number;
  visibleRatio: number;
};

export async function inspectNavigationReachability(
  page: Page,
  options: { canonicalLogoRevisionIds?: readonly string[] } = {}
): Promise<NavigationReachabilityResult> {
  await page.evaluate((revisionIds) => {
    Object.assign(globalThis, { __lodestaNavigationLogoRevisionIds: revisionIds });
  }, [...(options.canonicalLogoRevisionIds ?? [])]);
  const destinations = await page.locator(primaryLinkSelector).evaluateAll((links) => {
    const hrefs = links
      .filter((element) => {
        const href = element.getAttribute("href") ?? "";
        const label = (element.getAttribute("aria-label") ?? element.textContent ?? "")
          .replace(/\s+/g, " ")
          .trim();
        const isSkipLink = href.startsWith("#")
          && (element.hasAttribute("data-lodesta-skip-link")
            || /^(?:skip (?:to )?(?:main )?content|skip navigation)$/i.test(label));
        if (isSkipLink) return false;
        const elementStyle = getComputedStyle(element);
        const elementBounds = element.getBoundingClientRect();
        if (elementStyle.display !== "none"
          && elementStyle.visibility !== "hidden"
          && Number(elementStyle.opacity) > 0.01
          && elementBounds.width > 0
          && elementBounds.height > 0) return true;
        for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
          if (ancestor instanceof HTMLDetailsElement) {
            const summary = ancestor.querySelector(":scope > summary");
            if (summary) {
              const summaryStyle = getComputedStyle(summary);
              const summaryBounds = summary.getBoundingClientRect();
              if (summaryStyle.display !== "none"
                && summaryStyle.visibility !== "hidden"
                && Number(summaryStyle.opacity) > 0.01
                && summaryBounds.width > 0
                && summaryBounds.height > 0) return true;
            }
          }
          if (!ancestor.id) continue;
          const controls = [...document.querySelectorAll(`[aria-controls="${CSS.escape(ancestor.id)}"],[popovertarget="${CSS.escape(ancestor.id)}"]`)];
          for (const control of controls) {
            const controlStyle = getComputedStyle(control);
            const controlBounds = control.getBoundingClientRect();
            if (controlStyle.display !== "none"
              && controlStyle.visibility !== "hidden"
              && Number(controlStyle.opacity) > 0.01
              && controlBounds.width > 0
              && controlBounds.height > 0) return true;
          }
        }
        return false;
      })
      .map((element) => element.getAttribute("href") ?? "")
      .filter((href) => {
        if (!href || /^(?:mailto:|tel:|javascript:|data:)/i.test(href)) return false;
        try {
          return new URL(href, location.href).origin === location.origin;
        } catch {
          return false;
        }
      });
    return [...new Set(hrefs)];
  });
  const unreachable: string[] = [];
  for (const href of destinations) {
    if (await anyMatchingLinkHitTestable(page, href)) continue;
    let revealed = await revealMatchingLinkThroughDisclosures(page, href);
    if (!revealed) {
      const hoverTargets = page.locator("header nav li,header [role=navigation] li,nav[aria-label*=primary i] li,nav[aria-label*=main i] li");
      for (let index = 0; index < await hoverTargets.count() && !revealed; index += 1) {
        await hoverTargets.nth(index).hover({ timeout: probeActionTimeoutMs }).catch(() => undefined);
        await page.waitForTimeout(75);
        revealed = await anyMatchingLinkHitTestable(page, href);
      }
      await page.mouse.move(0, 0).catch(() => undefined);
    }
    if (!revealed) unreachable.push(href.slice(0, 160));
    await page.keyboard.press("Escape").catch(() => undefined);
  }
  const toggleResult = await inspectNavigationToggles(page);
  return {
    destinationCount: destinations.length,
    unreachable,
    toggleCount: toggleResult.toggleCount,
    brokenToggles: toggleResult.brokenToggles,
    designWarnings: toggleResult.designWarnings
  };
}

async function revealMatchingLinkThroughDisclosures(page: Page, href: string) {
  const links = page.locator(primaryLinkSelector);
  for (let linkIndex = 0; linkIndex < await links.count(); linkIndex += 1) {
    const link = links.nth(linkIndex);
    if (await link.getAttribute("href") !== href) continue;
    const openedDetails: Locator[] = [];
    let openedToggle: Locator | undefined;
    try {
      const controlledAncestors = link.locator("xpath=ancestor::*[@id]");
      for (let panelIndex = 0; panelIndex < await controlledAncestors.count() && !openedToggle; panelIndex += 1) {
        const panel = controlledAncestors.nth(panelIndex);
        const panelId = await panel.getAttribute("id");
        if (!panelId) continue;
        const hidden = await panel.getAttribute("hidden") !== null;
        const popover = await panel.getAttribute("popover") !== null;
        const popoverOpen = popover && await panel.evaluate((element) => element.matches(":popover-open")).catch(() => false);
        if (!hidden && (!popover || popoverOpen)) continue;
        const toggles = page.locator("[data-lodesta-menu-toggle],button[aria-controls],[role=button][aria-controls],[popovertarget]");
        for (let toggleIndex = 0; toggleIndex < await toggles.count(); toggleIndex += 1) {
          const toggle = toggles.nth(toggleIndex);
          if ((await toggle.getAttribute("aria-controls") ?? await toggle.getAttribute("popovertarget")) !== panelId) continue;
          if (!await toggle.isVisible().catch(() => false)) continue;
          if (!await navigationTriggerIsOpen(toggle)) {
            const clicked = await toggle.click({ timeout: probeActionTimeoutMs }).then(() => true).catch(() => false);
            if (!clicked) continue;
            openedToggle = toggle;
            await page.waitForTimeout(75);
          }
          break;
        }
      }

      const details = link.locator("xpath=ancestor::details");
      for (let detailIndex = 0; detailIndex < await details.count(); detailIndex += 1) {
        const detail = details.nth(detailIndex);
        if (await detail.getAttribute("open") !== null) continue;
        const summary = detail.locator(":scope > summary");
        if (!await summary.isVisible().catch(() => false)) continue;
        const clicked = await summary.click({ timeout: probeActionTimeoutMs }).then(() => true).catch(() => false);
        if (!clicked) continue;
        openedDetails.push(detail);
        await page.waitForTimeout(75);
      }

      await link.scrollIntoViewIfNeeded({ timeout: probeActionTimeoutMs }).catch(() => undefined);
      await page.waitForTimeout(75);
      if (await linkIsHitTestable(link)) return true;
    } finally {
      for (const detail of openedDetails.reverse()) {
        if (await detail.getAttribute("open") === null) continue;
        const summary = detail.locator(":scope > summary");
        if (await summary.isVisible().catch(() => false)) {
          await summary.click({ timeout: probeActionTimeoutMs }).catch(() => undefined);
        } else {
          await detail.evaluate((element) => element.removeAttribute("open")).catch(() => undefined);
        }
      }
      if (openedToggle) await closeNavigationTrigger(page, openedToggle);
    }
  }
  return false;
}

async function inspectNavigationToggles(page: Page) {
  const toggles = page.locator([
    "header button[aria-expanded]",
    "header button[aria-label*=navigation i]",
    "header button[aria-label*=menu i]",
    "header [popovertarget]",
    "header details > summary",
    "header [role=button][aria-expanded]",
    "header [data-lodesta-menu-toggle]",
    "nav button[aria-expanded]",
    "nav [role=button][aria-expanded]",
    "nav [popovertarget]",
    "nav details > summary"
  ].join(","));
  let toggleCount = 0;
  const brokenToggles: string[] = [];
  const designWarnings: string[] = [];
  for (let index = 0; index < await toggles.count(); index += 1) {
    const toggle = toggles.nth(index);
    if (!await toggle.isVisible().catch(() => false)) continue;
    toggleCount += 1;
    const label = (await toggle.getAttribute("aria-label")
      ?? await toggle.textContent()
      ?? `toggle ${index + 1}`).trim().slice(0, 100);
    const baselinePageState = await page.evaluate(() => ({
      bodyOverflow: getComputedStyle(document.body).overflow,
      rootOverflow: getComputedStyle(document.documentElement).overflow,
      inertCount: document.querySelectorAll("[inert]").length
    }));
    if (await navigationTriggerIsOpen(toggle)) await closeNavigationTrigger(page, toggle);
    const beforeState = await navigationTriggerState(toggle);
    const brandBefore = await inspectHeaderBrandGeometry(toggle);
    const before = await visibleControlledNavigationLinkCount(toggle);
    const clicked = await toggle.click({ timeout: probeActionTimeoutMs }).then(() => true).catch(() => false);
    await page.waitForTimeout(100);
    const after = await visibleControlledNavigationLinkCount(toggle);
    const afterState = await navigationTriggerState(toggle);
    const stateOpened = !beforeState.open && afterState.open;
    const surface = clicked && stateOpened
      ? await inspectNavigationSurface(toggle, brandBefore)
      : { readable: true };
    const pointerOpened = Boolean(clicked && stateOpened && after > before && surface.readable);
    if (!pointerOpened) {
      brokenToggles.push(`${label || `toggle ${index + 1}`} (visible controlled-panel links ${before} → ${after}, state ${beforeState.kind}:${beforeState.open ? "open" : "closed"} → ${afterState.kind}:${afterState.open ? "open" : "closed"})`);
      if (!surface.readable && surface.detail) {
        brokenToggles[brokenToggles.length - 1] += `; ${surface.detail}`;
      }
    } else if (surface.designWarning) {
      designWarnings.push(`${label || `toggle ${index + 1}`} (${surface.designWarning})`);
    }
    await closeNavigationTrigger(page, toggle);
    if (pointerOpened) {
      await toggle.focus().catch(() => undefined);
      await page.keyboard.press("Enter").catch(() => undefined);
      await page.waitForTimeout(100);
      const keyboardOpened = await navigationTriggerIsOpen(toggle).catch(() => false);
      if (!keyboardOpened) {
        brokenToggles.push(`${label || `toggle ${index + 1}`} did not open through keyboard activation.`);
      }
    }
    await closeNavigationTrigger(page, toggle);
    const residualState = await page.evaluate(() => ({
      bodyOverflow: getComputedStyle(document.body).overflow,
      rootOverflow: getComputedStyle(document.documentElement).overflow,
      inertCount: document.querySelectorAll("[inert]").length
    }));
    if ((baselinePageState.bodyOverflow !== "hidden" && residualState.bodyOverflow === "hidden")
      || (baselinePageState.rootOverflow !== "hidden" && residualState.rootOverflow === "hidden")
      || residualState.inertCount > baselinePageState.inertCount) {
      brokenToggles.push(`${label || `toggle ${index + 1}`} left scroll locking or inert page content after closing.`);
    }
    await page.waitForTimeout(150);
    await page.evaluate(async () => {
      document.documentElement.style.setProperty("scroll-behavior", "auto", "important");
      document.body.style.setProperty("scroll-behavior", "auto", "important");
      scrollTo(0, 0);
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
  }
  return { toggleCount, brokenToggles, designWarnings };
}

async function navigationTriggerState(toggle: Locator): Promise<{ open: boolean; kind: "managed" | "popover" | "details" | "visibility" }> {
  return toggle.evaluate((element) => {
    const details = element instanceof HTMLElement ? element.closest("details") : null;
    if (details && element.tagName.toLowerCase() === "summary") {
      return { open: details.hasAttribute("open"), kind: "details" as const };
    }
    const targetId = element.getAttribute("popovertarget") ?? element.getAttribute("aria-controls");
    const target = targetId ? document.getElementById(targetId) : null;
    if (target?.hasAttribute("popover")) {
      return { open: target.matches(":popover-open"), kind: "popover" as const };
    }
    const expanded = element.getAttribute("aria-expanded");
    if (expanded !== null) return { open: expanded === "true", kind: "managed" as const };
    if (target) {
      const style = getComputedStyle(target);
      const bounds = target.getBoundingClientRect();
      return {
        open: !target.hasAttribute("hidden")
          && style.display !== "none"
          && style.visibility !== "hidden"
          && Number(style.opacity) > 0
          && bounds.width > 0
          && bounds.height > 0,
        kind: "visibility" as const
      };
    }
    return { open: false, kind: "visibility" as const };
  });
}

async function navigationTriggerIsOpen(toggle: Locator) {
  return (await navigationTriggerState(toggle)).open;
}

async function closeNavigationTrigger(page: Page, toggle: Locator) {
  if (!await navigationTriggerIsOpen(toggle).catch(() => false)) return;
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.waitForTimeout(75);
  if (await navigationTriggerIsOpen(toggle).catch(() => false)) {
    await toggle.click({ timeout: probeActionTimeoutMs }).catch(() => undefined);
    await page.waitForTimeout(75);
  }
}

async function inspectHeaderBrandGeometry(toggle: Locator): Promise<HeaderBrandGeometry | undefined> {
  return toggle.evaluate((element) => {
    const header = element.closest("header");
    const revisionIds = new Set((globalThis as typeof globalThis & { __lodestaNavigationLogoRevisionIds?: string[] }).__lodestaNavigationLogoRevisionIds ?? []);
    const brand = header
      ? header.querySelector("[data-lodesta-business-name]") ?? [...header.querySelectorAll("img")].find((image) => {
          try {
            const match = new URL(image.currentSrc || image.src, document.baseURI).pathname.match(/^\/_lodesta\/assets\/([^/]+)$/);
            return Boolean(match && revisionIds.has(decodeURIComponent(match[1])));
          } catch {
            return false;
          }
        })
      : undefined;
    if (!header || !brand) return undefined;
    const rect = brand.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const left = Math.max(rect.left, headerRect.left, 0);
    const top = Math.max(rect.top, headerRect.top, 0);
    const right = Math.min(rect.right, headerRect.right, innerWidth);
    const bottom = Math.min(rect.bottom, headerRect.bottom, innerHeight);
    const area = Math.max(1, rect.width * rect.height);
    return {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      visibleRatio: Math.max(0, right - left) * Math.max(0, bottom - top) / area
    };
  });
}

async function inspectNavigationSurface(toggle: Locator, brandBefore?: HeaderBrandGeometry): Promise<NavigationSurfaceResult> {
  return toggle.evaluate((element, before) => {
    const targetId = element.getAttribute("popovertarget") ?? element.getAttribute("aria-controls");
    const details = element.tagName.toLowerCase() === "summary" ? element.closest("details") : null;
    const target = targetId ? document.getElementById(targetId) : details;
    const header = element.closest("header");
    const revisionIds = new Set((globalThis as typeof globalThis & { __lodestaNavigationLogoRevisionIds?: string[] }).__lodestaNavigationLogoRevisionIds ?? []);
    const brand = header
      ? header.querySelector("[data-lodesta-business-name]") ?? [...header.querySelectorAll("img")].find((image) => {
          try {
            const match = new URL(image.currentSrc || image.src, document.baseURI).pathname.match(/^\/_lodesta\/assets\/([^/]+)$/);
            return Boolean(match && revisionIds.has(decodeURIComponent(match[1])));
          } catch {
            return false;
          }
        })
      : undefined;
    let brandDesignWarning: string | undefined;
    if (before && header && brand) {
      const rect = brand.getBoundingClientRect();
      const headerRect = header.getBoundingClientRect();
      const left = Math.max(rect.left, headerRect.left, 0);
      const top = Math.max(rect.top, headerRect.top, 0);
      const right = Math.min(rect.right, headerRect.right, innerWidth);
      const bottom = Math.min(rect.bottom, headerRect.bottom, innerHeight);
      const area = Math.max(1, rect.width * rect.height);
      const visibleRatio = Math.max(0, right - left) * Math.max(0, bottom - top) / area;
      const shifted = Math.abs(rect.left - before.left) > 3 || Math.abs(rect.top - before.top) > 3;
      const resized = Math.abs(rect.width - before.width) > 3 || Math.abs(rect.height - before.height) > 3;
      if (visibleRatio < Math.min(0.9, before.visibleRatio - 0.08) || shifted || resized) {
        brandDesignWarning = `opening the navigation shifts, resizes, or clips the header brand (visible ${Math.round(before.visibleRatio * 100)}% → ${Math.round(visibleRatio * 100)}%)`;
      }
    }
    const managedIcon = element.querySelector("[data-lodesta-navigation-icon]");
    if (managedIcon) {
      const toggleStyle = getComputedStyle(element);
      const competingBackgroundGradients = (toggleStyle.backgroundImage.match(/(?:repeating-)?(?:linear|radial|conic)-gradient\(/gi) ?? []).length;
      const competingPseudo = ["::before", "::after"].some((pseudo) => {
        const style = getComputedStyle(element, pseudo);
        const content = style.content;
        const width = Number.parseFloat(style.width) || 0;
        const height = Number.parseFloat(style.height) || 0;
        const background = style.backgroundColor.match(/^rgba?\(([^)]+)\)$/i);
        const alpha = background ? Number(background[1].split(",").map((part) => part.trim())[3] ?? 1) : 0;
        const hasTextContent = !["", "none", "normal", '""', "''"].includes(content);
        const hasGraphic = width > 0
          && height > 0
          && (alpha > 0 || style.backgroundImage !== "none" || style.boxShadow !== "none");
        return hasTextContent || hasGraphic;
      });
      if (competingPseudo || competingBackgroundGradients >= 2) {
        return { readable: false, detail: "the default navigation icon is obscured by a competing generated icon" };
      }
      const iconBounds = managedIcon.getBoundingClientRect();
      const visibleLines = [...managedIcon.children].filter((line) => {
        const style = getComputedStyle(line);
        const bounds = line.getBoundingClientRect();
        return style.display !== "none"
          && style.visibility !== "hidden"
          && Number(style.opacity) > 0.1
          && bounds.width >= 10
          && bounds.height >= 1;
      });
      if (managedIcon.children.length !== 3 || iconBounds.width < 16 || iconBounds.height < 12 || visibleLines.length < 2) {
        return {
          readable: false,
          detail: `the managed navigation icon collapsed to ${Math.round(iconBounds.width)}×${Math.round(iconBounds.height)}px with ${visibleLines.length} visible line(s)`
        };
      }
    }
    if (!target) return { readable: true, designWarning: brandDesignWarning };
    const openNavigation = target.querySelector(":scope > nav") ?? target.querySelector("nav");
    const openNavigationLinks = openNavigation
      ? [...openNavigation.querySelectorAll("a[href]")].filter((link) => {
          const style = getComputedStyle(link);
          const bounds = link.getBoundingClientRect();
          return style.display !== "none"
            && style.visibility !== "hidden"
            && Number(style.opacity) > 0
            && bounds.width > 0
            && bounds.height > 0;
        })
      : [];
    const root = document.documentElement;
    const targetBounds = target.getBoundingClientRect();
    const clippedInlineLinks = openNavigationLinks.filter((link) => {
      const bounds = link.getBoundingClientRect();
      return bounds.left < -2 || bounds.right > innerWidth + 2;
    });
    const openDocumentOverflow = Math.max(
      0,
      root.scrollWidth - root.clientWidth,
      document.body.scrollWidth - root.clientWidth
    );
    const panelEscapesViewport = targetBounds.left < -2 || targetBounds.right > innerWidth + 2;
    if (openDocumentOverflow > 2 || panelEscapesViewport || clippedInlineLinks.length > 0) {
      const examples = clippedInlineLinks.slice(0, 3).map((link) =>
        JSON.stringify((link.textContent ?? link.getAttribute("aria-label") ?? "link").trim().replace(/\s+/g, " ").slice(0, 60)));
      return {
        readable: false,
        detail: `opening the navigation creates ${Math.round(openDocumentOverflow)}px of document overflow or places its panel outside the phone viewport${examples.length ? `; clipped links ${examples.join(", ")}` : ""}`
      };
    }
    if (target.getAttribute("role") !== "dialog") {
      const actionRecords = [...document.querySelectorAll<HTMLAnchorElement>("a[href]")].flatMap((action) => {
        const style = getComputedStyle(action);
        const bounds = action.getBoundingClientRect();
        if (
          style.display === "none"
          || style.visibility === "hidden"
          || Number(style.opacity) <= 0
          || bounds.width <= 0
          || bounds.height <= 0
          || bounds.bottom <= 0
          || bounds.top >= innerHeight
        ) return [];
        const label = (action.getAttribute("aria-label") ?? action.textContent ?? "")
          .replace(/[\s↗↘→←↓↑+*·•]+$/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
        let href = action.getAttribute("href") ?? "";
        try {
          const url = new URL(action.href);
          href = (url.pathname.replace(/\/+$/, "") || "/") + url.search + url.hash;
        } catch {
          // Keep the literal destination when it cannot be resolved.
        }
        return label && href ? [{ action, key: `${href}|${label}`, bounds }] : [];
      });
      const panelActions = actionRecords.filter((record) => target.contains(record.action));
      const outsideActions = actionRecords.filter((record) => !target.contains(record.action));
      const adjacentDuplicate = panelActions.flatMap((panelAction) => {
        return outsideActions.flatMap((outsideAction) => {
          if (outsideAction.key !== panelAction.key) return [];
          const horizontalOverlap = Math.max(0, Math.min(panelAction.bounds.right, outsideAction.bounds.right) - Math.max(panelAction.bounds.left, outsideAction.bounds.left));
          const overlapRatio = horizontalOverlap / Math.max(1, Math.min(panelAction.bounds.width, outsideAction.bounds.width));
          const boundaryGap = outsideAction.bounds.top - targetBounds.bottom;
          const exposedBelowPanel = outsideAction.bounds.bottom - Math.max(outsideAction.bounds.top, targetBounds.bottom);
          if (overlapRatio < 0.6 || boundaryGap < -72 || boundaryGap > 72 || exposedBelowPanel < 18) return [];
          return [`${JSON.stringify((panelAction.action.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60))} appears again ${Math.round(boundaryGap)}px below the panel boundary`];
        });
      });
      const inlineBoundaryWarning = adjacentDuplicate.length > 0
        ? `the inline panel visually repeats an identical page action across its lower boundary (${adjacentDuplicate[0]})`
        : undefined;
      return {
        readable: true,
        designWarning: [brandDesignWarning, inlineBoundaryWarning].filter(Boolean).join("; ") || undefined
      };
    }
    const toggleBounds = element.getBoundingClientRect();
    const toggleHit = document.elementFromPoint(
      toggleBounds.left + toggleBounds.width / 2,
      toggleBounds.top + toggleBounds.height / 2
    );
    if (!toggleHit || (toggleHit !== element && !element.contains(toggleHit))) {
      return { readable: false, detail: "the opened modal navigation obscures its close control" };
    }
    const headerBounds = element.closest("header")?.getBoundingClientRect();
    if (targetBounds.width < 1 || targetBounds.height < 1) {
      return { readable: false, detail: "the managed modal navigation panel itself has no usable reading area" };
    }
    if (headerBounds && targetBounds.top < headerBounds.bottom - 2) {
      brandDesignWarning = [
        brandDesignWarning,
        `the opened modal navigation begins at ${Math.round(targetBounds.top)}px before the header ends at ${Math.round(headerBounds.bottom)}px`
      ].filter(Boolean).join("; ");
    }
    const candidates = [target, ...target.querySelectorAll(":scope > *")];
    const readableSurface = candidates.some((candidate) => {
      const bounds = candidate.getBoundingClientRect();
      const coversPanel = candidate === target
        || (bounds.width * bounds.height >= targetBounds.width * targetBounds.height * 0.85);
      if (!coversPanel) return false;
      const style = getComputedStyle(candidate);
      const background = style.backgroundColor.match(/^rgba?\(([^)]+)\)$/i);
      const alpha = background
        ? Number(background[1].split(",").map((part) => part.trim())[3] ?? 1)
        : 0;
      const backdropFilter = style.backdropFilter || style.getPropertyValue("-webkit-backdrop-filter");
      return alpha >= 0.85
        || style.backgroundImage !== "none"
        || Boolean(backdropFilter && backdropFilter !== "none");
    });
    if (!readableSurface) {
      return { readable: false, detail: "the opened modal navigation has no opaque, graphic, or backdrop-filtered reading surface" };
    }
    const hasDeclaredSiteSurface = getComputedStyle(target)
      .getPropertyValue("--site-color-background")
      .trim().length > 0;
    const hasAuthoredSurfaceRule = candidates.some((candidate) => {
      if (candidate instanceof HTMLElement) {
        const inline = candidate.style;
        if (
          inline.background
          || inline.backgroundColor
          || inline.backgroundImage
          || inline.backdropFilter
          || inline.getPropertyValue("-webkit-backdrop-filter")
        ) return true;
      }
      return [...document.styleSheets].some((sheet) => {
        try {
          const pending = [...sheet.cssRules];
          while (pending.length > 0) {
            const rule = pending.pop()!;
            if ("selectorText" in rule && "style" in rule) {
              const styleRule = rule as CSSStyleRule;
              const selector = styleRule.selectorText;
              let matches = false;
              try {
                matches = candidate.matches(selector);
              } catch {
                continue;
              }
              if (!matches) continue;
              const surface = styleRule.style.background
                || styleRule.style.backgroundColor
                || styleRule.style.backgroundImage
                || styleRule.style.backdropFilter
                || styleRule.style.getPropertyValue("-webkit-backdrop-filter");
              if (!surface) continue;
              const platformFallback = selector.includes('[data-lodesta-navigation-behavior="modal"]')
                && selector.includes("[data-lodesta-navigation-panel]")
                && /var\(\s*--site-color-background\s*,\s*Canvas\s*\)/i.test(styleRule.style.background);
              if (!platformFallback) return true;
              continue;
            }
            if ("cssRules" in rule) pending.push(...(rule as CSSGroupingRule).cssRules);
          }
          return false;
        } catch {
          return false;
        }
      });
    });
    const navigation = target.querySelector(":scope > nav") ?? target.querySelector("nav");
    if (!navigation) return { readable: true, designWarning: brandDesignWarning };
    const targetStyle = getComputedStyle(target);
    const navigationStyle = getComputedStyle(navigation);
    const panelInlinePadding = Math.max(
      Number.parseFloat(targetStyle.paddingLeft) || 0,
      Number.parseFloat(targetStyle.paddingRight) || 0,
      Number.parseFloat(navigationStyle.paddingLeft) || 0,
      Number.parseFloat(navigationStyle.paddingRight) || 0
    );
    const panelSpacing = Math.max(
      Number.parseFloat(targetStyle.paddingTop) || 0,
      Number.parseFloat(targetStyle.paddingRight) || 0,
      Number.parseFloat(targetStyle.paddingBottom) || 0,
      Number.parseFloat(targetStyle.paddingLeft) || 0,
      Number.parseFloat(navigationStyle.paddingTop) || 0,
      Number.parseFloat(navigationStyle.paddingRight) || 0,
      Number.parseFloat(navigationStyle.paddingBottom) || 0,
      Number.parseFloat(navigationStyle.paddingLeft) || 0,
      Number.parseFloat(navigationStyle.rowGap) || 0,
      Number.parseFloat(navigationStyle.columnGap) || 0
    );
    const links = [...navigation.querySelectorAll("a[href]")].filter((link) => {
      const style = getComputedStyle(link);
      const bounds = link.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0 && bounds.width > 0 && bounds.height > 0;
    });
    const navigationBounds = navigation.getBoundingClientRect();
    const visiblePanelLeft = Math.max(0, targetBounds.left);
    const visiblePanelRight = Math.min(innerWidth, targetBounds.right);
    const clippedLinks = links.filter((link) => {
      const bounds = link.getBoundingClientRect();
      return bounds.left < visiblePanelLeft - 2 || bounds.right > visiblePanelRight + 2;
    });
    const navigationOverflowsHorizontally = navigation.scrollWidth > navigation.clientWidth + 2
      || navigationBounds.left < visiblePanelLeft - 2
      || navigationBounds.right > visiblePanelRight + 2;
    if (navigationOverflowsHorizontally || clippedLinks.length > 0) {
      const examples = clippedLinks.slice(0, 3).map((link) =>
        JSON.stringify((link.textContent ?? link.getAttribute("aria-label") ?? "link").trim().replace(/\s+/g, " ").slice(0, 60)));
      return {
        readable: false,
        detail: `the opened navigation clips or horizontally overflows its phone panel (navigation ${Math.round(navigation.clientWidth)}px client / ${Math.round(navigation.scrollWidth)}px scroll${examples.length ? `; clipped links ${examples.join(", ")}` : ""})`
      };
    }
    const flushLinkStack = links.length >= 2
      && panelInlinePadding < 8
      && links.filter((link) => {
        const bounds = link.getBoundingClientRect();
        const style = getComputedStyle(link);
        const inlinePadding = Math.max(
          Number.parseFloat(style.paddingLeft) || 0,
          Number.parseFloat(style.paddingRight) || 0
        );
        return inlinePadding < 8 && bounds.left - targetBounds.left < 8;
      }).length >= Math.ceil(links.length * 0.6);
    const navigationColorTools = {
      parse(value: string) {
        if (!/^rgba?\(/i.test(value.trim())) return undefined;
        const channels = value.match(/[\d.]+/g)?.map(Number) ?? [];
        return channels.length >= 3
          ? [channels[0], channels[1], channels[2], channels[3] ?? 1]
          : undefined;
      },
      luminance(color: number[]) {
        const channels = color.slice(0, 3).map((value) => {
          const channel = value / 255;
          return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
      },
      contrast(left: number[], right: number[]) {
        const a = navigationColorTools.luminance(left);
        const b = navigationColorTools.luminance(right);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      },
      linkContrast(link: Element) {
        const style = getComputedStyle(link);
        const foreground = navigationColorTools.parse(style.color);
        if (!foreground || foreground[3] < 0.999) return undefined;
        let background: number[] | undefined;
        for (let current: Element | null = link; current; current = current.parentElement) {
          const currentStyle = getComputedStyle(current);
          const backdropFilter = currentStyle.backdropFilter || currentStyle.getPropertyValue("-webkit-backdrop-filter");
          if (
            currentStyle.backgroundImage !== "none"
            || Number(currentStyle.opacity) < 0.999
            || currentStyle.filter !== "none"
            || currentStyle.mixBlendMode !== "normal"
            || (backdropFilter && backdropFilter !== "none")
          ) return undefined;
          const candidate = navigationColorTools.parse(currentStyle.backgroundColor);
          if (!candidate) return undefined;
          if (candidate[3] >= 0.999) {
            background = candidate;
            break;
          }
          if (candidate[3] > 0.001) return undefined;
          if (current === target) break;
        }
        if (!background) return undefined;
        const ratio = navigationColorTools.contrast(foreground, background);
        const fontSize = Number.parseFloat(style.fontSize);
        const fontWeight = Number.parseInt(style.fontWeight, 10) || (/bold/i.test(style.fontWeight) ? 700 : 400);
        const required = fontSize >= 24 || (fontSize >= 18.66 && fontWeight >= 700) ? 3 : 4.5;
        return { ratio, required };
      }
    };
    const unreadableLinks = links
      .map((link) => ({ link, result: navigationColorTools.linkContrast(link) }))
      .filter((entry): entry is { link: HTMLAnchorElement; result: { ratio: number; required: number } } =>
        Boolean(entry.result && entry.result.ratio < entry.result.required));
    if (unreadableLinks.length > 0) {
      const examples = unreadableLinks.slice(0, 3).map(({ link, result }) =>
        `${(link.textContent ?? link.getAttribute("aria-label") ?? "link").trim().replace(/\s+/g, " ").slice(0, 60)} (${result.ratio.toFixed(2)}:1)`);
      return {
        readable: false,
        detail: `${unreadableLinks.length} opened navigation link(s) lack legible solid-color contrast: ${examples.join("; ")}`
      };
    }
    const plainLinks = links.filter((link) => {
      const style = getComputedStyle(link);
      const background = style.backgroundColor.match(/^rgba?\(([^)]+)\)$/i);
      const alpha = background ? Number(background[1].split(",").map((part) => part.trim())[3] ?? 1) : 0;
      const borderWidth = Math.max(
        Number.parseFloat(style.borderTopWidth) || 0,
        Number.parseFloat(style.borderRightWidth) || 0,
        Number.parseFloat(style.borderBottomWidth) || 0,
        Number.parseFloat(style.borderLeftWidth) || 0
      );
      const padding = Math.max(
        Number.parseFloat(style.paddingTop) || 0,
        Number.parseFloat(style.paddingRight) || 0,
        Number.parseFloat(style.paddingBottom) || 0,
        Number.parseFloat(style.paddingLeft) || 0
      );
      return alpha < 0.04
        && style.backgroundImage === "none"
        && borderWidth < 1
        && padding < 2
        && Number.parseInt(style.fontWeight, 10) < 600;
    });
    const toggleStyle = getComputedStyle(element);
    const nativeLookingToggle = toggleStyle.appearance !== "none"
      && Math.max(
        Number.parseFloat(toggleStyle.borderTopWidth) || 0,
        Number.parseFloat(toggleStyle.borderRightWidth) || 0,
        Number.parseFloat(toggleStyle.borderBottomWidth) || 0,
        Number.parseFloat(toggleStyle.borderLeftWidth) || 0
      ) >= 2
      && /^(?:rgb\(239, 239, 239\)|buttonface)$/i.test(toggleStyle.backgroundColor.trim());
    const unstructuredPanel = panelSpacing < 4
      && links.length >= 2
      && plainLinks.length >= Math.ceil(links.length * 0.6);
    if (!hasDeclaredSiteSurface && !hasAuthoredSurfaceRule) {
      return {
        readable: true,
        designWarning: [brandDesignWarning, "the modal panel relies on the platform Canvas fallback instead of an authored brand surface"].filter(Boolean).join("; ")
      };
    }
    if (nativeLookingToggle) {
      return {
        readable: true,
        designWarning: [brandDesignWarning, "the trigger retains browser-default control styling even though the opened panel has an authored brand surface"].filter(Boolean).join("; ")
      };
    }
    if (unstructuredPanel) {
      return {
        readable: true,
        designWarning: [brandDesignWarning, "the trigger is styled but the opened link stack has no deliberate panel spacing, grouping, or link treatment"].filter(Boolean).join("; ")
      };
    }
    if (flushLinkStack) {
      return {
        readable: true,
        designWarning: [brandDesignWarning, "the opened link stack is flush against the panel edge without deliberate horizontal breathing room"].filter(Boolean).join("; ")
      };
    }
    return { readable: true, designWarning: brandDesignWarning };
  }, brandBefore).catch((error) => ({
    readable: false,
    detail: `the opened modal navigation surface could not be inspected: ${error instanceof Error ? error.message : String(error)}`
  }));
}

async function visibleControlledNavigationLinkCount(toggle: Locator) {
  // A modal makes background navigation inert. Only its own controlled panel
  // must reveal links; document-wide counts can decrease on a working sitemap.
  return toggle.evaluate((control) => {
    const targetId = control.getAttribute("popovertarget") ?? control.getAttribute("aria-controls");
    const panel = targetId ? document.getElementById(targetId)
      : control.matches("summary") ? control.closest("details") : null;
    if (!panel) return 0;
    return [...panel.querySelectorAll("a[href]")].filter((element) => {
      if (element.closest("footer")) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) <= 0 || rect.width <= 0 || rect.height <= 0) return false;
      const visibleWidth = Math.max(0, Math.min(innerWidth, rect.right) - Math.max(0, rect.left));
      const visibleHeight = Math.max(0, Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top));
      if (visibleWidth * visibleHeight / Math.max(1, rect.width * rect.height) < 0.75) return false;
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      if (x < 0 || x >= innerWidth || y < 0 || y >= innerHeight) return false;
      const hit = document.elementFromPoint(x, y);
      return Boolean(hit && (hit === element || element.contains(hit)));
    }).length;
  });
}

async function anyMatchingLinkHitTestable(page: Page, href: string) {
  const links = page.locator(primaryLinkSelector);
  for (let index = 0; index < await links.count(); index += 1) {
    const link = links.nth(index);
    if (await link.getAttribute("href") !== href) continue;
    if (await linkIsHitTestable(link)) return true;
  }
  return false;
}

async function linkIsHitTestable(locator: Locator) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (
      style.display === "none"
      || style.visibility === "hidden"
      || Number(style.opacity) <= 0
      || rect.width <= 0
      || rect.height <= 0
    ) return false;
    const visibleWidth = Math.max(0, Math.min(innerWidth, rect.right) - Math.max(0, rect.left));
    const visibleHeight = Math.max(0, Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top));
    if (visibleWidth * visibleHeight / Math.max(1, rect.width * rect.height) < 0.75) return false;
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    if (x < 0 || x >= innerWidth || y < 0 || y >= innerHeight) return false;
    const hit = document.elementFromPoint(x, y);
    return Boolean(hit && (hit === element || element.contains(hit)));
  }).catch(() => false);
}
