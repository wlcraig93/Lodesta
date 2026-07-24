import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireAdminPageAccess } from "@/lib/page-access";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AssessmentAutoRefresh } from "@/components/admin/AssessmentAutoRefresh";
import { platformOperationsRepository } from "@/packages/platform-operations";
import type {
  AgentReadinessCheck,
  AssessmentCriterion,
  VisualQualityCheck,
  WebsiteAssessment
} from "@/packages/website-assessment/contracts";
import { formatProductDate, statusTone } from "@/lib/product-format";

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
        description={`Target: ${record.targetKind.replaceAll("_", " ")} · Created ${formatProductDate(record.createdAt)}`}
        actions={<Link className="button secondary" href="/admin/assessments">All assessments</Link>}
      />
      {!assessment ? (
        <section className="panel">
          <span className={`badge is-${statusTone(record.status)}`}>{record.status}</span>
          <h2>{staleSchema ? "Stale assessment schema — rebuild required" : record.status === "failed" ? "Assessment failed" : "Evidence collection is in progress"}</h2>
          <p>{record.errorCode ?? (staleSchema ? "This retained assessment cannot be inspected with the current contract." : "The bounded crawl, destination probes, render inspection, and automated checks are running.")}</p>
        </section>
      ) : <AssessmentInspector assessment={assessment} />}
    </main>
  );
}

function AssessmentInspector({ assessment }: { assessment: WebsiteAssessment }) {
  const screenshots = unique([
    ...assessment.dimensions.flatMap((dimension) => dimension.criteria),
    ...assessment.visualQuality.groups.flatMap((group) => group.checks)
  ].flatMap((evidenceGroup) => evidenceGroup.evidence
    .map((item) => item.artifactKey)
    .filter((key): key is string => Boolean(key))));
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
        <p className="muted">Rubric identity {assessment.producer.rubricIdentity} · Agent methodology identity {assessment.agentReadiness.methodologyIdentity} · Scanner identity {assessment.producer.scannerIdentity} · Input {assessment.producer.inputHash}</p>
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
      <section className="metric-row">
        <Metric label="Agent coverage" value={`${Math.round(assessment.agentReadiness.coverage.value * 100)}%`} />
        <Metric label="Verified checks" value={`${assessment.agentReadiness.counts.verified}`} />
        <Metric label="Opportunities" value={`${assessment.agentReadiness.counts.opportunities}`} />
        <Metric label="Unknown / not applicable" value={`${assessment.agentReadiness.counts.unknown} / ${assessment.agentReadiness.counts.notApplicable}`} />
      </section>
      <section className="panel admin-section">
        <div className="admin-section-heading">
          <div>
            <span className="badge">Unweighted evidence section</span>
            <h2>Agent Readiness</h2>
            <p className="muted">
              {assessment.agentReadiness.coverage.assessedChecks}/{assessment.agentReadiness.coverage.applicableChecks} applicable checks assessed. Raw standards are separated from local-business applicability and do not affect the website score.
            </p>
          </div>
        </div>
        {assessment.agentReadiness.coverage.limitations.length ? (
          <p className="muted">Limitations: {assessment.agentReadiness.coverage.limitations.join(" · ")}</p>
        ) : null}
      </section>
      {assessment.agentReadiness.groups.map((group) => (
        <section className="panel admin-section" key={group.id}>
          <div className="admin-section-heading">
            <div>
              <h2>{group.label}</h2>
              <p className="muted">
                {group.verifiedChecks} verified · {group.opportunityChecks} opportunities · {group.unknownChecks} unknown · {group.notApplicableChecks} not applicable
              </p>
            </div>
          </div>
          <table className="data-table">
            <thead><tr><th>Status</th><th>Check and standard</th><th>Observed alignment</th><th>Evidence</th></tr></thead>
            <tbody>{group.checks.map((check) => <AgentReadinessRow check={check} assessmentId={assessment.id} key={check.id} />)}</tbody>
          </table>
        </section>
      ))}
      <section className="metric-row">
        <Metric label="Visual coverage" value={`${Math.round(assessment.visualQuality.coverage.value * 100)}%`} />
        <Metric label="Visual strengths" value={`${assessment.visualQuality.counts.verified}`} />
        <Metric label="Visual opportunities" value={`${assessment.visualQuality.counts.opportunities}`} />
        <Metric label="Unknown / not applicable" value={`${assessment.visualQuality.counts.unknown} / ${assessment.visualQuality.counts.notApplicable}`} />
      </section>
      <section className="panel admin-section">
        <div className="admin-section-heading">
          <div>
            <span className="badge">Advisory · unweighted</span>
            <h2>Visual Quality</h2>
            <p className="muted">
              {assessment.visualQuality.coverage.assessedChecks}/{assessment.visualQuality.coverage.applicableChecks} applicable checks assessed from retained screenshots. These findings do not change the objective website score or release gate.
            </p>
          </div>
        </div>
        <p className="muted">
          Evaluator {assessment.visualQuality.evaluator.status} · {assessment.visualQuality.evaluator.provider}/{assessment.visualQuality.evaluator.modelId} · {assessment.visualQuality.evaluator.durationMs} ms · estimated ${assessment.visualQuality.evaluator.estimatedCostUsd.toFixed(4)}
        </p>
        <p className="muted">
          Methodology {assessment.visualQuality.methodologyIdentity} · Evaluator {assessment.visualQuality.evaluator.identity} · Prompt {assessment.visualQuality.evaluator.promptIdentity} · Screenshots {assessment.visualQuality.evaluator.screenshotSetHash}
        </p>
        {assessment.visualQuality.coverage.limitations.length ? (
          <p className="muted">Limitations: {assessment.visualQuality.coverage.limitations.join(" · ")}</p>
        ) : null}
      </section>
      {assessment.visualQuality.groups.map((group) => (
        <section className="panel admin-section" key={group.id}>
          <div className="admin-section-heading">
            <div>
              <h2>{group.label}</h2>
              <p className="muted">
                {group.verifiedChecks} verified · {group.opportunityChecks} opportunities · {group.unknownChecks} unknown · {group.notApplicableChecks} not applicable
              </p>
            </div>
          </div>
          <table className="data-table">
            <thead><tr><th>Status</th><th>Visual check</th><th>Observed result</th><th>Screenshot evidence</th></tr></thead>
            <tbody>{group.checks.map((check) => <VisualQualityRow check={check} assessmentId={assessment.id} key={check.id} />)}</tbody>
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

function AgentReadinessRow({ check, assessmentId }: { check: AgentReadinessCheck; assessmentId: string }) {
  return (
    <tr>
      <td>
        <span className={`badge severity-${severityTone(check.status)}`}>{check.status.replaceAll("_", " ")}</span>
        <small>{check.impact} · {check.certainty}{check.confidence === undefined ? "" : ` · ${Math.round(check.confidence * 100)}% confidence`}</small>
      </td>
      <td>
        <strong>{check.title}</strong>
        <small>{check.id} · {check.applicability}</small>
        <small>
          <a href={check.standard.referenceUrl} target="_blank" rel="noreferrer">{check.standard.authority}</a>
          {" · "}{check.standard.countedByAuthority ? "counted by published methodology" : "emerging / unscored"}
        </small>
      </td>
      <td>
        {check.alignment.replaceAll("_", " ")}
        <small>{check.explanation}</small>
        <small><strong>Recommendation:</strong> {check.recommendation}</small>
      </td>
      <td>{check.evidence.map((item) => (
        <small key={item.id}>
          {item.summary}
          {item.artifactKey ? <> · <a href={`/api/admin/website-assessments/${assessmentId}/evidence?key=${encodeURIComponent(item.artifactKey)}`}>open evidence</a></> : null}
        </small>
      ))}</td>
    </tr>
  );
}

function VisualQualityRow({ check, assessmentId }: { check: VisualQualityCheck; assessmentId: string }) {
  return (
    <tr>
      <td>
        <span className={`badge severity-${severityTone(check.status)}`}>{check.status.replaceAll("_", " ")}</span>
        <small>{check.impact} · model inferred{check.confidence === undefined ? "" : ` · ${Math.round(check.confidence * 100)}% confidence`}</small>
      </td>
      <td>
        <strong>{check.title}</strong>
        <small>{check.id} · {check.applicability}</small>
      </td>
      <td>
        {check.explanation}
        <small>{check.businessConsequence}</small>
        <small><strong>Recommendation:</strong> {check.recommendation}</small>
      </td>
      <td>
        <div className="assessment-screenshot-grid">
          {check.evidence.map((item) => item.artifactKey ? (
            <figure key={item.id}>
              <a
                href={`/api/admin/website-assessments/${assessmentId}/evidence?key=${encodeURIComponent(item.artifactKey)}`}
                target="_blank"
                rel="noreferrer"
              >
                <img
                  src={`/api/admin/website-assessments/${assessmentId}/evidence?key=${encodeURIComponent(item.artifactKey)}`}
                  alt={`${item.route ?? "Captured route"} at ${item.viewport ?? "the cited viewport"}`}
                />
              </a>
              <figcaption>{item.summary}</figcaption>
            </figure>
          ) : <small key={item.id}>{item.summary}</small>)}
        </div>
      </td>
    </tr>
  );
}

function CriterionRow({ criterion, assessmentId }: { criterion: AssessmentCriterion; assessmentId: string }) {
  return (
    <tr>
      <td><span className={`badge severity-${severityTone(criterion.status)}`}>{criterion.status.replaceAll("_", " ")}</span><small>{criterion.impact} · {criterion.certainty}{criterion.confidence === undefined ? "" : ` · ${Math.round(criterion.confidence * 100)}% confidence`}</small></td>
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

function severityTone(status: AssessmentCriterion["status"] | AgentReadinessCheck["status"] | VisualQualityCheck["status"]) {
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
