"use client";

import { useState, type ReactNode } from "react";

type ReviewPaneDevice = "desktop" | "tablet" | "mobile";

type ReviewPanePage = {
  slug: string;
  title: string;
};

const deviceWidths: Record<ReviewPaneDevice, number | null> = {
  desktop: null,
  tablet: 834,
  mobile: 390
};

const REPORT_TAB = "__report";

export function CandidateReviewPane({
  candidateId,
  businessName,
  pages,
  previewAvailable,
  fallbackSlot,
  reportSlot
}: {
  candidateId: string;
  businessName: string;
  pages: ReviewPanePage[];
  previewAvailable: boolean;
  fallbackSlot?: ReactNode;
  reportSlot: ReactNode;
}) {
  const firstSlug = pages[0]?.slug ?? "";
  const [tab, setTab] = useState<string>(previewAvailable ? firstSlug : REPORT_TAB);
  const [device, setDevice] = useState<ReviewPaneDevice>("desktop");

  const showingReport = tab === REPORT_TAB;
  const activeSlug = showingReport ? firstSlug : tab;
  const previewPath = activeSlug ? `/${activeSlug}` : "";
  const previewSrc = `/site-candidate-previews/${candidateId}${previewPath}`;
  const width = deviceWidths[device];

  return (
    <div className="candidate-review-pane-inner">
      <div className="candidate-review-toolbar">
        <div className="candidate-review-tabs" role="tablist" aria-label="Candidate artifacts">
          {previewAvailable
            ? pages.map((page) => (
                <button
                  key={page.slug}
                  type="button"
                  role="tab"
                  aria-selected={tab === page.slug}
                  className={tab === page.slug ? "is-active" : ""}
                  onClick={() => setTab(page.slug)}
                >
                  {page.title}
                </button>
              ))
            : (
                <button type="button" role="tab" aria-selected={!showingReport} className={!showingReport ? "is-active" : ""} onClick={() => setTab(firstSlug)}>
                  Site
                </button>
              )}
          <button
            type="button"
            role="tab"
            aria-selected={showingReport}
            className={showingReport ? "is-active candidate-review-report-tab" : "candidate-review-report-tab"}
            onClick={() => setTab(REPORT_TAB)}
          >
            Customer report
          </button>
        </div>
        {!showingReport && previewAvailable ? (
          <div className="candidate-review-toolbar-right">
            <div className="candidate-review-devices" role="group" aria-label="Preview width">
              {(Object.keys(deviceWidths) as ReviewPaneDevice[]).map((name) => (
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
            <a className="candidate-review-open" href={previewSrc} target="_blank" rel="noopener noreferrer">
              Open
            </a>
          </div>
        ) : null}
      </div>

      {showingReport ? (
        <div className="candidate-review-report">{reportSlot}</div>
      ) : previewAvailable ? (
        <div className="candidate-review-frame-wrap" data-device={device}>
          <iframe
            key={`${activeSlug}:${device}`}
            className="candidate-review-frame"
            src={previewSrc}
            title={`${businessName} preview`}
            style={width ? { width: `${width}px` } : undefined}
          />
        </div>
      ) : (
        <div className="candidate-review-fallback">{fallbackSlot}</div>
      )}
    </div>
  );
}
