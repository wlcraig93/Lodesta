(() => {
  "use strict";

  const root = document.documentElement;
  const siteId = root.dataset.lodestaSiteId || document.body.dataset.lodestaSiteId || "";
  const versionId = root.dataset.lodestaVersionId || document.body.dataset.lodestaVersionId || "";
  const analyticsEnabled = root.dataset.lodestaAnalytics === "true";
  const previewContext = location.pathname.startsWith("/preview/")
    || location.pathname.startsWith("/api/site-versions/")
    || location.pathname.startsWith("/api/site-agent/");
  const internalAgent = /\bLodesta(?:WebsiteCrawler|WebsiteAssessment|RenderInspection|RetainedSiteVerifier)\b/i.test(navigator.userAgent);
  const analyticsAllowed = Boolean(siteId && versionId && analyticsEnabled && !previewContext && !internalAgent);
  const visit = analyticsAllowed ? visitContext() : null;
  const pageStartedAt = Date.now();
  let activeStartedAt = document.visibilityState === "visible" ? pageStartedAt : 0;
  let engagedMs = 0;
  let maxScrollDepth = 0;
  let engagementSent = false;

  let openNavigation = null;
  let activeNavigation = null;
  for (const toggle of document.querySelectorAll("[data-lodesta-menu-toggle]")) {
    const targetId = toggle.getAttribute("aria-controls");
    const target = targetId ? document.getElementById(targetId) : null;
    if (!target) continue;
    const wrapper = toggle.closest("[data-lodesta-navigation-disclosure]") || toggle.parentElement;
    const behavior = wrapper?.getAttribute("data-lodesta-navigation-behavior") === "modal" ? "modal" : "inline";
    const managedPanel = target.hasAttribute("data-lodesta-navigation-panel");
    const state = { toggle, target, wrapper, behavior, managedPanel, inertRecords: [], scrollLock: null };
    toggle.addEventListener("click", () => setNavigationOpen(state, toggle.getAttribute("aria-expanded") !== "true", true));
    target.addEventListener("click", (event) => {
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (link && isInternalNavigationLink(link)) setNavigationOpen(state, false, false);
    });
    const initiallyOpen = toggle.getAttribute("aria-expanded") === "true";
    if (initiallyOpen) {
      if (openNavigation && openNavigation !== state) setNavigationOpen(openNavigation, false, false);
      updateNavigationMarkup(state, true);
      openNavigation = state;
      if (behavior === "modal") activateModalNavigation(state, false);
    } else updateNavigationMarkup(state, false);
  }
  document.addEventListener("keydown", (event) => {
    if (!openNavigation) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setNavigationOpen(openNavigation, false, true);
      return;
    }
    if (event.key === "Tab" && activeNavigation?.behavior === "modal") trapNavigationFocus(event, activeNavigation);
  });
  addEventListener("resize", () => {
    if (activeNavigation?.behavior === "modal") positionNavigation(activeNavigation);
  }, { passive: true });

  function setNavigationOpen(state, open, restoreFocus) {
    if (open && openNavigation && openNavigation !== state) setNavigationOpen(openNavigation, false, false);
    updateNavigationMarkup(state, open);
    if (open) {
      openNavigation = state;
      if (state.behavior === "modal") activateModalNavigation(state, true);
      return;
    }
    if (activeNavigation === state) deactivateModalNavigation(state, restoreFocus);
    else if (restoreFocus) state.toggle.focus({ preventScroll: true });
    if (openNavigation === state) openNavigation = null;
  }

  function updateNavigationMarkup(state, open) {
    state.toggle.setAttribute("aria-expanded", String(open));
    const label = state.toggle.getAttribute(open ? "data-lodesta-close-label" : "data-lodesta-open-label");
    if (label) state.toggle.setAttribute("aria-label", label);
    state.toggle.toggleAttribute("data-lodesta-open", open);
    state.target.toggleAttribute("data-lodesta-open", open);
    state.wrapper?.toggleAttribute("data-lodesta-open", open);
    if (state.managedPanel) state.target.hidden = !open;
  }

  function activateModalNavigation(state, moveFocus) {
    activeNavigation = state;
    positionNavigation(state);
    state.inertRecords = suppressOutsideNavigation(state.wrapper);
    state.scrollLock = {
      rootOverflow: root.style.overflow,
      bodyOverflow: document.body.style.overflow
    };
    root.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    root.setAttribute("data-lodesta-navigation-locked", "");
    if (moveFocus) {
      const first = navigationFocusables(state)[0];
      (first || state.target).focus({ preventScroll: true });
    }
  }

  function deactivateModalNavigation(state, restoreFocus) {
    for (const record of state.inertRecords) {
      if (record.hadAttribute) record.element.setAttribute("inert", "");
      else record.element.removeAttribute("inert");
    }
    state.inertRecords = [];
    if (state.scrollLock) {
      root.style.overflow = state.scrollLock.rootOverflow;
      document.body.style.overflow = state.scrollLock.bodyOverflow;
    }
    state.scrollLock = null;
    root.removeAttribute("data-lodesta-navigation-locked");
    activeNavigation = null;
    if (restoreFocus) state.toggle.focus({ preventScroll: true });
  }

  function positionNavigation(state) {
    const header = state.toggle.closest("header");
    const top = header ? Math.max(0, Math.min(innerHeight, header.getBoundingClientRect().bottom)) : 0;
    const value = `${Math.round(top * 100) / 100}px`;
    state.wrapper?.style.setProperty("--lodesta-navigation-top", value);
    state.target.style.setProperty("--lodesta-navigation-top", value);
  }

  function suppressOutsideNavigation(wrapper) {
    if (!wrapper) return [];
    const records = [];
    let branch = wrapper;
    while (branch.parentElement) {
      const parent = branch.parentElement;
      for (const sibling of parent.children) {
        if (sibling === branch) continue;
        records.push({ element: sibling, hadAttribute: sibling.hasAttribute("inert") });
        sibling.setAttribute("inert", "");
      }
      if (parent === document.body) break;
      branch = parent;
    }
    return records;
  }

  function navigationFocusables(state) {
    const selector = "a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])";
    return [state.toggle, ...state.target.querySelectorAll(selector)].filter((element, index, all) =>
      all.indexOf(element) === index
      && !element.closest("[hidden],[inert]")
      && element.getClientRects().length > 0
    );
  }

  function trapNavigationFocus(event, state) {
    const focusables = navigationFocusables(state);
    if (!focusables.length) {
      event.preventDefault();
      state.target.focus({ preventScroll: true });
      return;
    }
    const first = focusables[0];
    const last = focusables.at(-1);
    if (event.shiftKey && (document.activeElement === first || !state.wrapper?.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !state.wrapper?.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  }

  function isInternalNavigationLink(link) {
    const href = link.getAttribute("href") || "";
    if (!href || /^(?:mailto:|tel:|javascript:|data:)/i.test(href)) return false;
    try {
      return new URL(href, location.href).origin === location.origin;
    } catch {
      return false;
    }
  }

  for (const button of document.querySelectorAll("[data-lodesta-gallery-direction]")) {
    button.addEventListener("click", () => {
      const galleryId = button.getAttribute("aria-controls");
      const gallery = galleryId ? document.getElementById(galleryId) : null;
      if (!gallery) return;
      const direction = button.getAttribute("data-lodesta-gallery-direction") === "previous" ? -1 : 1;
      gallery.scrollBy({ left: direction * Math.max(240, gallery.clientWidth * 0.8), behavior: "smooth" });
    });
  }

  for (const form of document.querySelectorAll("form[data-lodesta-form-id]")) {
    if (previewContext) {
      form.setAttribute("data-lodesta-preview", "true");
    }
    form.setAttribute("data-lodesta-rendered-at", String(Date.now()));
    const formId = form.getAttribute("data-lodesta-form-id") || "";
    const start = () => {
      if (form.dataset.lodestaAnalyticsStarted === "true") return;
      form.dataset.lodestaAnalyticsStarted = "true";
      track("form_start", { formId });
    };
    form.addEventListener("focusin", start, { once: true });
    form.addEventListener("input", start, { once: true });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const submit = form.querySelector("button[type=submit],input[type=submit]");
      const status = form.querySelector("[data-lodesta-form-status]");
      if (previewContext) {
        if (status) status.textContent = "Preview successful. This form is valid and no lead was created.";
        return;
      }
      if (submit) submit.disabled = true;
      if (status) status.textContent = "Sending...";
      const payload = Object.fromEntries(new FormData(form).entries());
      try {
        const response = await fetch("/api/forms/submit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            siteId,
            versionId,
            formId,
            pageId: location.pathname,
            formRenderedAt: Number(form.getAttribute("data-lodesta-rendered-at") || 0),
            payload,
            ...analyticsContext(newEventId())
          })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.accepted === false) throw new Error(result.error || "Submission failed");
        form.reset();
        if (status) status.textContent = form.getAttribute("data-lodesta-success-message") || "Thanks. Your message was sent.";
      } catch {
        if (status) status.textContent = "We could not send this message. Please call or try again.";
      } finally {
        if (submit) submit.disabled = false;
      }
    });
  }

  document.addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest("a") : null;
    if (!link) return;
    const href = link.getAttribute("href") || "";
    const role = link.getAttribute("data-lodesta-conversion") || link.getAttribute("data-lodesta-role") || "link";
    if (href.startsWith("tel:")) track("call_click", { role });
    else if (href.startsWith("mailto:")) track("email_click", { role });
    else if (link.matches("[data-lodesta-map-fallback], [data-lodesta-directions]")) track("directions_click", { role });
    else if (isBookingLink(link, href)) track("booking_click", { role });
    else if (isOrderingLink(link, href)) track("ordering_click", { role });
    else if (isExternalHttpLink(href)) track("outbound_click", { role, destinationHost: safeHost(href) });
  });

  addEventListener("scroll", () => {
    const scrollable = Math.max(1, document.documentElement.scrollHeight - innerHeight);
    maxScrollDepth = Math.max(maxScrollDepth, Math.min(100, Math.round(scrollY / scrollable * 100)));
  }, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") activeStartedAt = Date.now();
    else {
      finishActiveTime();
      sendEngagement();
    }
  });
  addEventListener("pagehide", () => {
    finishActiveTime();
    sendEngagement();
  });

  track("page_view", { returning: Boolean(visit && !visit.isNewVisitor) });
  observeWebVitals();

  function track(eventType, properties) {
    if (!analyticsAllowed || !visit) return;
    const body = JSON.stringify({
      ...analyticsContext(newEventId()),
      siteId,
      versionId,
      eventType,
      pagePath: location.pathname,
      deviceCategory: deviceCategory(),
      elapsedMs: Math.max(0, Date.now() - pageStartedAt),
      properties
    });
    sendAnalytics(body);
  }

  function analyticsContext(eventId) {
    if (!visit) return {};
    return {
      eventId,
      visitorId: visit.visitorId,
      visitId: visit.visitId,
      landingPath: visit.landingPath,
      referrerHost: visit.referrerHost,
      utmSource: visit.utmSource,
      utmMedium: visit.utmMedium,
      utmCampaign: visit.utmCampaign,
      deviceCategory: deviceCategory(),
      elapsedMs: Math.max(0, Date.now() - pageStartedAt)
    };
  }

  function sendAnalytics(body) {
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/analytics", new Blob([body], { type: "application/json" }));
      return;
    }
    fetch("/api/analytics", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true
    }).catch(() => {});
  }

  function visitContext() {
    const now = Date.now();
    const visitorKey = `lodesta_analytics_visitor_${siteId}`;
    const visitKey = `lodesta_analytics_visit_${siteId}`;
    const visitorTtl = 395 * 24 * 60 * 60 * 1000;
    let visitor = readStorage(visitorKey);
    const isNewVisitor = !visitor || !visitor.id || visitor.expiresAt <= now;
    if (isNewVisitor) visitor = { id: newEventId(), firstSeenAt: now, expiresAt: now + visitorTtl };
    visitor.expiresAt = now + visitorTtl;

    let current = readStorage(visitKey);
    if (!current || !current.id || now - current.lastActivityAt >= 30 * 60 * 1000) {
      const params = new URLSearchParams(location.search);
      const referrerHost = externalReferrerHost();
      const observedAttribution = {
        referrerHost,
        utmSource: cleanParam(params.get("utm_source")),
        utmMedium: cleanParam(params.get("utm_medium")),
        utmCampaign: cleanParam(params.get("utm_campaign"))
      };
      const hasObservedAttribution = Boolean(
        observedAttribution.referrerHost || observedAttribution.utmSource || observedAttribution.utmMedium
      );
      if (hasObservedAttribution) visitor.lastNonDirect = observedAttribution;
      const attribution = hasObservedAttribution ? observedAttribution : visitor.lastNonDirect || {};
      current = {
        id: newEventId(),
        lastActivityAt: now,
        landingPath: location.pathname,
        referrerHost: attribution.referrerHost,
        utmSource: attribution.utmSource,
        utmMedium: attribution.utmMedium,
        utmCampaign: attribution.utmCampaign
      };
    } else {
      current.lastActivityAt = now;
    }
    writeStorage(visitorKey, visitor);
    writeStorage(visitKey, current);
    return {
      visitorId: visitor.id,
      visitId: current.id,
      isNewVisitor,
      landingPath: current.landingPath || "/",
      referrerHost: current.referrerHost || undefined,
      utmSource: current.utmSource || undefined,
      utmMedium: current.utmMedium || undefined,
      utmCampaign: current.utmCampaign || undefined
    };
  }

  function sendEngagement() {
    if (engagementSent || engagedMs < 1000) return;
    engagementSent = true;
    track("engagement", { engagedMs: Math.min(3_600_000, Math.round(engagedMs)), maxScrollDepth });
  }

  function finishActiveTime() {
    if (!activeStartedAt) return;
    engagedMs += Date.now() - activeStartedAt;
    activeStartedAt = 0;
  }

  function observeWebVitals() {
    if (!analyticsAllowed || typeof PerformanceObserver === "undefined") return;
    try {
      let cls = 0;
      const layout = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) cls += entry.value;
      });
      layout.observe({ type: "layout-shift", buffered: true });
      addEventListener("pagehide", () => track("web_vital", { metric: "CLS", value: Math.round(cls * 1000) / 1000 }), { once: true });
      const paint = new PerformanceObserver((list) => {
        const last = list.getEntries().at(-1);
        if (last) track("web_vital", { metric: "LCP", value: Math.round(last.startTime) });
      });
      paint.observe({ type: "largest-contentful-paint", buffered: true });
    } catch {
      // Unsupported metrics are intentionally omitted.
    }
  }

  function readStorage(key) {
    try {
      return JSON.parse(localStorage.getItem(key) || "null");
    } catch {
      return null;
    }
  }

  function writeStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Analytics remains non-blocking when storage is unavailable.
    }
  }

  function newEventId() {
    return typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `event_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  function deviceCategory() {
    return innerWidth < 640 ? "mobile" : innerWidth < 1024 ? "tablet" : "desktop";
  }

  function externalReferrerHost() {
    try {
      if (!document.referrer) return undefined;
      const url = new URL(document.referrer);
      return url.host === location.host ? undefined : url.hostname.replace(/^www\./, "").slice(0, 253);
    } catch {
      return undefined;
    }
  }

  function isExternalHttpLink(href) {
    try {
      const url = new URL(href, location.href);
      return /^https?:$/.test(url.protocol) && url.host !== location.host;
    } catch {
      return false;
    }
  }

  function safeHost(href) {
    try {
      return new URL(href, location.href).hostname.replace(/^www\./, "").slice(0, 253);
    } catch {
      return "";
    }
  }

  function isBookingLink(link, href) {
    return link.matches("[data-lodesta-booking]") || /\b(book|schedule|appointment)\b/i.test(`${link.textContent || ""} ${href}`);
  }

  function isOrderingLink(link, href) {
    return link.matches("[data-lodesta-ordering]") || /\b(order|delivery|pickup)\b/i.test(`${link.textContent || ""} ${href}`);
  }

  function cleanParam(value) {
    return value ? value.trim().replace(/\s+/g, " ").slice(0, 160) : undefined;
  }
})();
