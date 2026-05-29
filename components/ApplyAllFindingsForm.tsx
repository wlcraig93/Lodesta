"use client";

import { useState } from "react";

type ApplyAllFindingsFormProps = {
  siteId: string;
  safeFindingCount: number;
};

export function ApplyAllFindingsForm({ siteId, safeFindingCount }: ApplyAllFindingsFormProps) {
  const [status, setStatus] = useState("");

  async function applyAll(mode: "draft" | "publish_after_qa") {
    setStatus(mode === "draft" ? "Applying safe findings..." : "Applying safe findings and running QA...");
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
    if (mode === "publish_after_qa") {
      setStatus(
        result.published
          ? `Applied ${applied} findings, QA passed, and draft published.`
          : `Applied ${applied} findings. QA has ${failedChecks} failing checks.`
      );
      return;
    }
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
        <button className="button primary" type="button" onClick={() => void applyAll("publish_after_qa")}>
          Apply + QA publish
        </button>
      </div>
      {status ? <p className="form-status">{status}</p> : null}
    </div>
  );
}
