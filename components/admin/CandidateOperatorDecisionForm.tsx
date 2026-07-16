"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AdminButton } from "@/components/admin/AdminButton";
import type { OperatorDecisionPayloadV1 } from "@/lib/operator-decision-v1";

type OperatorDecisionStatus = OperatorDecisionPayloadV1["status"];

export function CandidateOperatorDecisionForm({
  candidateId,
  initialDecision
}: {
  candidateId: string;
  initialDecision?: OperatorDecisionPayloadV1;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<OperatorDecisionStatus>(initialDecision?.status ?? "needs_work");
  const [reviewer, setReviewer] = useState(initialDecision?.reviewer ?? "operator");
  const [reviewMinutes, setReviewMinutes] = useState(String(initialDecision?.reviewMinutes ?? ""));
  const [rationale, setRationale] = useState(initialDecision?.rationale ?? "");
  const [acceptedDefects, setAcceptedDefects] = useState(initialDecision?.acceptedDefects ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function saveDecision() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch(`/api/site-candidates/${candidateId}/operator-decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          reviewer,
          reviewMinutes: reviewMinutes ? Number(reviewMinutes) : 0,
          rationale,
          acceptedDefects
        })
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Decision save failed.");
        return;
      }
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Decision save failed.");
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      void saveDecision();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const approved = status === "approved_for_outreach";
  return (
    <div className="candidate-operator-decision">
      <div className="candidate-operator-decision-status">
        <span className={`badge ${approved ? "status-ready" : "status-pending"}`}>
          {approved ? "Approved for outreach" : "Needs work"}
        </span>
        {initialDecision?.reviewedAt ? <small>Last saved {formatDate(initialDecision.reviewedAt)}</small> : null}
      </div>

      <div className="candidate-operator-decision-segment" role="radiogroup" aria-label="Operator decision">
        <label className={approved ? "is-selected" : undefined}>
          <input
            type="radio"
            name="operator-decision"
            value="approved_for_outreach"
            checked={approved}
            onChange={() => setStatus("approved_for_outreach")}
          />
          Approve
        </label>
        <label className={!approved ? "is-selected" : undefined}>
          <input
            type="radio"
            name="operator-decision"
            value="needs_work"
            checked={!approved}
            onChange={() => setStatus("needs_work")}
          />
          Needs work
        </label>
      </div>

      <div className="candidate-operator-decision-fields">
        <label>
          <span>Reviewer</span>
          <input value={reviewer} onChange={(event) => setReviewer(event.target.value)} />
        </label>
        <label>
          <span>Minutes</span>
          <input
            inputMode="decimal"
            min="0"
            max="240"
            type="number"
            value={reviewMinutes}
            onChange={(event) => setReviewMinutes(event.target.value)}
          />
        </label>
      </div>

      <label className="candidate-operator-decision-textarea">
        <span>Decision rationale</span>
        <textarea
          value={rationale}
          placeholder={approved ? "Why is this ready to show the owner?" : "What must change before outreach?"}
          onChange={(event) => setRationale(event.target.value)}
        />
      </label>
      <label className="candidate-operator-decision-textarea">
        <span>Accepted defects</span>
        <textarea value={acceptedDefects} placeholder="Leave blank if none." onChange={(event) => setAcceptedDefects(event.target.value)} />
      </label>

      <div className="candidate-operator-decision-actions">
        <AdminButton variant="secondary" type="button" onClick={saveDecision} disabled={submitting || !rationale.trim()}>
          {submitting ? "Saving..." : "Save decision"}
        </AdminButton>
      </div>
      {error ? <p className="form-status error-text">{error}</p> : null}
    </div>
  );
}

function formatDate(input: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(input));
}
