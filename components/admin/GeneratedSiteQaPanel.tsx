import { ApplyAllFindingsForm } from "@/components/ApplyAllFindingsForm";
import { FindingApplyForm } from "@/components/FindingApplyForm";
import { RunGeneratedQaForm } from "@/components/RunGeneratedQaForm";
import { getEffectiveGenerationQaReadiness } from "@/lib/site-version-metadata";
import type { OptimizationFinding, QACheck, SiteBundle, SiteVersion } from "@/lib/models";

type GeneratedSiteQaPanelProps = {
  bundle: SiteBundle;
  version: SiteVersion;
  qa: {
    passed: boolean;
    checks: QACheck[];
  };
};

export function GeneratedSiteQaPanel({ bundle, version, qa }: GeneratedSiteQaPanelProps) {
  const openFindings = bundle.optimizationFindings.filter((finding) => finding.status === "open");
  const autoFixCount = openFindings.filter((finding) => finding.applyMode === "auto_fix").length;
  const oneClickCount = openFindings.filter((finding) => finding.applyMode === "one_click").length;
  const safeFindingCount = autoFixCount + oneClickCount;
  const failingChecks = qa.checks.filter((check) => check.severity === "fail");
  const readiness = getEffectiveGenerationQaReadiness(bundle, version);
  const blockers = version.generationQa?.blockers ?? [];

  return (
    <div className="workspace-view-stack">
      <section className="metric-row">
        <Metric label="QA status" value={qa.passed ? "Pass" : "Blocked"} />
        <Metric label="Publish readiness" value={readiness} />
        <Metric label="Failures" value={failingChecks.length} />
        <Metric label="Render blockers" value={blockers.length} />
        <Metric label="Open findings" value={openFindings.length} />
      </section>

      <div className="admin-grid workspace-grid">
        <section className="panel">
          <div className="section-heading-row">
            <div>
              <span className="badge">QA</span>
              <h2>QA checks</h2>
              <p className="muted">
                Local deterministic checks against the preview model. No agent or model work runs here.
              </p>
            </div>
            <RunGeneratedQaForm siteId={bundle.businessProfile.siteId} versionId={version.id} />
          </div>
          <div className="finding-list">
            {blockers.map((blocker) => (
              <article key={`${blocker.id}-${blocker.viewport ?? "all"}`} className="finding-card compact-card">
                <span className="badge severity-fail">{blocker.viewport ?? "all"}</span>
                <h3>{blocker.title}</h3>
                <p>{blocker.detail}</p>
              </article>
            ))}
            {readiness === "unavailable" ? (
              <article className="finding-card compact-card">
                <span className="badge severity-warning">unavailable</span>
                <h3>Preview QA has not run</h3>
                <p>Run QA for this version before publishing.</p>
              </article>
            ) : null}
          </div>
          <div className="finding-list">
            {prioritizeQaChecks(qa.checks).map((check) => (
              <article key={check.id} className="finding-card compact-card">
                <span className={`badge severity-${check.severity}`}>{check.severity}</span>
                <h3>{check.title}</h3>
                <p>{check.detail}</p>
                <small>{check.category}</small>
              </article>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="section-heading-row">
            <div>
              <span className="badge">Action list</span>
              <h2>Optimization findings</h2>
            </div>
          </div>
          <ApplyAllFindingsForm
            siteId={bundle.businessProfile.siteId}
            siteSlug={bundle.siteModel.slug}
            safeFindingCount={safeFindingCount}
          />
          <div className="finding-list qa-finding-list">
            {bundle.optimizationFindings.map((finding) => (
              <FindingCard key={finding.id} bundle={bundle} finding={finding} />
            ))}
            {bundle.optimizationFindings.length === 0 ? <p className="muted">No current findings.</p> : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function FindingCard({ bundle, finding }: { bundle: SiteBundle; finding: OptimizationFinding }) {
  return (
    <article className="finding-card compact-card">
      <div className="button-row">
        <span className="badge">{finding.applyMode.replace("_", " ")}</span>
        <span className="badge">{finding.status}</span>
      </div>
      <h3>{finding.title}</h3>
      <p>{finding.rationale}</p>
      <p>
        <strong>Recommended:</strong> {finding.recommendedAction}
      </p>
      <FindingApplyForm
        siteId={bundle.businessProfile.siteId}
        siteSlug={bundle.siteModel.slug}
        findingId={finding.id}
        applyMode={finding.applyMode}
        findingStatus={finding.status}
      />
    </article>
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

function prioritizeQaChecks(checks: QACheck[]) {
  return [...checks].sort((left, right) => severityRank(right.severity) - severityRank(left.severity));
}

function severityRank(severity: QACheck["severity"]) {
  if (severity === "fail") return 3;
  if (severity === "warning") return 2;
  return 1;
}
