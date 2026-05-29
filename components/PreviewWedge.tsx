import type { SiteBundle, StandardCheckResult, StandardEvaluation } from "@/lib/models";

type PreviewWedgeProps = {
  bundle: SiteBundle;
  replacementEvaluation: StandardEvaluation;
};

export function PreviewWedge({ bundle, replacementEvaluation }: PreviewWedgeProps) {
  const sourceEvaluation = bundle.presenceAssessment.standardEvaluation;
  const failedChecks = topFailedChecks(sourceEvaluation?.checks ?? []);
  const sourceUrl = bundle.presenceAssessment.sourceUrl ?? sourceEvaluation?.sourceUrl;
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
          score is generated from checkable SEO, conversion, accessibility, and trust signals.
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
        <ScoreCard label="Current site" evaluation={sourceEvaluation} emptyLabel="Not scored" />
        <ScoreCard label="Generated draft" evaluation={replacementEvaluation} />
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
          <h2>What this draft improves</h2>
          {replacementEvaluation.checks
            .filter((check) => check.passed)
            .slice(0, 4)
            .map((check) => (
              <article key={check.criterionId} className="preview-issue-card">
                <span className="badge severity-pass">pass</span>
                <h3>{check.title}</h3>
                <p>{check.businessConsequence}</p>
                <small>{check.evidence}</small>
              </article>
            ))}
        </div>
      </div>

      {presenceNotes.length ? (
        <div className="presence-note-strip">
          {presenceNotes.map((note) => (
            <span key={note}>{note}</span>
          ))}
        </div>
      ) : null}

      {bundle.presenceAssessment.creativeBrief ? (
        <div className="creative-brief-strip">
          <div>
            <span className="badge">Creative plan</span>
            <h2>{bundle.presenceAssessment.creativeBrief.designIntent}</h2>
            <p>{bundle.presenceAssessment.creativeBrief.mockupPrompt}</p>
          </div>
          <ul>
            {bundle.presenceAssessment.creativeBrief.visualInspectionChecklist.slice(0, 4).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
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
