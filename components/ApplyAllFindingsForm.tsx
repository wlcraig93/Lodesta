"use client";

import { useState } from "react";

type ApplyAllFindingsFormProps = {
  siteId: string;
  siteSlug: string;
  safeFindingCount: number;
};

export function ApplyAllFindingsForm({ siteId, siteSlug, safeFindingCount }: ApplyAllFindingsFormProps) {
  const [status, setStatus] = useState("");
  const [changeSummary, setChangeSummary] = useState("");
  const [reviewReady, setReviewReady] = useState(false);

  async function applyAll(mode: "draft" | "qa") {
    setStatus(mode === "draft" ? "Applying safe findings..." : "Applying safe findings and running QA...");
    setChangeSummary("");
    setReviewReady(false);
    const response = await fetch("/api/action-list/apply-all", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId, mode })
    });
    const result = await response.json();
    if (!response.ok) {
      setStatus(result.error ?? "Unable to apply safe findings.");
      return;
    }

    const applied = result.results?.filter((item: { applied: boolean }) => item.applied).length ?? 0;
    const failedChecks = result.qa?.checks?.filter((check: { severity: string }) => check.severity === "fail").length ?? 0;
    const summaries =
      result.results
        ?.map((item: { changeSummary?: { summary?: string } }) => item.changeSummary?.summary)
        .filter(Boolean)
        .slice(0, 3) ?? [];
    setChangeSummary(summaries.length ? summaries.join(" ") : "");
    if (mode === "qa") {
      setReviewReady(failedChecks === 0);
      setStatus(
        failedChecks
          ? `Applied ${applied} findings. QA has ${failedChecks} failing checks.`
          : `Applied ${applied} findings, QA passed, and draft is ready for publish confirmation.`
      );
      return;
    }
    setReviewReady(failedChecks === 0);
    setStatus(`Applied ${applied} findings to draft. QA ${failedChecks ? `has ${failedChecks} failing checks` : "passed"}.`);
  }

  if (safeFindingCount === 0) {
    return <p className="form-status">No one-click or auto-fix findings are open.</p>;
  }

  return (
    <div className="apply-all-box">
      <p>{safeFindingCount} safe recommendation{safeFindingCount === 1 ? "" : "s"} can be applied without manual service.</p>
      <div className="button-row">
        <button className="button secondary" type="button" onClick={() => void applyAll("draft")}>
          Apply safe findings
        </button>
        <button className="button primary" type="button" onClick={() => void applyAll("qa")}>
          Apply + run QA
        </button>
        {reviewReady ? (
          <a className="button secondary" href={`/versions/${siteSlug}`}>
            Review draft
          </a>
        ) : null}
      </div>
      {status ? <p className="form-status">{status}</p> : null}
      {changeSummary ? <p className="form-status">Changes: {changeSummary}</p> : null}
    </div>
  );
}
