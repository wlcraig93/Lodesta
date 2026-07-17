import type { SiteBundle, StandardCheckResult, StandardEvaluation } from "@/lib/models";
import { getEffectiveGenerationQaReadiness } from "@/lib/site-version-metadata";
import { coldUrlCheckableChecks } from "@/lib/standard-evaluation";

export function PreviewWedge({ bundle }: { bundle: SiteBundle }) {
  const sourceEvaluation = bundle.presenceAssessment.standardEvaluation;
  const evidence = bundle.presenceAssessment.evidenceManifest;
  const failedChecks = topFailedChecks(coldUrlCheckableChecks(sourceEvaluation?.checks ?? []));
  const sourceUrl = bundle.presenceAssessment.sourceUrl ?? sourceEvaluation?.sourceUrl;
  const reviewVersion = bundle.siteModel.versions.find((version) => version.status === "draft")
    ?? bundle.siteModel.versions[0];
  const readiness = reviewVersion ? getEffectiveGenerationQaReadiness(bundle, reviewVersion) : "unavailable";
  const presenceNotes = [
    ...bundle.presenceAssessment.technicalNotes,
    ...bundle.presenceAssessment.brandNotes,
    ...bundle.presenceAssessment.publicPresenceNotes
  ].slice(0, 4);

  return (
    <section className="preview-wedge">
      <div className="preview-wedge-copy">
        <span className="badge">Private preview</span>
        <h1>{bundle.businessProfile.name} has a new draft site ready to review.</h1>
        <p>
          This preview pairs the replacement site with the concrete issues found in the current online presence. The
          current-site score is generated from checkable SEO, conversion, accessibility, and trust signals.
        </p>
        {sourceUrl ? (
          <a href={sourceUrl} className="source-link">
            Source checked: {sourceUrl}
          </a>
        ) : (
          <p className="muted">No source URL was attached to this draft; add one to produce a current-site score.</p>
        )}
      </div>

      <div className="score-compare">
        <ScoreCard label="Current-site report" evaluation={sourceEvaluation} emptyLabel="Not scored" />
        <QaCard readiness={readiness} />
      </div>

      <div className="preview-issue-grid">
        <div className="preview-issue-list">
          <h2>What we found</h2>
          {failedChecks.length ? (
            failedChecks.map((check) => (
              <article key={check.criterionId} className="preview-issue-card">
                <span className={`badge severity-${check.severity}`}>{check.severity}</span>
                <h3>{check.title}</h3>
                <p>{check.businessConsequence}</p>
                <small>{check.evidence}</small>
              </article>
            ))
          ) : (
            <article className="preview-issue-card">
              <span className="badge">ready</span>
              <h3>No failed current-site checks are attached yet</h3>
              <p>URL import, crawl scoring, and presence notes will populate this section for outbound previews.</p>
            </article>
          )}
        </div>

        <div className="preview-issue-list">
          <h2>Verified source evidence</h2>
          {evidence?.items.length ? (
            evidence.items.slice(0, 4).map((item) => (
              <article key={item.id} className="preview-issue-card">
                <span className="badge severity-pass">{item.kind.replaceAll("_", " ")}</span>
                <h3>{item.publicText ?? item.sourceExcerpt}</h3>
                <small>{item.source.url}</small>
              </article>
            ))
          ) : (
            <article className="preview-issue-card">
              <span className="badge">source sparse</span>
              <h3>No verified proof was retained from the source</h3>
              <p>The draft avoids unsupported reviews, credentials, warranties, and offers.</p>
            </article>
          )}
        </div>
      </div>

      {presenceNotes.length ? (
        <div className="presence-note-strip">
          {presenceNotes.map((note) => (
            <span key={note}>{note}</span>
          ))}
        </div>
      ) : null}

      {bundle.presenceAssessment.brandAssessment ? (
        <div className="preview-issue-grid">
          <div className="preview-issue-list">
            <h2>Brand assessment</h2>
            {bundle.presenceAssessment.brandAssessment ? (
              <article className="preview-issue-card">
                <span className="badge">
                  {Math.round(bundle.presenceAssessment.brandAssessment.confidence * 100)}% confidence
                </span>
                <h3>Design-system expression cues</h3>
                <p>{bundle.presenceAssessment.brandAssessment.cues.slice(0, 5).join(" · ")}</p>
                <small>{bundle.presenceAssessment.brandAssessment.preservationRules[0]}</small>
              </article>
            ) : null}
          </div>

        </div>
      ) : null}

    </section>
  );
}

function QaCard({ readiness }: { readiness: "ready" | "blocked" | "pending" | "unavailable" }) {
  return (
    <article className="score-card">
      <span>Generated-draft QA</span>
      <strong>{readinessLabel(readiness)}</strong>
      <small>Canonical objective gate</small>
    </article>
  );
}

function ScoreCard({
  label,
  evaluation,
  emptyLabel = "Not available"
}: {
  label: string;
  evaluation?: StandardEvaluation;
  emptyLabel?: string;
}) {
  const grade = evaluation?.score.grade.replace("_", " ") ?? emptyLabel;
  return (
    <article className="score-card">
      <span>{label}</span>
      <strong>{evaluation ? `${evaluation.score.percent}/100` : "--"}</strong>
      <small>{grade}</small>
    </article>
  );
}

function topFailedChecks(checks: StandardCheckResult[]) {
  return checks
    .filter((check) => !check.passed)
    .sort((left, right) => severityRank(right.severity) - severityRank(left.severity))
    .slice(0, 5);
}

function severityRank(severity: StandardCheckResult["severity"]) {
  if (severity === "fail") return 3;
  if (severity === "warning") return 2;
  return 1;
}

function readinessLabel(readiness: "ready" | "blocked" | "pending" | "unavailable") {
  if (readiness === "ready") return "Ready";
  if (readiness === "blocked") return "Revise";
  if (readiness === "pending") return "Running";
  return "Unavailable";
}
