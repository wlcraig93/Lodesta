"use client";

import { createElement, useEffect, useRef, useState } from "react";

/**
 * Google Places UI Kit trust module (compact Place Details).
 *
 * Policy (docs/social-proof-agent-brief.md): claimed sites render this module;
 * anonymous unclaimed sites get link-only CTAs; tokenized previews render it
 * behind a server-side COGS cap. Bills per component load (~$1/1,000 after the
 * monthly free tier), so it lazy-mounts only when scrolled into view.
 *
 * Uses a browser-scoped, HTTP-referrer-restricted public key — never the
 * server Places key.
 */

let mapsBootstrapPromise: Promise<void> | undefined;

function loadMapsBootstrap(apiKey: string): Promise<void> {
  if (mapsBootstrapPromise) return mapsBootstrapPromise;
  mapsBootstrapPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector("script[data-lodesta-maps-bootstrap]");
    if (existing) {
      resolve();
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

export function PlacesTrustModule({ placeId, apiKey }: { placeId: string; apiKey: string }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mounted) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        loadMapsBootstrap(apiKey)
          .then(async () => {
            const maps = (window as unknown as { google?: { maps?: { importLibrary?: (name: string) => Promise<unknown> } } }).google?.maps;
            if (maps?.importLibrary) await maps.importLibrary("places");
            setMounted(true);
          })
          .catch(() => setFailed(true));
      },
      { rootMargin: "200px" }
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, [apiKey, mounted]);

  // Silent omission on failure: the section renders without the module.
  if (failed) return null;

  // Custom elements via createElement: React 19 passes unknown tags through as
  // web components without JSX intrinsic-element typing.
  return (
    <div ref={containerRef} className="site-places-trust-v3" data-place-id={placeId}>
      {mounted
        ? createElement(
            "gmp-place-details-compact",
            { orientation: "horizontal" },
            createElement("gmp-place-details-place-request", { place: placeId }),
            createElement("gmp-place-all-content", null)
          )
        : null}
    </div>
  );
}
