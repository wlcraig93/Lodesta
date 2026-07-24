import Link from "next/link";
import type { Metadata } from "next";
import { requireAdminPageAccess } from "@/lib/page-access";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { platformOperationsRepository } from "@/packages/platform-operations";
import type { AssessmentCriterion, WebsiteAssessment } from "@/packages/website-assessment/contracts";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AssessmentComparisonPage({
  searchParams
}: {
  searchParams: Promise<{ left?: string; right?: string }>;
}) {
  await requireAdminPageAccess("/admin/assessments/compare");
  const { left: leftId, right: rightId } = await searchParams;
  const [leftRecord, rightRecord] = await Promise.all([
    leftId ? platformOperationsRepository.getWebsiteAssessment(leftId) : null,
    rightId ? platformOperationsRepository.getWebsiteAssessment(rightId) : null
  ]);
  const left = leftRecord?.assessment;
  const right = rightRecord?.assessment;
  return (
    <main className="admin-page">
      <AdminPageHeader
        eyebrow="Matched evidence"
        title="Assessment comparison"
        description="Compare the same criterion IDs only when both records use the same rubric version."
        actions={<Link className="button secondary" href="/admin/assessments">All assessments</Link>}
      />
      <section className="panel">
        <form action="/admin/assessments/compare" className="admin-filter-form">
          <input name="left" placeholder="Current/source assessment ID" defaultValue={leftId} required />
          <input name="right" placeholder="Candidate assessment ID" defaultValue={rightId} required />
          <button className="button primary" type="submit">Compare</button>
        </form>
      </section>
      {!leftId || !rightId ? <section className="panel"><p>Choose two completed assessment IDs.</p></section> : null}
      {leftId && !left ? <section className="panel"><p className="error-text">The left assessment is missing, incomplete, or stale.</p></section> : null}
      {rightId && !right ? <section className="panel"><p className="error-text">The right assessment is missing, incomplete, or stale.</p></section> : null}
      {left && right && left.producer.rubricIdentity !== right.producer.rubricIdentity ? (
        <section className="panel">
          <span className="badge severity-warning">Comparison blocked</span>
          <h2>Reassess before comparing</h2>
          <p>{left.producer.rubricIdentity} and {right.producer.rubricIdentity} identify different rubrics. A numeric or status delta would be misleading.</p>
        </section>
      ) : null}
      {left && right && left.producer.rubricIdentity === right.producer.rubricIdentity ? <Comparison left={left} right={right} /> : null}
    </main>
  );
}

function Comparison({ left, right }: { left: WebsiteAssessment; right: WebsiteAssessment }) {
  const leftCriteria = new Map(left.dimensions.flatMap((dimension) => dimension.criteria).map((criterion) => [criterion.id, criterion]));
  const rightCriteria = new Map(right.dimensions.flatMap((dimension) => dimension.criteria).map((criterion) => [criterion.id, criterion]));
  const ids = [...new Set([...leftCriteria.keys(), ...rightCriteria.keys()])];
  const improved = ids.filter((id) => comparableChange(leftCriteria.get(id), rightCriteria.get(id)) === 1).length;
  const regressed = ids.filter((id) => comparableChange(leftCriteria.get(id), rightCriteria.get(id)) === -1).length;
  return (
    <>
      <section className="metric-row">
        <Metric label="Improved criteria" value={`${improved}`} />
        <Metric label="Regressed criteria" value={`${regressed}`} />
        <Metric label="Left coverage" value={`${Math.round(left.coverage.value * 100)}%`} />
        <Metric label="Right coverage" value={`${Math.round(right.coverage.value * 100)}%`} />
      </section>
      <section className="panel">
        <h2>Comparison basis</h2>
        <p>Rubric {left.producer.rubricIdentity}. Left score {left.score?.value ?? "—"}; right score {right.score?.value ?? "—"}. Scores remain provisional and internal.</p>
        <p className="muted">Left limitations: {left.coverage.limitations.join(" · ") || "none"}<br />Right limitations: {right.coverage.limitations.join(" · ") || "none"}</p>
      </section>
      <section className="panel admin-section">
        <table className="data-table">
          <thead><tr><th>Criterion</th><th>Current/source</th><th>Candidate</th><th>Change</th></tr></thead>
          <tbody>{ids.map((id) => {
            const leftCriterion = leftCriteria.get(id);
            const rightCriterion = rightCriteria.get(id);
            const change = comparableChange(leftCriterion, rightCriterion);
            return (
              <tr key={id}>
                <td><strong>{leftCriterion?.title ?? rightCriterion?.title ?? id}</strong><small>{id}</small></td>
                <CriterionCell criterion={leftCriterion} />
                <CriterionCell criterion={rightCriterion} />
                <td><span className={`badge ${change === 1 ? "severity-pass" : change === -1 ? "severity-critical" : "severity-advisory"}`}>{change === 1 ? "improved" : change === -1 ? "regressed" : change === 0 ? "unchanged" : "not comparable"}</span></td>
              </tr>
            );
          })}</tbody>
        </table>
      </section>
    </>
  );
}

function CriterionCell({ criterion }: { criterion?: AssessmentCriterion }) {
  return <td>{criterion?.status.replaceAll("_", " ") ?? "missing"}<small>{criterion?.explanation ?? "Criterion not present."}</small></td>;
}

function comparableChange(left?: AssessmentCriterion, right?: AssessmentCriterion) {
  const values = { fail: 0, warning: 1, pass: 2 } as const;
  if (!left || !right || !(left.status in values) || !(right.status in values)) return undefined;
  return Math.sign(values[right.status as keyof typeof values] - values[left.status as keyof typeof values]);
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric-card"><strong>{value}</strong><span>{label}</span></div>;
}
