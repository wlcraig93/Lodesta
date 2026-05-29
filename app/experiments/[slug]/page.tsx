import Link from "next/link";
import { notFound } from "next/navigation";
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
  const assignmentEvents = events.filter((event) => event.eventType === "experiment_assignment");
  const leaderCount = analyses.filter((analysis) => analysis.status === "leader_detected").length;

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
        <Metric label="Running" value={bundle.experiments.filter((experiment) => experiment.status === "running").length} />
        <Metric label="Assignments" value={assignmentEvents.length} />
        <Metric label="Leaders" value={leaderCount} />
        <Metric label="Calls" value={events.filter((event) => event.eventType === "tel_click").length} />
      </section>

      <section className="panel">
        <h2>Experiment Loops</h2>
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
                {analysis?.leaderLabel ? (
                  <p>
                    <strong>Current leader:</strong> {analysis.leaderLabel}
                  </p>
                ) : null}
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
