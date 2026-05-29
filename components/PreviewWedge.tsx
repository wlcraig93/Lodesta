import type { SiteBundle, StandardCheckResult, StandardEvaluation } from "@/lib/models";
import { coldUrlCheckableChecks } from "@/lib/standard-evaluation";

type PreviewWedgeProps = {
  bundle: SiteBundle;
  replacementEvaluation: StandardEvaluation;
};

export function PreviewWedge({ bundle, replacementEvaluation }: PreviewWedgeProps) {
  const sourceEvaluation = bundle.presenceAssessment.standardEvaluation;
  const failedChecks = topFailedChecks(coldUrlCheckableChecks(sourceEvaluation?.checks ?? []));
  const sourceUrl = bundle.presenceAssessment.sourceUrl ?? sourceEvaluation?.sourceUrl;
  const selectedDirection = bundle.presenceAssessment.designDirections?.find((direction) => direction.selected);
  const mockupArtifacts = bundle.presenceAssessment.mockupArtifacts ?? [];
  const visualQa = bundle.presenceAssessment.visualQa;
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

      {bundle.presenceAssessment.designDirections?.length ? (
        <div className="preview-issue-grid">
          <div className="preview-issue-list">
            <h2>Design directions</h2>
            {bundle.presenceAssessment.designDirections.map((direction) => (
              <article key={direction.id} className="preview-issue-card">
                <span className="badge">{direction.selected ? "selected" : direction.strategy.replace("_", " ")}</span>
                <h3>{direction.label}</h3>
                <p>{direction.rationale}</p>
                <small>
                  {direction.themePreset} theme · {direction.sectionEmphasis.slice(0, 4).join(", ")}
                </small>
              </article>
            ))}
          </div>

          <div className="preview-issue-list">
            <h2>Brand assessment</h2>
            {bundle.presenceAssessment.brandAssessment ? (
              <article className="preview-issue-card">
                <span className="badge">
                  {Math.round(bundle.presenceAssessment.brandAssessment.confidence * 100)}% confidence
                </span>
                <h3>{selectedDirection?.label ?? "Selected direction"}</h3>
                <p>{bundle.presenceAssessment.brandAssessment.cues.slice(0, 5).join(" · ")}</p>
                <small>{bundle.presenceAssessment.brandAssessment.preservationRules[0]}</small>
              </article>
            ) : null}
            {bundle.presenceAssessment.qualityScore ? (
              <article className="preview-issue-card">
                <span className="badge">quality score</span>
                <h3>{bundle.presenceAssessment.qualityScore.summary}</h3>
                <p>
                  {bundle.presenceAssessment.qualityScore.measuredCriteria} cold-URL checks ·{" "}
                  {bundle.presenceAssessment.qualityScore.generatedCriteria} generated checks
                </p>
              </article>
            ) : null}
            {visualQa ? (
              <article className="preview-issue-card">
                <span className="badge">{visualQa.source === "openai" ? "visual QA" : "visual QA fallback"}</span>
                <h3>{visualQa.summary}</h3>
                <p>
                  {visualQa.findings.filter((finding) => finding.severity === "fail").length} failures ·{" "}
                  {visualQa.findings.filter((finding) => finding.severity === "warning").length} warnings ·{" "}
                  {visualQa.screenshotCount} screenshots
                </p>
                <small>{visualQa.findings[0]?.title}</small>
              </article>
            ) : null}
          </div>
        </div>
      ) : null}

      {mockupArtifacts.length ? (
        <div className="mockup-artifact-strip">
          <div className="mockup-artifact-header">
            <div>
              <span className="badge">Planning mockups</span>
              <h2>Generated visuals stay separate from the live renderer.</h2>
            </div>
            <small>
              {bundle.presenceAssessment.assetInventory?.filter((asset) => asset.rightsStatus === "reference_only")
                .length ?? 0}{" "}
              reference-only assets tracked
            </small>
          </div>
          <div className="mockup-artifact-grid">
            {mockupArtifacts.map((mockup) => (
              <article key={mockup.id} className="mockup-artifact-card">
                {mockup.image?.url ? (
                  <img src={mockup.image.url} alt={mockup.image.alt} />
                ) : (
                  <div className="mockup-artifact-placeholder">
                    <span>{mockup.status.replace("_", " ")}</span>
                  </div>
                )}
                <div>
                  <span className="badge">{mockup.strategy.replace("_", " ")}</span>
                  <h3>{mockup.status === "generated" ? "Image artifact ready" : "Prompt artifact ready"}</h3>
                  <p>{(mockup.revisedPrompt ?? mockup.prompt).slice(0, 220)}</p>
                  <small>
                    {mockup.model ?? "mockup provider"} · {mockup.image?.rightsStatus ?? "preclaim_safe"} · planning
                    only
                  </small>
                </div>
              </article>
            ))}
          </div>
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
