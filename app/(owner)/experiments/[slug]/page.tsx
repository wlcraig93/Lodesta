import Link from "next/link";
import { notFound } from "next/navigation";
import { ExperimentControlForm } from "@/components/ExperimentControlForm";
import { ExperimentLearningForm } from "@/components/ExperimentLearningForm";
import { repository } from "@/lib/repository";
import { requireSiteOwnerAccess } from "@/lib/page-access";

export const dynamic = "force-dynamic";

export default async function ExperimentsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const bundle = await repository.getSiteBundleBySlug(slug);
  if (!bundle) notFound();
  await requireSiteOwnerAccess(bundle, `/experiments/${slug}`);

  const events = await repository.listAnalyticsEvents(bundle.businessProfile.siteId);
  const analyses = await repository.analyzeExperiments(bundle.businessProfile.siteId);
  const learnings = await repository.listExperimentLearnings({ siteId: bundle.businessProfile.siteId });
  const assignmentEvents = events.filter((event) => event.eventType === "experiment_assignment");
  const leaderCount = analyses.filter((analysis) => analysis.status === "leader_detected").length;
  const runningCount = bundle.experiments.filter((experiment) => experiment.status === "running").length;

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <span className="badge">Experiments</span>
          <h1>{bundle.businessProfile.name}</h1>
          <p>
            Narrow opt-in experiment reporting for content-neutral conversion mechanics. The launch runtime assigns
            sessions, records variants, and lets analytics compare downstream calls, forms, and ordering clicks.
          </p>
        </div>
        <div className="button-row">
          <Link className="button secondary" href={`/analytics/${bundle.siteModel.slug}`}>
            Analytics
          </Link>
          <Link className="button secondary" href={`/optimization/${bundle.siteModel.slug}`}>
            Optimization
          </Link>
          <Link className="button primary" href={`/sites/${bundle.siteModel.slug}`}>
            View site
          </Link>
        </div>
      </header>

      <section className="metric-row">
        <Metric label="Opted in" value={runningCount} />
        <Metric label="Assignments" value={assignmentEvents.length} />
        <Metric label="Leaders" value={leaderCount} />
        <Metric label="Learnings" value={learnings.filter((learning) => learning.status === "active").length} />
      </section>

      <section className="panel">
        <h2>Experiment Loops</h2>
        {runningCount === 0 ? (
          <p className="muted">No experiments are running. Start one explicitly before visitor sessions can be assigned.</p>
        ) : null}
        <div className="finding-list">
          {bundle.experiments.map((experiment) => {
            const analysis = analyses.find((candidate) => candidate.experimentId === experiment.id);
            return (
              <article key={experiment.id} className="finding-card">
                <div className="button-row">
                  <span className="badge">{experiment.status}</span>
                  {analysis ? <span className="badge">{analysis.status.replace("_", " ")}</span> : null}
                  {analysis ? <span className="badge">{analysis.confidence.replace("_", " ")}</span> : null}
                </div>
                <h3>{experiment.hypothesis}</h3>
                <p>
                  <strong>Surface:</strong> {experiment.surface.replace("_", " ")}
                </p>
                <p>
                  <strong>Primary metric:</strong> {experiment.primaryMetric.replace("_", " ")}
                </p>
                {experiment.holdoutPercent ? (
                  <p>
                    <strong>Holdout:</strong> {Math.round(experiment.holdoutPercent * 100)}% of sessions stay on the control variant.
                  </p>
                ) : null}
                <p className="muted">
                  {[
                    experiment.startedAt ? `Started ${formatDate(experiment.startedAt)}` : null,
                    experiment.concludedAt ? `Concluded ${formatDate(experiment.concludedAt)}` : null,
                    experiment.rolledBackAt ? `Rolled back ${formatDate(experiment.rolledBackAt)}` : null,
                    experiment.updatedAt ? `Updated ${formatDate(experiment.updatedAt)}` : null
                  ]
                    .filter(Boolean)
                    .join(" | ") || "Not started yet."}
                </p>
                {analysis?.status === "leader_detected" && analysis.leaderLabel ? (
                  <p>
                    <strong>Current leader:</strong> {analysis.leaderLabel}
                  </p>
                ) : null}
                <ExperimentControlForm
                  siteId={bundle.businessProfile.siteId}
                  experimentId={experiment.id}
                  status={experiment.status}
                  holdoutPercent={experiment.holdoutPercent}
                />
                <ExperimentLearningForm
                  siteId={bundle.businessProfile.siteId}
                  experimentId={experiment.id}
                  disabledReason={learningDisabledReason(experiment.status, analysis)}
                />
                <div className="bar-list">
                  {(analysis?.variants ?? []).map((variant) => {
                    return (
                      <Bar
                        key={variant.variantId}
                        label={`${variant.label}: ${Math.round(variant.actionRate * 100)}% action rate`}
                        value={variant.metricActions}
                        max={Math.max(...(analysis?.variants ?? []).map((item) => item.metricActions), 1)}
                      />
                    );
                  })}
                </div>
                {analysis ? (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Variant</th>
                        <th>Sessions</th>
                        <th>Actions</th>
                        <th>Rate</th>
                        <th>Lift</th>
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.variants.map((variant) => (
                        <tr key={variant.variantId}>
                          <td>{variant.label}</td>
                          <td>{variant.sessions}</td>
                          <td>{variant.metricActions}</td>
                          <td>{Math.round(variant.actionRate * 100)}%</td>
                          <td>{formatLift(variant.liftVsControl)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </article>
            );
          })}
          {bundle.experiments.length === 0 ? <p className="muted">No experiments configured yet.</p> : null}
        </div>
      </section>

      <section className="panel">
        <h2>Learnings</h2>
        <div className="finding-list">
          {learnings.map((learning) => (
            <article key={learning.id} className="finding-card">
              <div className="button-row">
                <span className="badge">{learning.status.replace("_", " ")}</span>
                <span className="badge">{learning.confidence.replace("_", " ")}</span>
              </div>
              <h3>{learning.winnerLabel}</h3>
              <p>{learning.generationRule}</p>
              <p>
                <strong>Standard:</strong> {learning.standardCriterionId}
              </p>
              <p>
                <strong>Observed lift:</strong> {formatLift(learning.observedLift)} from {learning.totalAssignments} assignments.
              </p>
            </article>
          ))}
          {learnings.length === 0 ? <p className="muted">No experiment learnings adopted yet.</p> : null}
        </div>
      </section>
    </main>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric-card">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function formatLift(value: number) {
  if (!Number.isFinite(value) || value === 0) return "0%";
  return `${value > 0 ? "+" : ""}${Math.round(value * 100)}%`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function learningDisabledReason(
  status: string,
  analysis: Awaited<ReturnType<typeof repository.analyzeExperiments>>[number] | undefined
) {
  if (!analysis) return "Analysis is not available yet.";
  if (status === "rolled_back") return "Rolled-back experiments cannot adopt new learnings.";
  if (status === "concluded") return "Experiment is already concluded.";
  if (analysis.status !== "leader_detected") return "Keep collecting until a leader is detected.";
  if (analysis.confidence === "insufficient_data") return "More assignments are needed before adopting a learning.";
  if (analysis.leaderVariantId === analysis.controlVariantId) return "The control is still leading; no new default should be learned.";
  return undefined;
}

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  const width = Math.max(4, Math.round((value / Math.max(max, 1)) * 100));
  return (
    <div className="bar-row">
      <div>
        <strong>{label}</strong>
        <span>{value}</span>
      </div>
      <div className="bar-track">
        <span className="bar-fill" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}
