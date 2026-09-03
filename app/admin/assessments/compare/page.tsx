import Link from "next/link";
import type { Metadata } from "next";
import { requireAdminPageAccess } from "@/lib/page-access";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { platformOperationsRepository } from "@/packages/platform-operations";
import type {
  AssessmentCriterion,
  WebsiteAssessment
} from "@/packages/website-assessment/contracts";

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
  const comparable = left && right && left.comparability.key === right.comparability.key
    && left.coverage.comparisonEligible
    && right.coverage.comparisonEligible;
  return (
    <main className="admin-page">
      <AdminPageHeader
        eyebrow="Matched Website Health evidence"
        title="Report comparison"
        description="Compare unified criteria only when evidence class, sampling profile, evaluator identities, registry, scanner, and evidence completeness match."
        actions={<Link className="button secondary" href="/admin/assessments">All reports</Link>}
      />
      <section className="panel">
        <form action="/admin/assessments/compare" className="admin-filter-form">
          <input name="left" placeholder="Current/source report ID" defaultValue={leftId} required />
          <input name="right" placeholder="Candidate report ID" defaultValue={rightId} required />
          <button className="button primary" type="submit">Compare</button>
        </form>
      </section>
      {!leftId || !rightId ? <section className="panel"><p>Choose two completed canonical report IDs.</p></section> : null}
      {leftId && !left ? <section className="panel"><p className="error-text">The left report is missing, incomplete, or stale.</p></section> : null}
      {rightId && !right ? <section className="panel"><p className="error-text">The right report is missing, incomplete, or stale.</p></section> : null}
      {left && right && !comparable ? (
        <section className="panel">
          <span className="badge severity-warning">Comparison blocked</span>
          <h2>Reassess with matching complete methodology</h2>
          <p>A formal delta would be misleading because methodology identities differ or at least one report records an evidence-pipeline limitation.</p>
          <p className="muted">
            Left: {methodologySummary(left)}<br />
            Right: {methodologySummary(right)}
          </p>
        </section>
      ) : null}
      {left && right && comparable ? <Comparison left={left} right={right} /> : null}
    </main>
  );
}

function Comparison({ left, right }: { left: WebsiteAssessment; right: WebsiteAssessment }) {
  const leftCriteria = criterionMap(left);
  const rightCriteria = criterionMap(right);
  const ids = [...new Set([...leftCriteria.keys(), ...rightCriteria.keys()])].sort();
  const changes = ids.map((id) => ({
    id,
    left: leftCriteria.get(id),
    right: rightCriteria.get(id),
    change: comparableChange(leftCriteria.get(id), rightCriteria.get(id))
  }));
  const improved = changes.filter((item) => item.change === 1).length;
  const regressed = changes.filter((item) => item.change === -1).length;
  const authorChanges = changes.filter((item) =>
    item.left?.controlOwner === "site_author" && item.right?.controlOwner === "site_author"
  );
  return (
    <>
      <section className="metric-row">
        <Metric label="Improved criteria" value={`${improved}`} />
        <Metric label="Regressed criteria" value={`${regressed}`} />
        <Metric label="Author improvements" value={`${authorChanges.filter((item) => item.change === 1).length}`} />
        <Metric label="Author regressions" value={`${authorChanges.filter((item) => item.change === -1).length}`} />
        <Metric label="Left measured health" value={`${left.grade?.value ?? "—"}${left.grade?.band ? ` · ${left.grade.band}` : " · band suppressed"}`} />
        <Metric label="Right measured health" value={`${right.grade?.value ?? "—"}${right.grade?.band ? ` · ${right.grade.band}` : " · band suppressed"}`} />
        <Metric label="Left author-controlled health" value={`${left.score.scopes.siteAuthor.value ?? "—"}`} />
        <Metric label="Right author-controlled health" value={`${right.score.scopes.siteAuthor.value ?? "—"}`} />
      </section>
      <section className="panel">
        <h2>Comparison basis</h2>
        <p>{methodologySummary(left)}</p>
        <p className="muted">
          Left site/pipeline evidence: {Math.round(left.coverage.siteEvidence * 100)}% / {Math.round(left.coverage.pipelineCompleteness * 100)}%.
          Right site/pipeline evidence: {Math.round(right.coverage.siteEvidence * 100)}% / {Math.round(right.coverage.pipelineCompleteness * 100)}%.
        </p>
      </section>
      <section className="panel admin-section">
        <div className="admin-section-heading">
          <div><h2>Unified criterion deltas</h2><p className="muted">Unknown and not-applicable states are retained but not ranked.</p></div>
        </div>
        <table className="data-table">
          <thead><tr><th>Criterion and owner</th><th>Current/source</th><th>Candidate</th><th>Change</th></tr></thead>
          <tbody>{changes.map((item) => (
            <tr key={item.id}>
              <td>
                <strong>{item.left?.title ?? item.right?.title ?? item.id}</strong>
                <small>{item.id} · {(item.left?.controlOwner ?? item.right?.controlOwner ?? "unknown").replaceAll("_", " ")}</small>
              </td>
              <CriterionCell criterion={item.left} />
              <CriterionCell criterion={item.right} />
              <td><span className={`badge ${item.change === 1 ? "severity-pass" : item.change === -1 ? "severity-critical" : "severity-advisory"}`}>{item.change === 1 ? "improved" : item.change === -1 ? "regressed" : item.change === 0 ? "unchanged" : "not comparable"}</span></td>
            </tr>
          ))}</tbody>
        </table>
      </section>
    </>
  );
}

function CriterionCell({ criterion }: { criterion?: AssessmentCriterion }) {
  return (
    <td>
      {criterion?.status.replaceAll("_", " ") ?? "missing"}
      <small>{criterion?.explanation ?? "Criterion not present."}</small>
    </td>
  );
}

function comparableChange(left?: AssessmentCriterion, right?: AssessmentCriterion) {
  const values = { fail: 0, warning: 1, pass: 2 } as const;
  if (!left || !right || !(left.status in values) || !(right.status in values)) return undefined;
  return Math.sign(values[right.status as keyof typeof values] - values[left.status as keyof typeof values]);
}

function criterionMap(assessment: WebsiteAssessment) {
  return new Map(assessment.dimensions.flatMap((dimension) =>
    dimension.criteria.map((criterion) => [criterion.id, criterion] as const)
  ));
}

function evaluatorIdentity(assessment: WebsiteAssessment) {
  return assessment.evaluators
    .map((evaluator) => `${evaluator.kind}:${evaluator.identity}:${evaluator.status}`)
    .sort()
    .join("|");
}

function methodologySummary(assessment: WebsiteAssessment) {
  return `${assessment.comparability.key} · ${assessment.comparability.evidenceClass} · ${assessment.servingContract.kind} · ${assessment.comparability.sampledRouteCount} sampled routes · reference ${assessment.referenceAuthority.kind} · inventory ${assessment.comparability.inventoryIdentity} · ${evaluatorIdentity(assessment)} · comparison ${assessment.coverage.comparisonEligible ? "eligible" : "disabled"}`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric-card"><strong>{value}</strong><span>{label}</span></div>;
}
