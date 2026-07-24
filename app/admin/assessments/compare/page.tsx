import Link from "next/link";
import type { Metadata } from "next";
import { requireAdminPageAccess } from "@/lib/page-access";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { platformOperationsRepository } from "@/packages/platform-operations";
import type {
  AgentReadinessCheck,
  AssessmentCriterion,
  VisualQualityCheck,
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
  return (
    <main className="admin-page">
      <AdminPageHeader
        eyebrow="Matched evidence"
        title="Assessment comparison"
        description="Compare matched objective, Agent Readiness, and Visual Quality checks only when both records use the same identities."
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
      {left && right && !identitiesMatch(left, right) ? (
        <section className="panel">
          <span className="badge severity-warning">Comparison blocked</span>
          <h2>Reassess before comparing</h2>
          <p>The records identify different rubrics, Agent Readiness methodologies, or Visual Quality evaluators. A numeric or status delta would be misleading.</p>
          <p className="muted">
            Left: {left.producer.rubricIdentity} · {left.agentReadiness.methodologyIdentity} · {left.visualQuality.methodologyIdentity} · {left.visualQuality.evaluator.identity}<br />
            Right: {right.producer.rubricIdentity} · {right.agentReadiness.methodologyIdentity} · {right.visualQuality.methodologyIdentity} · {right.visualQuality.evaluator.identity}
          </p>
        </section>
      ) : null}
      {left && right && identitiesMatch(left, right) ? <Comparison left={left} right={right} /> : null}
    </main>
  );
}

function Comparison({ left, right }: { left: WebsiteAssessment; right: WebsiteAssessment }) {
  const leftCriteria = new Map(left.dimensions.flatMap((dimension) => dimension.criteria).map((criterion) => [criterion.id, criterion]));
  const rightCriteria = new Map(right.dimensions.flatMap((dimension) => dimension.criteria).map((criterion) => [criterion.id, criterion]));
  const ids = [...new Set([...leftCriteria.keys(), ...rightCriteria.keys()])];
  const improved = ids.filter((id) => comparableChange(leftCriteria.get(id), rightCriteria.get(id)) === 1).length;
  const regressed = ids.filter((id) => comparableChange(leftCriteria.get(id), rightCriteria.get(id)) === -1).length;
  const leftAgentChecks = new Map(left.agentReadiness.groups.flatMap((group) => group.checks).map((check) => [check.id, check]));
  const rightAgentChecks = new Map(right.agentReadiness.groups.flatMap((group) => group.checks).map((check) => [check.id, check]));
  const agentIds = [...new Set([...leftAgentChecks.keys(), ...rightAgentChecks.keys()])];
  const agentImproved = agentIds.filter((id) => comparableChange(leftAgentChecks.get(id), rightAgentChecks.get(id)) === 1).length;
  const agentRegressed = agentIds.filter((id) => comparableChange(leftAgentChecks.get(id), rightAgentChecks.get(id)) === -1).length;
  const leftVisualChecks = new Map(left.visualQuality.groups.flatMap((group) => group.checks).map((check) => [check.id, check]));
  const rightVisualChecks = new Map(right.visualQuality.groups.flatMap((group) => group.checks).map((check) => [check.id, check]));
  const visualIds = [...new Set([...leftVisualChecks.keys(), ...rightVisualChecks.keys()])];
  const visualImproved = visualIds.filter((id) => comparableChange(leftVisualChecks.get(id), rightVisualChecks.get(id)) === 1).length;
  const visualRegressed = visualIds.filter((id) => comparableChange(leftVisualChecks.get(id), rightVisualChecks.get(id)) === -1).length;
  return (
    <>
      <section className="metric-row">
        <Metric label="Improved criteria" value={`${improved}`} />
        <Metric label="Regressed criteria" value={`${regressed}`} />
        <Metric label="Improved agent checks" value={`${agentImproved}`} />
        <Metric label="Regressed agent checks" value={`${agentRegressed}`} />
        <Metric label="Improved visual checks" value={`${visualImproved}`} />
        <Metric label="Regressed visual checks" value={`${visualRegressed}`} />
        <Metric label="Left coverage" value={`${Math.round(left.coverage.value * 100)}%`} />
        <Metric label="Right coverage" value={`${Math.round(right.coverage.value * 100)}%`} />
      </section>
      <section className="panel">
        <h2>Comparison basis</h2>
        <p>Rubric identity {left.producer.rubricIdentity}. Agent methodology identity {left.agentReadiness.methodologyIdentity}. Visual methodology {left.visualQuality.methodologyIdentity}. Left score {left.score?.value ?? "—"}; right score {right.score?.value ?? "—"}. Visual Quality remains advisory and unweighted.</p>
        <p className="muted">Left limitations: {left.coverage.limitations.join(" · ") || "none"}<br />Right limitations: {right.coverage.limitations.join(" · ") || "none"}</p>
      </section>
      <section className="panel admin-section">
        <div className="admin-section-heading"><div><h2>Scored website criteria</h2><p className="muted">Unknown and not-applicable states are not compared.</p></div></div>
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
      <section className="panel admin-section">
        <div className="admin-section-heading"><div><h2>Visual Quality checks</h2><p className="muted">Matched by stable check ID; unknown and not-applicable states are not compared.</p></div></div>
        <table className="data-table">
          <thead><tr><th>Check</th><th>Current/source</th><th>Candidate</th><th>Change</th></tr></thead>
          <tbody>{visualIds.map((id) => {
            const leftCheck = leftVisualChecks.get(id);
            const rightCheck = rightVisualChecks.get(id);
            const change = comparableChange(leftCheck, rightCheck);
            return (
              <tr key={id}>
                <td><strong>{leftCheck?.title ?? rightCheck?.title ?? id}</strong><small>{id}</small></td>
                <VisualCheckCell check={leftCheck} />
                <VisualCheckCell check={rightCheck} />
                <td><span className={`badge ${change === 1 ? "severity-pass" : change === -1 ? "severity-critical" : "severity-advisory"}`}>{change === 1 ? "improved" : change === -1 ? "regressed" : change === 0 ? "unchanged" : "not comparable"}</span></td>
              </tr>
            );
          })}</tbody>
        </table>
      </section>
      <section className="panel admin-section">
        <div className="admin-section-heading"><div><h2>Agent Readiness checks</h2><p className="muted">Matched by stable check ID; unknown and not-applicable states are not compared.</p></div></div>
        <table className="data-table">
          <thead><tr><th>Check</th><th>Current/source</th><th>Candidate</th><th>Change</th></tr></thead>
          <tbody>{agentIds.map((id) => {
            const leftCheck = leftAgentChecks.get(id);
            const rightCheck = rightAgentChecks.get(id);
            const change = comparableChange(leftCheck, rightCheck);
            return (
              <tr key={id}>
                <td><strong>{leftCheck?.title ?? rightCheck?.title ?? id}</strong><small>{id}</small></td>
                <AgentCheckCell check={leftCheck} />
                <AgentCheckCell check={rightCheck} />
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

function AgentCheckCell({ check }: { check?: AgentReadinessCheck }) {
  return <td>{check?.status.replaceAll("_", " ") ?? "missing"}<small>{check?.alignment.replaceAll("_", " ") ?? "Check not present."}</small></td>;
}

function VisualCheckCell({ check }: { check?: VisualQualityCheck }) {
  return <td>{check?.status.replaceAll("_", " ") ?? "missing"}<small>{check?.explanation ?? "Check not present."}</small></td>;
}

function comparableChange(
  left?: Pick<AssessmentCriterion, "status"> | Pick<AgentReadinessCheck, "status"> | Pick<VisualQualityCheck, "status">,
  right?: Pick<AssessmentCriterion, "status"> | Pick<AgentReadinessCheck, "status"> | Pick<VisualQualityCheck, "status">
) {
  const values = { fail: 0, warning: 1, pass: 2 } as const;
  if (!left || !right || !(left.status in values) || !(right.status in values)) return undefined;
  return Math.sign(values[right.status as keyof typeof values] - values[left.status as keyof typeof values]);
}

function identitiesMatch(left: WebsiteAssessment, right: WebsiteAssessment) {
  return left.producer.rubricIdentity === right.producer.rubricIdentity
    && left.agentReadiness.methodologyIdentity === right.agentReadiness.methodologyIdentity
    && left.visualQuality.methodologyIdentity === right.visualQuality.methodologyIdentity
    && left.visualQuality.evaluator.identity === right.visualQuality.evaluator.identity;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric-card"><strong>{value}</strong><span>{label}</span></div>;
}
