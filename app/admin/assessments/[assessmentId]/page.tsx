import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireAdminPageAccess } from "@/lib/page-access";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AssessmentAutoRefresh } from "@/components/admin/AssessmentAutoRefresh";
import { platformOperationsRepository } from "@/packages/platform-operations";
import type {
  AssessmentCriterion,
  WebsiteAssessment
} from "@/packages/website-assessment/contracts";
import { formatProductDate, statusTone } from "@/lib/product-format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AssessmentPage({
  params
}: {
  params: Promise<{ assessmentId: string }>;
}) {
  const { assessmentId } = await params;
  await requireAdminPageAccess(`/admin/assessments/${assessmentId}`);
  const record = await platformOperationsRepository.getWebsiteAssessment(assessmentId);
  if (!record) notFound();
  const assessment = record.assessment;
  const staleSchema = record.status === "completed" && !assessment;
  return (
    <main className="admin-page">
      <AssessmentAutoRefresh active={record.status === "queued" || record.status === "running"} />
      <AdminPageHeader
        eyebrow="Website Health Report"
        title={assessment?.siteUnderstanding.businessName ?? record.sourceUrl ?? record.artifactId ?? record.id}
        description={`Target: ${record.targetKind.replaceAll("_", " ")} · Created ${formatProductDate(record.createdAt)}`}
        actions={<Link className="button secondary" href="/admin/assessments">All reports</Link>}
      />
      {!assessment ? (
        <section className="panel">
          <span className={`badge is-${statusTone(record.status)}`}>{record.status}</span>
          <h2>{staleSchema ? "Stale schema — rebuild required" : record.status === "failed" ? "Assessment failed" : "Evidence collection is in progress"}</h2>
          <p>{record.errorCode ?? (staleSchema ? "This retained legacy assessment remains immutable and is not parsed by the current application reader." : "The canonical evidence pipeline is running.")}</p>
        </section>
      ) : <AssessmentInspector assessment={assessment} />}
    </main>
  );
}

function AssessmentInspector({ assessment }: { assessment: WebsiteAssessment }) {
  const criteria = assessment.dimensions.flatMap((dimension) => dimension.criteria);
  const screenshots = unique(criteria.flatMap((criterion) =>
    criterion.evidence.flatMap((item) => item.artifactKey ? [item.artifactKey] : [])
  ));
  return (
    <>
      <section className="metric-row">
        <Metric label="Measured Website Health" value={assessment.grade ? `${assessment.grade.value}${assessment.grade.band ? ` · ${assessment.grade.band}` : ` · band ${assessment.grade.bandStatus.replaceAll("_", " ")}`}` : "Not scoreable"} />
        <Metric label="Uncapped raw score" value={assessment.score.rawValue === undefined ? "—" : `${assessment.score.rawValue}`} />
        <Metric label="Measured author-controlled health" value={assessment.score.scopes.siteAuthor.value === undefined ? "—" : `${assessment.score.scopes.siteAuthor.value}`} />
        <Metric label="Active weight" value={`${assessment.score.activeWeight}/100${assessment.score.renormalized ? " · renormalized" : ""}`} />
        <Metric label="Site evidence" value={`${Math.round(assessment.coverage.siteEvidence * 100)}%`} />
        <Metric label="Pipeline completeness" value={`${Math.round(assessment.coverage.pipelineCompleteness * 100)}%`} />
        <Metric label="Formal comparison" value={assessment.coverage.comparisonEligible ? "Eligible" : "Disabled"} />
        <Metric label="Release" value={`${assessment.release.status}${assessment.release.blockers.length ? ` · ${assessment.release.blockers.length} blockers` : ""}`} />
      </section>

      <section className="panel">
        <div className="admin-grid">
          <div>
            <span className="badge">{assessment.siteUnderstanding.vertical.replaceAll("_", " ")} · {Math.round(assessment.siteUnderstanding.verticalConfidence * 100)}% confidence</span>
            <h2>Site understanding</h2>
            <p>{assessment.siteUnderstanding.primaryLocation ?? "No primary location confidently detected."}</p>
            <p className="muted">{assessment.siteUnderstanding.services.join(" · ") || "No services confidently extracted."}</p>
          </div>
          <div>
            <h2>Semantic route sample</h2>
            <ul>{assessment.routeSelection.selected.map((item) => (
              <li key={item.slot}><strong>{item.slot.replaceAll("_", " ")}</strong>: {item.route ?? "missing requested slot"}</li>
            ))}</ul>
          </div>
        </div>
        <p className="muted">
          Registry {assessment.producer.rubricIdentity} · Scanner {assessment.producer.scannerIdentity} · Route policy {assessment.producer.routeSelectionIdentity} · Serving {assessment.servingContract.kind} · Reference {assessment.referenceAuthority.kind} · Input {assessment.producer.inputHash}
        </p>
      </section>

      {assessment.grade?.appliedCaps.length ? (
        <section className="panel">
          <h2>Applied grade caps</h2>
          <ul>{assessment.grade.appliedCaps.map((cap) => <li key={cap.id}><strong>Maximum {cap.maximum}</strong> · {cap.explanation}</li>)}</ul>
        </section>
      ) : null}

      {assessment.coverage.limitations.length ? (
        <section className="panel">
          <h2>Evidence and comparison limitations</h2>
          <ul>{assessment.coverage.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
        </section>
      ) : null}

      <section className="metric-row">
        {assessment.dimensions.map((dimension) => (
          <Metric
            key={dimension.id}
            label={`${dimension.label} · ${dimension.state.replaceAll("_", " ")} · ${Math.round(dimension.coverage.siteEvidence * 100)}% site evidence`}
            value={dimension.score === undefined ? "—" : `${dimension.score}`}
          />
        ))}
      </section>

      {assessment.dimensions.map((dimension) => (
        <section className="panel admin-section" key={dimension.id}>
          <div className="admin-section-heading">
            <div>
              <h2>{dimension.label}</h2>
              <p className="muted">
                Weight {dimension.weight}% · {dimension.state.replaceAll("_", " ")} · {dimension.assessedCriteria}/{dimension.applicableCriteria} score-eligible criteria assessed · cap {dimension.capEligible ? "eligible" : "ineligible"}
              </p>
            </div>
          </div>
          <table className="data-table">
            <thead><tr><th>Status</th><th>Criterion and owner</th><th>Reason and consequence</th><th>Evidence</th></tr></thead>
            <tbody>{dimension.criteria.map((criterion) => (
              <CriterionRow criterion={criterion} assessmentId={assessment.id} key={criterion.id} />
            ))}</tbody>
          </table>
        </section>
      ))}

      <section className="panel">
        <h2>Evaluators</h2>
        <ul>{assessment.evaluators.map((evaluator) => (
          <li key={`${evaluator.kind}:${evaluator.identity}`}>
            <strong>{evaluator.kind}</strong> · {evaluator.status} · {evaluator.identity}
            {evaluator.modelId ? ` · ${evaluator.modelId}` : ""}
            {evaluator.evidenceSetHash ? ` · evidence ${evaluator.evidenceSetHash}` : ""}
          </li>
        ))}</ul>
      </section>

      {screenshots.length ? (
        <section className="panel">
          <h2>Retained visual evidence</h2>
          <div className="assessment-screenshot-grid">
            {screenshots.map((key) => (
              <figure key={key}>
                <img src={`/api/admin/website-assessments/${assessment.id}/evidence?key=${encodeURIComponent(key)}`} alt="Captured Website Health evidence" />
                <figcaption>{key}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function CriterionRow({
  criterion,
  assessmentId
}: {
  criterion: AssessmentCriterion;
  assessmentId: string;
}) {
  return (
    <tr>
      <td>
        <span className={`badge severity-${severityTone(criterion.status)}`}>{criterion.status.replaceAll("_", " ")}</span>
        <small>
          {criterion.impact} · {criterion.certainty}
          {criterion.confidence === undefined ? "" : ` · ${Math.round(criterion.confidence * 100)}% confidence`}
          {criterion.unknownReason ? ` · ${criterion.unknownReason.replaceAll("_", " ")}` : ""}
        </small>
      </td>
      <td>
        <strong>{criterion.title}</strong>
        <small>{criterion.id}</small>
        <small>{criterion.controlOwner.replaceAll("_", " ")} · {criterion.evaluatorType} · {criterion.scoreEligible ? `${criterion.pointsPossible} points` : "unscored"} · {criterion.releaseDisposition}</small>
      </td>
      <td>
        {criterion.explanation}
        <small>{criterion.businessConsequence}</small>
        <small><strong>Recommendation:</strong> {criterion.recommendation}</small>
      </td>
      <td>{criterion.evidence.map((item) => (
        <small key={item.id}>
          {item.summary}
          {item.route ? ` · ${item.route}` : ""}
          {item.viewport ? ` · ${item.viewport}` : ""}
          {item.frame ? ` · ${item.frame}` : ""}
          {item.contentHash ? ` · ${item.contentHash}` : ""}
          {item.artifactKey ? <> · <a href={`/api/admin/website-assessments/${assessmentId}/evidence?key=${encodeURIComponent(item.artifactKey)}`}>open evidence</a></> : null}
        </small>
      ))}</td>
    </tr>
  );
}

function severityTone(status: AssessmentCriterion["status"]) {
  return {
    pass: "pass",
    warning: "warning",
    fail: "critical",
    unknown: "advisory",
    not_applicable: "advisory"
  }[status];
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric-card"><strong>{value}</strong><span>{label}</span></div>;
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}
