import Link from "next/link";
import { notFound } from "next/navigation";
import { ApplyAllFindingsForm } from "@/components/ApplyAllFindingsForm";
import { FindingApplyForm } from "@/components/FindingApplyForm";
import { repository } from "@/lib/repository";
import { runSiteQa } from "@/lib/qa";
import { requireSiteOwnerAccess } from "@/lib/page-access";

export const dynamic = "force-dynamic";

export default async function OptimizationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const bundle = await repository.getSiteBundleBySlug(slug);
  if (!bundle) notFound();
  await requireSiteOwnerAccess(bundle, `/optimization/${slug}`);

  const qa = runSiteQa(bundle, { versionStatus: "draft" });
  const openFindings = bundle.optimizationFindings.filter((finding) => finding.status === "open");
  const autoFixCount = openFindings.filter((finding) => finding.applyMode === "auto_fix").length;
  const oneClickCount = openFindings.filter((finding) => finding.applyMode === "one_click").length;
  const manualCount = openFindings.filter((finding) => finding.applyMode === "manual_service").length;
  const safeFindingCount = autoFixCount + oneClickCount;

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <span className="badge">Optimization</span>
          <h1>{bundle.businessProfile.name}</h1>
          <p>
            Review-mode action list with concrete mutations. One-click and auto-fix findings edit drafts, run QA, and
            require explicit publish confirmation after the QA gate passes.
          </p>
        </div>
        <div className="button-row">
          <Link className="button secondary" href={`/analytics/${bundle.siteModel.slug}`}>
            Analytics
          </Link>
          <Link className="button secondary" href={`/editor/${bundle.siteModel.slug}`}>
            Editor
          </Link>
          <Link className="button primary" href={`/sites/${bundle.siteModel.slug}`}>
            View site
          </Link>
        </div>
      </header>

      <section className="metric-row">
        <Metric label="Open findings" value={openFindings.length} />
        <Metric label="Auto-fix" value={autoFixCount} />
        <Metric label="One-click" value={oneClickCount} />
        <Metric label="Manual" value={manualCount} />
      </section>

      <div className="admin-grid">
        <section className="panel">
          <h2>Action List</h2>
          <ApplyAllFindingsForm
            siteId={bundle.businessProfile.siteId}
            siteSlug={bundle.siteModel.slug}
            safeFindingCount={safeFindingCount}
          />
          <div className="finding-list">
            {bundle.optimizationFindings.map((finding) => (
              <article key={finding.id} className="finding-card">
                <div className="button-row">
                  <span className="badge">{finding.applyMode.replace("_", " ")}</span>
                  <span className="badge">{finding.status}</span>
                </div>
                <h3>{finding.title}</h3>
                <p>{finding.rationale}</p>
                <p>
                  <strong>Recommended:</strong> {finding.recommendedAction}
                </p>
                {finding.suggestedEditPayload ? (
                  <p>
                    <strong>Edit:</strong> {String(finding.suggestedEditPayload.action)}
                  </p>
                ) : null}
                <FindingApplyForm
                  siteId={bundle.businessProfile.siteId}
                  siteSlug={bundle.siteModel.slug}
                  findingId={finding.id}
                  applyMode={finding.applyMode}
                  findingStatus={finding.status}
                />
              </article>
            ))}
            {bundle.optimizationFindings.length === 0 ? <p className="muted">No current findings.</p> : null}
          </div>
        </section>

        <aside className="panel">
          <h2>QA Gate</h2>
          <p>{qa.passed ? "Draft QA is passing." : "Draft QA has failures that block publish confirmation."}</p>
          <div className="finding-list">
            {qa.checks.map((check) => (
              <article key={check.id} className="finding-card">
                <span className="badge">{check.severity}</span>
                <h3>{check.title}</h3>
                <p>{check.detail}</p>
              </article>
            ))}
          </div>
        </aside>
      </div>
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
