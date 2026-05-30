"use client";

import { useEffect } from "react";
import { getSessionId, getSessionStartedAt, getVisitorId } from "./client-identity";

type AnalyticsTrackerProps = {
  siteId: string;
  pageId?: string;
};

const scrollDepthThresholds = [25, 50, 75, 90, 100];

export function AnalyticsTracker({ siteId, pageId }: AnalyticsTrackerProps) {
  useEffect(() => {
    const sessionId = getSessionId();
    const visitorId = getVisitorId();
    const sessionStartedAt = getSessionStartedAt();
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const deviceType = getDeviceType(window.innerWidth);
    const startedAt = performance.now();
    const pageMetadata = pageContextMetadata();

    sendEvent({
      siteId,
      sessionId,
      pageId,
      eventType: "pageview",
      viewport,
      deviceType,
      metadata: {
        ...pageMetadata,
        sessionElapsedMs: Date.now() - sessionStartedAt
      }
    });

    let lastVisibleAt = document.visibilityState === "visible" ? performance.now() : null;
    let engagedMs = 0;
    let latestScrollDepth = currentScrollDepth();
    let scrollRaf = 0;
    const reportedScrollDepths = new Set<number>();

    const flushEngagement = () => {
      const now = performance.now();
      if (lastVisibleAt !== null) {
        engagedMs += now - lastVisibleAt;
        lastVisibleAt = document.visibilityState === "visible" ? now : null;
      }
      if (engagedMs < 1000) return;
      sendEvent({
        siteId,
        sessionId,
        pageId,
        eventType: "engagement",
        value: Math.round(engagedMs),
        viewport,
        deviceType,
        metadata: {
          ...pageMetadata,
          elapsedMs: Math.round(now - startedAt),
          scrollDepth: latestScrollDepth
        }
      });
      engagedMs = 0;
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        flushEngagement();
        return;
      }
      lastVisibleAt = performance.now();
    };

    const webVitalObservers = observeWebVitals((metric, value) => {
      sendEvent({
        siteId,
        sessionId,
        pageId,
        eventType: "web_vital",
        value,
        viewport,
        deviceType,
        metadata: { metric }
      });
    });

    const observedSections = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const sectionId = (entry.target as HTMLElement).dataset.sectionId;
          if (entry.isIntersecting && sectionId && !observedSections.has(sectionId)) {
            observedSections.add(sectionId);
            sendEvent({
              siteId,
              sessionId,
              pageId,
              eventType: "section_view",
              sectionId,
              viewport,
              deviceType,
              metadata: {
                elapsedMs: Math.round(performance.now() - startedAt),
                intersectionRatio: Number(entry.intersectionRatio.toFixed(2))
              }
            });
          }
        }
      },
      { threshold: 0.45 }
    );

    document.querySelectorAll<HTMLElement>("[data-section-id]").forEach((section) => observer.observe(section));

    const onClick = (event: MouseEvent) => {
      const target = clickTargetFor(event.target);
      if (!target) return;

      const rect = document.documentElement.getBoundingClientRect();
      const href = target instanceof HTMLAnchorElement ? target.href : "";
      const hrefType = classifyHref(href, target.dataset.analyticsRole);
      const sectionId = target.closest<HTMLElement>("[data-section-id]")?.dataset.sectionId;
      const eventType = hrefType === "tel" ? "tel_click" : hrefType === "booking" || hrefType === "ordering" ? "outbound_click" : "click";
      const now = performance.now();

      sendEvent({
        siteId,
        sessionId,
        pageId,
        eventType,
        sectionId,
        elementRole: elementRoleFor(target),
        elementType: target.tagName.toLowerCase(),
        hrefType,
        normalizedX: clamp(event.clientX / Math.max(rect.width, 1)),
        normalizedY: clamp((event.clientY + window.scrollY) / Math.max(document.documentElement.scrollHeight, 1)),
        viewport,
        deviceType,
        metadata: {
          elapsedMs: Math.round(now - startedAt),
          sessionElapsedMs: Date.now() - sessionStartedAt,
          scrollDepth: latestScrollDepth
        }
      });
    };

    const onFocusIn = (event: FocusEvent) => {
      const form = event.target instanceof Element ? event.target.closest<HTMLFormElement>("form") : null;
      if (!form || form.dataset.formStarted === "true") return;
      form.dataset.formStarted = "true";
      enrichLeadForm(form, sessionId, visitorId, sessionStartedAt, pageId, pageMetadata);
      sendEvent({
        siteId,
        sessionId,
        pageId,
        eventType: "form_start",
        sectionId: form.closest<HTMLElement>("[data-section-id]")?.dataset.sectionId,
        viewport,
        deviceType,
        metadata: {
          elapsedMs: Math.round(performance.now() - startedAt),
          scrollDepth: latestScrollDepth
        }
      });
    };

    const onSubmit = (event: SubmitEvent) => {
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      if (!form) return;
      enrichLeadForm(form, sessionId, visitorId, sessionStartedAt, pageId, pageMetadata);
    };

    const recordScrollDepth = () => {
      scrollRaf = 0;
      latestScrollDepth = currentScrollDepth();
      for (const threshold of scrollDepthThresholds) {
        if (latestScrollDepth < threshold || reportedScrollDepths.has(threshold)) continue;
        reportedScrollDepths.add(threshold);
        sendEvent({
          siteId,
          sessionId,
          pageId,
          eventType: "scroll_depth",
          value: threshold,
          viewport,
          deviceType,
          metadata: {
            elapsedMs: Math.round(performance.now() - startedAt),
            path: pageMetadata.path
          }
        });
      }
    };

    const onScroll = () => {
      if (scrollRaf) return;
      scrollRaf = window.requestAnimationFrame(recordScrollDepth);
    };

    recordScrollDepth();

    document.addEventListener("click", onClick, { capture: true });
    document.addEventListener("focusin", onFocusIn, { capture: true });
    document.addEventListener("submit", onSubmit, { capture: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    window.addEventListener("pagehide", flushEngagement);

    return () => {
      flushEngagement();
      if (scrollRaf) window.cancelAnimationFrame(scrollRaf);
      observer.disconnect();
      webVitalObservers.forEach((vitalObserver) => vitalObserver.disconnect());
      document.removeEventListener("click", onClick, { capture: true });
      document.removeEventListener("focusin", onFocusIn, { capture: true });
      document.removeEventListener("submit", onSubmit, { capture: true });
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("pagehide", flushEngagement);
    };
  }, [siteId, pageId]);

  return null;
}

function sendEvent(event: Record<string, unknown>) {
  const visitorId = typeof window === "undefined" ? undefined : window.__lodestaVisitorId;
  const payload = JSON.stringify({
    timestamp: new Date().toISOString(),
    ...(visitorId ? { visitorId } : {}),
    ...event
  });

  if (navigator.sendBeacon) {
    const blob = new Blob([payload], { type: "application/json" });
    navigator.sendBeacon("/api/analytics", blob);
    return;
  }

  void fetch("/api/analytics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true
  });
}

function pageContextMetadata() {
  const searchParams = new URLSearchParams(window.location.search);
  return {
    path: window.location.pathname,
    referrerHost: safeHost(document.referrer),
    utmSource: searchParams.get("utm_source") ?? "",
    utmMedium: searchParams.get("utm_medium") ?? "",
    utmCampaign: searchParams.get("utm_campaign") ?? ""
  };
}

function currentScrollDepth() {
  const pageHeight = Math.max(document.documentElement.scrollHeight, window.innerHeight, 1);
  return Math.max(0, Math.min(100, Math.round(((window.scrollY + window.innerHeight) / pageHeight) * 100)));
}

function safeHost(value: string) {
  if (!value) return "";
  try {
    return new URL(value).host;
  } catch {
    return "";
  }
}

function classifyHref(href: string, role?: string) {
  if (href.startsWith("tel:") || role === "tel" || role === "sticky-tel") return "tel";
  if (href.startsWith("mailto:")) return "mailto";
  if (role === "booking") return "booking";
  if (role === "ordering") return "ordering";
  if (!href || href.startsWith(window.location.origin)) return "internal";
  return "external";
}

function clickTargetFor(target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>("a,button,[data-analytics-role]") ?? target.closest<HTMLElement>("[data-section-id] *") ?? target.closest<HTMLElement>("[data-section-id]");
}

function elementRoleFor(target: HTMLElement) {
  return (
    sanitizedAnalyticsToken(target.dataset.analyticsRole) ||
    sanitizedAnalyticsToken(target.getAttribute("aria-label")) ||
    sanitizedAnalyticsToken(target.getAttribute("role")) ||
    sanitizedAnalyticsToken(target.getAttribute("type")) ||
    target.tagName.toLowerCase()
  );
}

function sanitizedAnalyticsToken(value: string | null | undefined) {
  const cleaned = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return cleaned || undefined;
}

function getDeviceType(width: number) {
  if (width < 720) return "mobile";
  if (width < 1024) return "tablet";
  return "desktop";
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function ensureHiddenInput(form: HTMLFormElement, name: string, value: string) {
  let input = form.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (!input) {
    input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    form.append(input);
  }
  input.value = value;
}

function enrichLeadForm(
  form: HTMLFormElement,
  sessionId: string,
  visitorId: string | undefined,
  sessionStartedAt: number,
  pageId: string | undefined,
  pageMetadata: ReturnType<typeof pageContextMetadata>
) {
  ensureHiddenInput(form, "sessionId", sessionId);
  if (visitorId) ensureHiddenInput(form, "visitorId", visitorId);
  ensureHiddenInput(form, "pageId", pageId ?? "unknown");
  ensureHiddenInput(form, "sourceUrl", window.location.href);
  ensureHiddenInput(form, "landingPath", pageMetadata.path);
  ensureHiddenInput(form, "referrerHost", pageMetadata.referrerHost);
  ensureHiddenInput(form, "utmSource", pageMetadata.utmSource);
  ensureHiddenInput(form, "utmMedium", pageMetadata.utmMedium);
  ensureHiddenInput(form, "utmCampaign", pageMetadata.utmCampaign);
  ensureHiddenInput(form, "sessionStartedAt", String(sessionStartedAt));
}

function observeWebVitals(onMetric: (metric: string, value: number) => void) {
  const observers: PerformanceObserver[] = [];

  if ("PerformanceObserver" in window) {
    try {
      const lcpObserver = new PerformanceObserver((entryList) => {
        const entries = entryList.getEntries();
        const last = entries.at(-1);
        if (last) onMetric("LCP", Math.round(last.startTime));
      });
      lcpObserver.observe({ type: "largest-contentful-paint", buffered: true });
      observers.push(lcpObserver);
    } catch {
      // Browser does not support this metric.
    }

    try {
      let cls = 0;
      const clsObserver = new PerformanceObserver((entryList) => {
        for (const entry of entryList.getEntries() as Array<PerformanceEntry & { value?: number; hadRecentInput?: boolean }>) {
          if (!entry.hadRecentInput) cls += entry.value ?? 0;
        }
        onMetric("CLS", Number(cls.toFixed(4)));
      });
      clsObserver.observe({ type: "layout-shift", buffered: true });
      observers.push(clsObserver);
    } catch {
      // Browser does not support this metric.
    }

    try {
      const inpObserver = new PerformanceObserver((entryList) => {
        for (const entry of entryList.getEntries() as Array<PerformanceEntry & { duration?: number }>) {
          onMetric("INP", Math.round(entry.duration ?? 0));
        }
      });
      inpObserver.observe({ type: "event", buffered: true });
      observers.push(inpObserver);
    } catch {
      // Browser does not support this metric.
    }
  }

  const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
  if (nav) {
    onMetric("TTFB", Math.round(nav.responseStart));
  }

  return observers;
}
