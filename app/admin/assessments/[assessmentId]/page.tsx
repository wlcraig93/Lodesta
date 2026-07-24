import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireAdminPageAccess } from "@/lib/page-access";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AssessmentAutoRefresh } from "@/components/admin/AssessmentAutoRefresh";
import { platformOperationsRepository } from "@/packages/platform-operations";
import type { AssessmentCriterion, WebsiteAssessment } from "@/packages/website-assessment/contracts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AssessmentPage({ params }: { params: Promise<{ assessmentId: string }> }) {
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
        eyebrow="Website assessment"
        title={assessment?.siteUnderstanding.businessName ?? record.sourceUrl ?? record.artifactId ?? record.id}
        description={`Target: ${record.targetKind.replaceAll("_", " ")} · Created ${new Date(record.createdAt).toLocaleString()}`}
        actions={<Link className="button secondary" href="/admin/assessments">All assessments</Link>}
      />
      {!assessment ? (
        <section className="panel">
          <span className={`badge status-${record.status}`}>{record.status}</span>
          <h2>{staleSchema ? "Stale assessment schema — rebuild required" : record.status === "failed" ? "Assessment failed" : "Evidence collection is in progress"}</h2>
          <p>{record.errorCode ?? (staleSchema ? "This retained assessment cannot be inspected with the current contract." : "The bounded crawl, destination probes, render inspection, and automated checks are running.")}</p>
        </section>
      ) : <AssessmentInspector assessment={assessment} />}
    </main>
  );
}

function AssessmentInspector({ assessment }: { assessment: WebsiteAssessment }) {
  const screenshots = unique(assessment.dimensions.flatMap((dimension) => dimension.criteria)
    .flatMap((criterion) => criterion.evidence.map((item) => item.artifactKey).filter((key): key is string => Boolean(key))));
  return (
    <>
      <section className="metric-row">
        <Metric label="Coverage" value={`${Math.round(assessment.coverage.value * 100)}%`} />
        <Metric label="Assessed criteria" value={`${assessment.coverage.assessedCriteria}/${assessment.coverage.applicableCriteria}`} />
        <Metric label="Provisional score" value={assessment.score ? `${assessment.score.value}` : "—"} />
        <Metric label="Internal verdict" value={assessment.score?.verdict ?? "insufficient coverage"} />
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
            <h2>Customer journeys</h2>
            <p>{assessment.siteUnderstanding.customerJourneys.join(" · ") || "No journey confidently detected."}</p>
          </div>
        </div>
        <p className="muted">Rubric {assessment.producer.rubricIdentity} · Scanner {assessment.producer.scannerIdentity} · Input {assessment.producer.inputHash}</p>
      </section>
      <section className="panel">
        <h2>Coverage limitations</h2>
        <ul>{assessment.coverage.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}</ul>
      </section>
      <section className="metric-row">
        {assessment.dimensions.map((dimension) => (
          <Metric
            key={dimension.id}
            label={`${dimension.label} · ${Math.round(dimension.coverage * 100)}% covered`}
            value={dimension.score === undefined ? "—" : `${dimension.score}`}
          />
        ))}
      </section>
      {assessment.dimensions.map((dimension) => (
        <section className="panel admin-section" key={dimension.id}>
          <div className="admin-section-heading">
            <div><h2>{dimension.label}</h2><p className="muted">Weight {dimension.weight}% · {dimension.assessedCriteria}/{dimension.applicableCriteria} applicable criteria assessed</p></div>
          </div>
          <table className="data-table">
            <thead><tr><th>Status</th><th>Criterion</th><th>Reason and consequence</th><th>Evidence</th></tr></thead>
            <tbody>{dimension.criteria.map((criterion) => <CriterionRow criterion={criterion} assessmentId={assessment.id} key={criterion.id} />)}</tbody>
          </table>
        </section>
      ))}
      {screenshots.length ? (
        <section className="panel">
          <h2>Retained visual evidence</h2>
          <div className="assessment-screenshot-grid">
            {screenshots.map((key) => (
              <figure key={key}>
                <img src={`/api/admin/website-assessments/${assessment.id}/evidence?key=${encodeURIComponent(key)}`} alt="Captured website assessment evidence" />
                <figcaption>{key}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      ) : null}
    </>
  );
}

function CriterionRow({ criterion, assessmentId }: { criterion: AssessmentCriterion; assessmentId: string }) {
  return (
    <tr>
      <td><span className={`badge severity-${statusTone(criterion.status)}`}>{criterion.status.replaceAll("_", " ")}</span><small>{criterion.impact} · {criterion.certainty}{criterion.confidence === undefined ? "" : ` · ${Math.round(criterion.confidence * 100)}% confidence`}</small></td>
      <td><strong>{criterion.title}</strong><small>{criterion.id} · {criterion.applicability}</small></td>
      <td>{criterion.explanation}<small>{criterion.businessConsequence}</small><small><strong>Recommendation:</strong> {criterion.recommendation}</small></td>
      <td>{criterion.evidence.map((item) => (
        <small key={item.id}>
          {item.summary}
          {item.artifactKey ? <> · <a href={`/api/admin/website-assessments/${assessmentId}/evidence?key=${encodeURIComponent(item.artifactKey)}`}>open evidence</a></> : null}
        </small>
      ))}</td>
    </tr>
  );
}

function statusTone(status: AssessmentCriterion["status"]) {
  if (status === "fail") return "critical";
  if (status === "warning") return "major";
  if (status === "pass") return "pass";
  return "advisory";
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric-card"><strong>{value}</strong><span>{label}</span></div>;
}

function unique(values: string[]) {
  return [...new Set(values)];
}
