"use client";

import { useState } from "react";

type FindingApplyFormProps = {
  siteId: string;
  siteSlug: string;
  findingId: string;
  applyMode: "auto_fix" | "one_click" | "manual_service";
  findingStatus: "open" | "dismissed" | "applied";
};

export function FindingApplyForm({ siteId, siteSlug, findingId, applyMode, findingStatus }: FindingApplyFormProps) {
  const [status, setStatus] = useState("");
  const [reviewReady, setReviewReady] = useState(false);
  const [dismissed, setDismissed] = useState(findingStatus === "dismissed");
  const effectiveStatus = dismissed ? "dismissed" : findingStatus;

  async function apply(mode: "draft" | "qa") {
    setStatus(mode === "draft" ? "Applying to draft..." : "Applying to draft and running QA...");
    setReviewReady(false);
    const response = await fetch("/api/action-list/apply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId, findingId, mode })
    });
    const result = await response.json();
    if (!response.ok) {
      setStatus(result.error ?? "Unable to apply finding.");
      return;
    }
    const failed = result.qa?.checks?.filter((check: { severity: string }) => check.severity === "fail").length ?? 0;
    if (mode === "qa") {
      setReviewReady(failed === 0);
      setStatus(
        failed
          ? `Draft staged. QA has ${failed} failing checks.`
          : "Draft staged and QA passed. Confirm publish from Versions."
      );
      return;
    }
    setReviewReady(failed === 0);
    setStatus(`Applied to draft. QA ${failed ? `has ${failed} failing checks` : "passed"}.`);
  }

  async function dismiss() {
    setStatus("Dismissing finding...");
    const response = await fetch("/api/action-list/dismiss", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ siteId, findingId })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      setStatus(result.error ?? "Unable to dismiss finding.");
      return;
    }
    setDismissed(true);
    setReviewReady(false);
    setStatus("Dismissed.");
  }

  if (effectiveStatus === "applied") {
    return (
      <p className="form-status">
        Applied to draft. <a href={`/versions/${siteSlug}`}>Review and confirm publish</a>.
      </p>
    );
  }

  if (effectiveStatus === "dismissed") {
    return <p className="form-status">Dismissed.</p>;
  }

  if (applyMode === "manual_service") {
    return (
      <div className="button-row">
        <p className="form-status">Manual service required before this can be changed safely.</p>
        <button className="button secondary" type="button" onClick={() => void dismiss()}>
          Dismiss
        </button>
        {status ? <p className="form-status">{status}</p> : null}
      </div>
    );
  }

  return (
    <div className="button-row">
      <button className="button secondary" type="button" onClick={() => void apply("draft")}>
        Apply to draft
      </button>
      <button className="button primary" type="button" onClick={() => void apply("qa")}>
        Apply + run QA
      </button>
      {reviewReady ? (
        <a className="button secondary" href={`/versions/${siteSlug}`}>
          Review draft
        </a>
      ) : null}
      <button className="button secondary" type="button" onClick={() => void dismiss()}>
        Dismiss
      </button>
      {status ? <p className="form-status">{status}</p> : null}
    </div>
  );
}
