"use client";

import { createElement, useEffect, useRef, useState } from "react";
import { getSessionId, getVisitorId } from "./client-identity";

let mapsBootstrapPromise: Promise<void> | undefined;

function loadMapsBootstrap(apiKey: string): Promise<void> {
  if (mapsBootstrapPromise) return mapsBootstrapPromise;
  mapsBootstrapPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-lodesta-maps-bootstrap]");
    if (existing) {
      if ((window as unknown as { google?: unknown }).google) resolve();
      else {
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("Maps bootstrap failed to load")), { once: true });
      }
      return;
    }
    const script = document.createElement("script");
    script.dataset.lodestaMapsBootstrap = "true";
    script.async = true;
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&libraries=places&loading=async`;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Maps bootstrap failed to load"));
    document.head.appendChild(script);
  });
  return mapsBootstrapPromise;
}

type PlacesTrustModuleProps = {
  placeId: string;
  siteId: string;
  mode: "ui_kit" | "link_only";
  apiKey?: string;
  telemetryEnabled: boolean;
};

export function PlacesTrustModule({ placeId, siteId, mode, apiKey, telemetryEnabled }: PlacesTrustModuleProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const reported = useRef(new Set<string>());
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const fallbackReason = mode === "link_only" ? "link_only_policy" : !apiKey ? "missing_browser_key" : failed ? "ui_kit_load_failed" : undefined;

  useEffect(() => {
    if (!fallbackReason) return;
    report("fallback", fallbackReason);
  }, [fallbackReason]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || loaded || failed || mode !== "ui_kit" || !apiKey) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        loadMapsBootstrap(apiKey)
          .then(async () => {
            const maps = (window as unknown as { google?: { maps?: { importLibrary?: (name: string) => Promise<unknown> } } }).google?.maps;
            if (maps?.importLibrary) await maps.importLibrary("places");
            setLoaded(true);
            report("load", "ui_kit_loaded", 0.001);
          })
          .catch(() => {
            setFailed(true);
            report("failure", "ui_kit_load_failed");
          });
      },
      { rootMargin: "200px" }
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, [apiKey, failed, loaded, mode]);

  function report(event: "load" | "failure" | "fallback", reason: string, estimatedCostUsd = 0) {
    const key = `${event}:${reason}`;
    if (!telemetryEnabled || reported.current.has(key)) return;
    reported.current.add(key);
    const payload = JSON.stringify({
      siteId,
      sessionId: getSessionId(),
      visitorId: getVisitorId(),
      eventType: "places_ui",
      timestamp: new Date().toISOString(),
      elementRole: "places_trust_module",
      metadata: { event, reason, estimatedCostUsd }
    });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/analytics", new Blob([payload], { type: "application/json" }));
    } else {
      void fetch("/api/analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true
      });
    }
  }

  return (
    <div
      ref={containerRef}
      className="site-places-trust-v3"
      data-place-id={placeId}
      data-places-state={loaded ? "loaded" : fallbackReason ? "fallback" : "pending"}
    >
      {loaded
        ? createElement(
            "gmp-place-details-compact",
            { orientation: "horizontal" },
            createElement("gmp-place-details-place-request", { place: placeId }),
            createElement("gmp-place-all-content", null)
          )
        : fallbackReason
          ? (
              <a href={`https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(placeId)}`} rel="noopener noreferrer" target="_blank">
                Read our reviews on Google Maps
              </a>
            )
          : null}
    </div>
  );
}
