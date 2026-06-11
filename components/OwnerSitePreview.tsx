"use client";

import { useState } from "react";

type PreviewDevice = "desktop" | "tablet" | "mobile";

type PreviewPage = {
  slug: string;
  title: string;
};

const deviceWidths: Record<PreviewDevice, number | null> = {
  desktop: null,
  tablet: 834,
  mobile: 390
};

export function OwnerSitePreview({
  businessName,
  pages,
  buildSrc
}: {
  businessName: string;
  pages: PreviewPage[];
  buildSrc: (pageSlug: string) => string;
}) {
  const [pageSlug, setPageSlug] = useState(pages[0]?.slug ?? "");
  const [device, setDevice] = useState<PreviewDevice>("desktop");
  const src = buildSrc(pageSlug);
  const width = deviceWidths[device];

  return (
    <div className="candidate-review-pane-inner">
      <div className="candidate-review-toolbar">
        <div className="candidate-review-tabs" role="tablist" aria-label="Site pages">
          {pages.map((page) => (
            <button
              key={page.slug}
              type="button"
              role="tab"
              aria-selected={pageSlug === page.slug}
              className={pageSlug === page.slug ? "is-active" : ""}
              onClick={() => setPageSlug(page.slug)}
            >
              {page.title}
            </button>
          ))}
        </div>
        <div className="candidate-review-toolbar-right">
          <div className="candidate-review-devices" role="group" aria-label="Preview width">
            {(Object.keys(deviceWidths) as PreviewDevice[]).map((name) => (
              <button
                key={name}
                type="button"
                aria-pressed={device === name}
                className={device === name ? "is-active" : ""}
                onClick={() => setDevice(name)}
              >
                {name}
              </button>
            ))}
          </div>
          <a className="candidate-review-open" href={src} target="_blank" rel="noopener noreferrer">
            Open
          </a>
        </div>
      </div>
      <div className="candidate-review-frame-wrap" data-device={device}>
        <iframe
          key={`${pageSlug}:${device}`}
          className="candidate-review-frame"
          src={src}
          title={`${businessName} preview`}
          style={width ? { width: `${width}px` } : undefined}
        />
      </div>
    </div>
  );
}
