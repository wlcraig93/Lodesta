import { getEffectiveGenerationQaReadiness } from "@/lib/site-version-metadata";
import { managedSiteStatus } from "@/lib/managed-site-status";
import type { SiteBundle, SiteVersion } from "@/lib/models";
import { RunObjectiveQaForm } from "@/components/admin/RunObjectiveQaForm";

type GeneratedSiteQaPanelProps = {
  bundle: SiteBundle;
  version: SiteVersion;
};

export function GeneratedSiteQaPanel({ bundle, version }: GeneratedSiteQaPanelProps) {
  const managed = managedSiteStatus(bundle);
  const readiness = getEffectiveGenerationQaReadiness(bundle, version);
  const blockers = version.generationQa?.blockers ?? [];
  const warnings = version.generationQa?.warnings ?? [];

  return (
    <div className="workspace-view-stack">
      <section className="metric-row">
        <Metric label="Objective QA" value={readiness} />
        <Metric label="Blockers" value={blockers.length} />
        <Metric label="Warnings" value={warnings.length} />
        <Metric label="Evidence confirmations" value={managed.evidence.pendingConfirmation} />
      </section>

      <div className="admin-grid workspace-grid">
        <section className="panel">
          <div className="section-heading-row">
            <div>
              <span className="badge">QA</span>
              <h2>Objective browser gate</h2>
              <p className="muted">
                Route rendering, overflow, media, placeholder, grounding, and sensitive-claim checks for this exact version.
              </p>
            </div>
            <RunObjectiveQaForm siteId={bundle.businessProfile.siteId} versionId={version.id} />
          </div>
          <div className="finding-list">
            {blockers.map((blocker) => (
              <article key={`${blocker.id}-${blocker.viewport ?? "all"}`} className="finding-card compact-card">
                <span className="badge severity-fail">{blocker.viewport ?? "all"}</span>
                <h3>{blocker.title}</h3>
                <p>{blocker.detail}</p>
              </article>
            ))}
            {readiness === "unavailable" || readiness === "pending" ? (
              <article className="finding-card compact-card">
                <span className="badge severity-warning">unavailable</span>
                <h3>Objective QA is not current</h3>
                <p>Run the canonical browser gate for this exact compiled version before publishing.</p>
              </article>
            ) : null}
            {warnings.map((warning) => (
              <article key={`${warning.id}-${warning.viewport ?? "all"}`} className="finding-card compact-card">
                <span className="badge severity-warning">{warning.viewport ?? "all"}</span>
                <h3>{warning.title}</h3>
                <p>{warning.detail}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="section-heading-row">
            <div>
              <span className="badge">Managed status</span>
              <h2>Canonical generation state</h2>
            </div>
          </div>
          <div className="finding-list qa-finding-list">
            <article className="finding-card compact-card">
              <span className="badge">{managed.generation.replace("_", " ")}</span>
              <h3>Generation</h3>
              <p>{managed.blockers[0] ?? "The stored plan, copy, browser gate, and final judgment are current."}</p>
            </article>
            <article className="finding-card compact-card">
              <span className="badge">{managed.evidence.sourceSparse ? "source sparse" : "source retained"}</span>
              <h3>Evidence</h3>
              <p>{managed.evidence.accepted} verified item(s), {managed.evidence.pendingConfirmation} awaiting confirmation.</p>
            </article>
          </div>
        </section>
      </div>
    </div>
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
