import Link from "next/link";
import type { Metadata } from "next";
import { requireAdminPageAccess } from "@/lib/page-access";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AssessmentScanForm } from "@/components/admin/AssessmentScanForm";
import { platformOperationsRepository } from "@/packages/platform-operations";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AssessmentsPage() {
  await requireAdminPageAccess("/admin/assessments");
  const records = await platformOperationsRepository.listWebsiteAssessments({ limit: 100 });
  const completed = records.filter((record) => record.status === "completed");
  const failures = records.filter((record) => record.status === "failed").length;
  const coverageValues = completed
    .flatMap((record) => record.assessment ? [record.assessment.coverage.value] : [])
    .sort((left, right) => left - right);
  const medianCoverage = coverageValues.length
    ? coverageValues[Math.floor((coverageValues.length - 1) / 2)]
    : undefined;
  const rubricIdentities = new Set(records.map((record) => record.rubricIdentity)).size;
  return (
    <main className="admin-page">
      <AdminPageHeader
        eyebrow="Evidence"
        title="Website assessments"
        description="Run and inspect the canonical local-business rubric. Scores and verdicts remain provisional and internal."
      />
      <section className="metric-row" aria-label="Assessment monitoring">
        <Metric label="Completed" value={`${completed.length}/${records.length}`} />
        <Metric label="Failures" value={`${failures}`} />
        <Metric label="Median coverage" value={medianCoverage === undefined ? "—" : `${Math.round(medianCoverage * 100)}%`} />
        <Metric label="Rubric identities" value={`${rubricIdentities}`} />
      </section>
      <section className="panel">
        <h2>Assess a public website</h2>
        <p className="muted">The bounded crawl and destination probes respect robots.txt, two-request origin concurrency, and 500 ms request pacing.</p>
        <AssessmentScanForm />
      </section>
      <section className="panel admin-section">
        <div className="admin-section-heading">
          <div>
            <h2>Recent assessments</h2>
            <p className="muted">Immutable records retain their rubric, scanner, coverage, evidence, and limitations.</p>
          </div>
        </div>
        <table className="data-table">
          <thead>
            <tr><th>Status</th><th>Target</th><th>Evidence</th><th>Rubric</th><th>Created</th></tr>
          </thead>
          <tbody>
            {records.map((record) => (
              <tr key={record.id}>
                <td><span className={`badge status-${record.status}`}>{record.status}</span></td>
                <td>
                  <Link href={`/admin/assessments/${record.id}`}>{record.sourceUrl ?? record.artifactId ?? record.sourceKey}</Link>
                  <small>{record.targetKind.replaceAll("_", " ")} · {record.id}</small>
                </td>
                <td>
                  {record.assessment
                    ? `${record.assessment.coverage.assessedCriteria}/${record.assessment.coverage.applicableCriteria} criteria`
                    : record.status === "completed"
                      ? "Stale schema — rebuild"
                      : "Pending"}
                  <small>{record.assessment?.score ? `${record.assessment.score.value} provisional · ${record.assessment.score.verdict}` : "No eligible composite"}</small>
                </td>
                <td>{record.rubricIdentity}<small>{record.scannerIdentity}</small></td>
                <td>{new Date(record.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!records.length ? <p className="muted">No assessments have been created.</p> : null}
      </section>
      <section className="panel">
        <h2>Compare matched assessments</h2>
        <form action="/admin/assessments/compare" className="admin-filter-form">
          <input name="left" placeholder="Current/source assessment ID" required />
          <input name="right" placeholder="Candidate assessment ID" required />
          <button className="button secondary" type="submit">Compare evidence</button>
        </form>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric-card"><strong>{value}</strong><span>{label}</span></div>;
}
