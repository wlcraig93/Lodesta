"use client";

import { useState } from "react";

type FindingApplyFormProps = {
  siteId: string;
  findingId: string;
  applyMode: "auto_fix" | "one_click" | "manual_service";
  findingStatus: "open" | "dismissed" | "applied";
};

export function FindingApplyForm({ siteId, findingId, applyMode, findingStatus }: FindingApplyFormProps) {
  const [status, setStatus] = useState("");

  async function apply(mode: "draft" | "publish_after_qa") {
    setStatus(mode === "draft" ? "Applying to draft..." : "Applying and running QA...");
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
    if (mode === "publish_after_qa") {
      setStatus(result.published ? "Applied, QA passed, and draft published." : `Applied to draft. QA has ${failed} failing checks.`);
      return;
    }
    setStatus(`Applied to draft. QA ${failed ? `has ${failed} failing checks` : "passed"}.`);
  }

  if (applyMode === "manual_service") {
    return <p className="form-status">Manual service required before this can be changed safely.</p>;
  }

  if (findingStatus === "applied") {
    return <p className="form-status">Applied to draft. Publish after QA when ready.</p>;
  }

  if (findingStatus === "dismissed") {
    return <p className="form-status">Dismissed.</p>;
  }

  return (
    <div className="button-row">
      <button className="button secondary" type="button" onClick={() => void apply("draft")}>
        Apply to draft
      </button>
      <button className="button primary" type="button" onClick={() => void apply("publish_after_qa")}>
        Apply + QA publish
      </button>
      {status ? <p className="form-status">{status}</p> : null}
    </div>
  );
}
