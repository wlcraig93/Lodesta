"use client";

import { useState, type ReactNode } from "react";

type ReviewPaneDevice = "desktop" | "tablet" | "mobile";

type ReviewPanePage = {
  slug: string;
  title: string;
};

export type CandidateDesignExample = {
  artifactId: string;
  exampleId: string;
  title: string;
  direction: string;
  mediaMode: string;
  status: string;
  scores: {
    visualQuality: number;
    noMediaCompleteness: number;
  };
};

const deviceWidths: Record<ReviewPaneDevice, number | null> = {
  desktop: null,
  tablet: 834,
  mobile: 390
};

const REPORT_TAB = "__report";
const OWNER_UNCLAIMED_TAB = "__owner_unclaimed";
const OWNER_CLAIMED_TAB = "__owner_claimed";
const DESIGN_EXAMPLES_TAB = "__design_examples";

export function CandidateReviewPane({
  candidateId,
  businessName,
  pages,
  designExamples = [],
  previewAvailable,
  fallbackSlot,
  reportSlot
}: {
  candidateId: string;
  businessName: string;
  pages: ReviewPanePage[];
  designExamples?: CandidateDesignExample[];
  previewAvailable: boolean;
  fallbackSlot?: ReactNode;
  reportSlot: ReactNode;
}) {
  const firstSlug = pages[0]?.slug ?? "";
  const [tab, setTab] = useState<string>(previewAvailable ? firstSlug : REPORT_TAB);
  const [device, setDevice] = useState<ReviewPaneDevice>("desktop");
  const [rightsApproved, setRightsApproved] = useState(true);
  const [activeDesignExampleId, setActiveDesignExampleId] = useState(designExamples[0]?.artifactId ?? "");

  const showingReport = tab === REPORT_TAB;
  const showingOwnerUnclaimed = tab === OWNER_UNCLAIMED_TAB;
  const showingOwnerClaimed = tab === OWNER_CLAIMED_TAB;
  const showingDesignExamples = tab === DESIGN_EXAMPLES_TAB;
  const showingOwner = showingOwnerUnclaimed || showingOwnerClaimed;
  const showingSite = !showingReport && !showingOwner && !showingDesignExamples;
  const activeSlug = showingSite ? tab : firstSlug;
  const previewPath = activeSlug ? `/${activeSlug}` : "";
  const sitePreviewSrc = `/site-candidate-previews/${candidateId}${previewPath}${rightsApproved ? "" : "?rights=declined"}`;
  const ownerPreviewSrc = `/site-candidate-owner-previews/${candidateId}${showingOwnerClaimed ? "?mode=claimed" : ""}`;
  const activeDesignExample = designExamples.find((example) => example.artifactId === activeDesignExampleId) ?? designExamples[0];
  const designExamplePreviewSrc = activeDesignExample
    ? `/admin/site-candidates/${candidateId}/design-examples/${activeDesignExample.artifactId}/preview`
    : "";
  const activePreviewSrc = showingDesignExamples ? designExamplePreviewSrc : showingOwner ? ownerPreviewSrc : sitePreviewSrc;
  const width = deviceWidths[device];

  return (
    <div className="candidate-review-pane-inner">
      <div className="candidate-review-toolbar">
        <div className="candidate-review-artifacts" role="group" aria-label="Candidate artifacts">
          {previewAvailable && showingSite ? (
            <label className="candidate-review-page-select">
              <span>Page</span>
              <select aria-label="Preview page" value={activeSlug} onChange={(event) => setTab(event.target.value)}>
                {pages.map((page) => (
                  <option key={page.slug} value={page.slug}>
                    {page.title}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <button
              type="button"
              aria-pressed={showingSite}
              className={showingSite ? "is-active" : ""}
              onClick={() => setTab(firstSlug)}
              disabled={!previewAvailable}
            >
              Generated site
            </button>
          )}
          {previewAvailable ? (
            <>
              <button
                type="button"
                aria-pressed={showingOwnerUnclaimed}
                className={showingOwnerUnclaimed ? "is-active" : ""}
                onClick={() => setTab(OWNER_UNCLAIMED_TAB)}
              >
                Owner: unclaimed
              </button>
              <button
                type="button"
                aria-pressed={showingOwnerClaimed}
                className={showingOwnerClaimed ? "is-active" : ""}
                onClick={() => setTab(OWNER_CLAIMED_TAB)}
              >
                Owner: claimed
              </button>
            </>
          ) : null}
          <button
            type="button"
            aria-pressed={showingReport}
            className={showingReport ? "is-active candidate-review-report-tab" : "candidate-review-report-tab"}
            onClick={() => setTab(REPORT_TAB)}
          >
            Customer report
          </button>
          <button
            type="button"
            aria-pressed={showingDesignExamples}
            className={showingDesignExamples ? "is-active" : ""}
            onClick={() => setTab(DESIGN_EXAMPLES_TAB)}
          >
            Design examples
          </button>
        </div>
        {!showingReport && (previewAvailable || showingDesignExamples) ? (
          <div className="candidate-review-toolbar-right">
            {showingSite ? (
              <div className="candidate-review-devices" role="group" aria-label="Scraped media rights simulation">
                <button
                  type="button"
                  aria-pressed={rightsApproved}
                  className={rightsApproved ? "is-active" : ""}
                  title="Preview with scraped media (owner attests rights)"
                  onClick={() => setRightsApproved(true)}
                >
                  rights: yes
                </button>
                <button
                  type="button"
                  aria-pressed={!rightsApproved}
                  className={!rightsApproved ? "is-active" : ""}
                  title="Preview with backup imagery (owner declines media rights)"
                  onClick={() => setRightsApproved(false)}
                >
                  rights: no
                </button>
              </div>
            ) : null}
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
            {activePreviewSrc ? (
              <a className="candidate-review-open" href={activePreviewSrc} target="_blank" rel="noopener noreferrer">
                Open
              </a>
            ) : null}
          </div>
        ) : null}
      </div>

      {showingReport ? (
        <div className="candidate-review-report">{reportSlot}</div>
      ) : showingDesignExamples ? (
        <div className="candidate-design-examples">
          {designExamples.length ? (
            <>
              <div className="candidate-design-example-list" role="list" aria-label="Design examples">
                {designExamples.map((example) => (
                  <button
                    key={example.artifactId}
                    type="button"
                    className={example.artifactId === activeDesignExample?.artifactId ? "is-active" : ""}
                    onClick={() => setActiveDesignExampleId(example.artifactId)}
                  >
                    <span>{example.title}</span>
                    <small>{example.mediaMode.replaceAll("_", " ")} · visual {example.scores.visualQuality} · floor {example.scores.noMediaCompleteness}</small>
                  </button>
                ))}
              </div>
              <div className="candidate-review-frame-wrap" data-device={device}>
                <iframe
                  key={`${activePreviewSrc}:${device}`}
                  className="candidate-review-frame"
                  sandbox=""
                  src={activePreviewSrc}
                  title={`${businessName} design example ${activeDesignExample?.title ?? ""}`}
                  style={width ? { width: `${width}px` } : undefined}
                />
              </div>
            </>
          ) : (
            <div className="candidate-review-fallback">
              <p>No design examples have been generated for this candidate.</p>
            </div>
          )}
        </div>
      ) : previewAvailable ? (
        <div className="candidate-review-frame-wrap" data-device={device}>
          <iframe
            key={`${activePreviewSrc}:${device}:${rightsApproved ? "rights" : "norights"}`}
            className="candidate-review-frame"
            src={activePreviewSrc}
            title={showingOwner ? `${businessName} owner experience mock` : `${businessName} preview`}
            style={width ? { width: `${width}px` } : undefined}
          />
        </div>
      ) : (
        <div className="candidate-review-fallback">{fallbackSlot}</div>
      )}
    </div>
  );
}
