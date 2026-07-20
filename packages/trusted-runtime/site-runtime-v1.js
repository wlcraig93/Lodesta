(() => {
  "use strict";

  const root = document.documentElement;
  const siteId = root.dataset.lodestaSiteId || document.body.dataset.lodestaSiteId || "";
  const versionId = root.dataset.lodestaVersionId || document.body.dataset.lodestaVersionId || "";
  const analyticsEnabled = root.dataset.lodestaAnalytics === "true";
  const previewContext = location.pathname.startsWith("/preview/")
    || location.pathname.startsWith("/api/site-versions/")
    || location.pathname.startsWith("/api/site-agent/");

  for (const toggle of document.querySelectorAll("[data-lodesta-menu-toggle]")) {
    toggle.addEventListener("click", () => {
      const targetId = toggle.getAttribute("aria-controls");
      const target = targetId ? document.getElementById(targetId) : null;
      if (!target) return;
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!expanded));
      target.toggleAttribute("data-lodesta-open", !expanded);
    });
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

  for (const map of document.querySelectorAll("[data-lodesta-map]")) {
    const fallback = map.querySelector("[data-lodesta-map-fallback]");
    if (fallback) {
      fallback.addEventListener("click", () => track("places_ui", {
        event: "fallback",
        locationId: map.getAttribute("data-lodesta-map") || "",
        estimatedCostUsd: 0
      }));
    }
  }

  for (const form of document.querySelectorAll("form[data-lodesta-form-id]")) {
    if (previewContext) {
      form.setAttribute("data-lodesta-disabled", "true");
      for (const control of form.querySelectorAll("input, textarea, select, button")) control.disabled = true;
    }
    form.setAttribute("data-lodesta-rendered-at", String(Date.now()));
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (form.hasAttribute("data-lodesta-disabled")) return;
      const submit = form.querySelector("button[type=submit],input[type=submit]");
      const status = form.querySelector("[data-lodesta-form-status]");
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
            formId: form.getAttribute("data-lodesta-form-id"),
            pageId: location.pathname,
            formRenderedAt: Number(form.getAttribute("data-lodesta-rendered-at") || 0),
            payload
          })
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result.accepted === false) throw new Error(result.error || "Submission failed");
        form.reset();
        if (status) status.textContent = form.getAttribute("data-lodesta-success-message") || "Thanks. Your message was sent.";
        track("form_submit", { formId: form.getAttribute("data-lodesta-form-id") || "" });
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
    if (href.startsWith("tel:")) track("tel_click", { href });
    else if (href.startsWith("mailto:")) track("click", { href, hrefType: "mailto" });
    else if (link.hasAttribute("data-lodesta-conversion")) track("click", { href, hrefType: "internal" });
  });

  track("pageview", { path: location.pathname });

  function track(eventType, metadata) {
    if (!siteId || !analyticsEnabled || previewContext) return;
    const body = JSON.stringify({
      siteId,
      versionId,
      pageId: location.pathname,
      eventType,
      timestamp: new Date().toISOString(),
      sessionId: sessionId(),
      metadata
    });
    if (navigator.sendBeacon) navigator.sendBeacon("/api/analytics", new Blob([body], { type: "application/json" }));
    else fetch("/api/analytics", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
  }

  function sessionId() {
    const key = "lodesta_site_session";
    try {
      const current = sessionStorage.getItem(key);
      if (current) return current;
      const next = crypto.randomUUID();
      sessionStorage.setItem(key, next);
      return next;
    } catch {
      return `session_${Date.now()}`;
    }
  }
})();
