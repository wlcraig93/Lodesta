"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { AdminButton, AdminButtonAnchor } from "@/components/admin/AdminButton";
import type {
  DesignSystemGateComparatorIdV1,
  DesignSystemGateReviewPayloadV1
} from "@/lib/design-system-gate-review-v1";
import type { DesignSystemGateReviewFixtureV1 } from "@/lib/design-system-gate-review-fixtures-v1";

type ScoreState = {
  id: DesignSystemGateComparatorIdV1;
  wouldOwnerPay: boolean;
  ownerPayScore: number;
  notes: string;
};

export function DesignSystemGateReview({
  fixture,
  initialReview,
  capturePathBase,
  pilotPreviewHref,
  saveEnabled = true
}: {
  fixture: DesignSystemGateReviewFixtureV1;
  initialReview?: DesignSystemGateReviewPayloadV1;
  capturePathBase: string;
  pilotPreviewHref: string;
  saveEnabled?: boolean;
}) {
  const router = useRouter();
  const fixtureReview = initialReview?.fixtureReviews.find((review) => review.fixtureId === fixture.fixtureId);
  const initialScores = useMemo(
    () => new Map(fixtureReview?.scores.map((score) => [score.id, score]) ?? []),
    [fixtureReview]
  );
  const [activeCapture, setActiveCapture] = useState<DesignSystemGateComparatorIdV1>("pilot_design_system");
  const [reviewer, setReviewer] = useState(initialReview?.reviewer ?? "operator");
  const [winner, setWinner] = useState<DesignSystemGateComparatorIdV1 | "no_winner">(
    fixtureReview?.winner ?? "no_winner"
  );
  const [rationale, setRationale] = useState(fixtureReview?.rationale ?? "");
  const [scores, setScores] = useState<ScoreState[]>(
    fixture.captures.map((capture) => {
      const initial = initialScores.get(capture.id);
      return {
        id: capture.id,
        wouldOwnerPay: initial?.wouldOwnerPay ?? false,
        ownerPayScore: initial?.ownerPayScore ?? 0,
        notes: initial?.notes ?? ""
      };
    })
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const projectedPass = gateWouldPass(scores, winner);

  function updateScore(id: DesignSystemGateComparatorIdV1, patch: Partial<ScoreState>) {
    setScores((current) => current.map((score) => (score.id === id ? { ...score, ...patch } : score)));
  }

  async function saveReview() {
    if (submitting || !saveEnabled) return;
    setSubmitting(true);
    setError(null);
    setSavedMessage(null);
    try {
      const response = await fetch(`/api/site-candidates/${fixture.candidateId}/design-system-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewer, winner, rationale, scores })
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string; gatePassed?: boolean };
      if (!response.ok) {
        setError(payload.error ?? "Design-system review could not be saved.");
        return;
      }
      setSavedMessage(payload.gatePassed ? "Review saved. The Phase 5 gate passes." : "Review saved. The pilot is not ready for Phase 5.");
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Design-system review could not be saved.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <section className="design-gate-comparison" aria-label="Four-way website comparison">
        <div className="design-gate-comparison-toolbar">
          <div>
            <strong>Owner-pay comparison</strong>
            <span>{fixture.pricePrompt}</span>
          </div>
          <AdminButtonAnchor href={pilotPreviewHref} target="_blank" rel="noreferrer" size="sm">
            Open live pilot
          </AdminButtonAnchor>
        </div>

        <div className="segmented-control design-gate-tabs" aria-label="Comparison option">
          {fixture.captures.map((capture) => (
            <button
              key={capture.id}
              type="button"
              className={activeCapture === capture.id ? "active" : undefined}
              onClick={() => setActiveCapture(capture.id)}
            >
              {capture.label}
            </button>
          ))}
        </div>

        <div className="design-gate-comparison-viewport">
          <div className="design-gate-comparison-grid">
            {fixture.captures.map((capture) => {
              const imageHref = `${capturePathBase}/${capture.id}`;
              return (
                <article
                  key={capture.id}
                  className={`design-gate-comparison-panel ${activeCapture === capture.id ? "is-active" : ""}`}
                  data-comparator={capture.id}
                >
                  <header>
                    <div>
                      <h2>{capture.label}</h2>
                      <p>{capture.description}</p>
                    </div>
                    {capture.id === "pilot_design_system" ? <span className="badge status-pending">Pilot</span> : null}
                  </header>
                  <a className="design-gate-capture" href={imageHref} target="_blank" rel="noreferrer">
                    <img src={imageHref} alt={`${capture.label} capture for ${fixture.businessName}`} />
                  </a>
                  <footer>
                    <span>{capture.sourceLabel}</span>
                    {capture.sourceUrl ? (
                      <a href={capture.sourceUrl} target="_blank" rel="noreferrer">
                        Open source
                      </a>
                    ) : null}
                  </footer>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="design-gate-review-form" aria-labelledby="design-gate-review-title">
        <div className="design-gate-review-heading">
          <div>
            <span className="badge">Phase 5 evidence</span>
            <h2 id="design-gate-review-title">Record the decision</h2>
            <p>The pilot passes only when an owner would pay, it wins, and its score beats the previous pipeline.</p>
          </div>
          <span className={`badge ${projectedPass ? "status-ready" : "status-pending"}`}>
            {projectedPass ? "Gate will pass" : "Gate not ready"}
          </span>
        </div>

        <div className="design-gate-review-meta">
          <label>
            <span>Reviewer</span>
            <input value={reviewer} maxLength={80} onChange={(event) => setReviewer(event.target.value)} />
          </label>
          <label className="design-gate-no-winner">
            <input
              type="radio"
              name="design-gate-winner"
              checked={winner === "no_winner"}
              onChange={() => setWinner("no_winner")}
            />
            <span>No option wins</span>
          </label>
        </div>

        <div className="design-gate-score-grid">
          {fixture.captures.map((capture) => {
            const score = scores.find((entry) => entry.id === capture.id);
            if (!score) return null;
            return (
              <article key={capture.id} className="design-gate-score">
                <label className="design-gate-winner-choice">
                  <input
                    type="radio"
                    name="design-gate-winner"
                    checked={winner === capture.id}
                    onChange={() => setWinner(capture.id)}
                  />
                  <span>{capture.label} wins</span>
                </label>
                <div className="design-gate-score-controls">
                  <label>
                    <span>Owner-pay score</span>
                    <input
                      type="number"
                      min="0"
                      max="100"
                      value={score.ownerPayScore}
                      onChange={(event) => updateScore(capture.id, { ownerPayScore: Number(event.target.value) })}
                    />
                  </label>
                  <label className="design-gate-owner-pay">
                    <input
                      type="checkbox"
                      checked={score.wouldOwnerPay}
                      onChange={(event) => updateScore(capture.id, { wouldOwnerPay: event.target.checked })}
                    />
                    <span>Owner would pay</span>
                  </label>
                </div>
                <label>
                  <span>Evidence</span>
                  <textarea
                    value={score.notes}
                    maxLength={1000}
                    placeholder="What makes this feel worth paying for, or not?"
                    onChange={(event) => updateScore(capture.id, { notes: event.target.value })}
                  />
                </label>
              </article>
            );
          })}
        </div>

        <label className="design-gate-rationale">
          <span>Decision rationale</span>
          <textarea
            value={rationale}
            maxLength={1200}
            placeholder="State why the winner is the strongest commercial website for this business."
            onChange={(event) => setRationale(event.target.value)}
          />
        </label>

        <div className="design-gate-review-actions">
          {initialReview?.reviewedAt ? <span>Last saved {formatDate(initialReview.reviewedAt)}</span> : <span>Not yet reviewed</span>}
          {saveEnabled ? (
            <AdminButton variant="primary" onClick={saveReview} disabled={submitting}>
              {submitting ? "Saving..." : "Save gate review"}
            </AdminButton>
          ) : null}
        </div>
        {error ? <p className="form-status error-text">{error}</p> : null}
        {savedMessage ? <p className="form-status success-text">{savedMessage}</p> : null}
      </section>
    </>
  );
}

function gateWouldPass(scores: ScoreState[], winner: DesignSystemGateComparatorIdV1 | "no_winner") {
  const pilot = scores.find((score) => score.id === "pilot_design_system");
  const current = scores.find((score) => score.id === "current_pipeline");
  const existing = scores.find((score) => score.id === "existing_site");
  const competitor = scores.find((score) => score.id === "local_competitor");
  return Boolean(
    winner === "pilot_design_system" &&
      pilot?.wouldOwnerPay &&
      pilot.ownerPayScore > (current?.ownerPayScore ?? -1) &&
      pilot.ownerPayScore >= (existing?.ownerPayScore ?? -1) &&
      pilot.ownerPayScore >= (competitor?.ownerPayScore ?? -1)
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}
