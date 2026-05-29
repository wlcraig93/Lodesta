import Link from "next/link";
import { IntakeCreateForm } from "@/components/IntakeCreateForm";
import { standardCriteria } from "@/lib/standard";
import { repository } from "@/lib/repository";
import { requireOwnerAccess } from "@/lib/page-access";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const auth = await requireOwnerAccess("/");
  const [allBundles, claims] = await Promise.all([repository.listSiteBundles(), repository.listClaims()]);
  const userEmail = auth.user?.email?.toLowerCase();
  const bundles = !auth.configured
    ? allBundles
    : userEmail
      ? allBundles.filter((bundle) =>
          claims.some((claim) => claim.siteId === bundle.businessProfile.siteId && claim.ownerEmail?.toLowerCase() === userEmail)
        )
      : [];
  const primaryBundle = bundles[0];
  if (!primaryBundle) {
    return (
      <main className="admin-page">
        <header className="admin-header">
          <div>
            <span className="badge">Launch foundation</span>
            <h1>SMB Presence Autopilot</h1>
            <p>Create the first generated site through intake, then audits, analytics, forms, and publishing appear here.</p>
          </div>
        </header>
        <section className="panel">
          <h2>No sites yet</h2>
          <p>Create the first structured preview from an existing URL or a short business prompt.</p>
          <IntakeCreateForm />
        </section>
      </main>
    );
  }

  const summary = await repository.analyticsSummary(primaryBundle.businessProfile.siteId);
  const leads = await repository.listFormSubmissions(primaryBundle.businessProfile.siteId);
  const criticalFindings = primaryBundle.optimizationFindings.filter((finding) => finding.severity === "critical");
  const previewToken = (await repository.listPreviewTokens(primaryBundle.businessProfile.siteId))[0];
  const previewHref = previewToken ? `/preview/${previewToken.token}` : `/sites/${primaryBundle.siteModel.slug}`;

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <span className="badge">Launch foundation</span>
          <h1>SMB Presence Autopilot</h1>
          <p>
            A structured, managed website platform that imports a business presence, scores what exists, generates a
            conversion-focused replacement, and learns from first-party analytics.
          </p>
        </div>
        <div className="button-row">
          <Link className="button primary" href={previewHref}>
            View preview
          </Link>
          <Link className="button secondary" href={`/sites/${primaryBundle.siteModel.slug}`}>
            View public site
          </Link>
          <Link className="button secondary" href={`/editor/${primaryBundle.siteModel.slug}`}>
            Edit site
          </Link>
          <Link className="button secondary" href={`/analytics/${primaryBundle.siteModel.slug}`}>
            Analytics
          </Link>
          <Link className="button secondary" href={`/optimization/${primaryBundle.siteModel.slug}`}>
            Optimization
          </Link>
          <Link className="button secondary" href={`/experiments/${primaryBundle.siteModel.slug}`}>
            Experiments
          </Link>
          <Link className="button secondary" href={`/claim/${primaryBundle.siteModel.slug}`}>
            Claim flow
          </Link>
          <Link className="button secondary" href={`/domains/${primaryBundle.siteModel.slug}`}>
            Domains
          </Link>
          <Link className="button secondary" href={`/leads/${primaryBundle.siteModel.slug}`}>
            Leads
          </Link>
          <Link className="button secondary" href="/account">
            Account
          </Link>
        </div>
      </header>

      <section className="metric-row">
        <div className="metric-card">
          <strong>{standardCriteria.length}</strong>
          <span>Standard criteria</span>
        </div>
        <div className="metric-card">
          <strong>{primaryBundle.siteModel.versions[0].pages.length}</strong>
          <span>Generated pages</span>
        </div>
        <div className="metric-card">
          <strong>{leads.length}</strong>
          <span>Captured leads</span>
        </div>
        <div className="metric-card">
          <strong>{summary.events}</strong>
          <span>Analytics events</span>
        </div>
      </section>

      <section className="metric-row">
        <div className="metric-card">
          <strong>{primaryBundle.extensionModel.forms.length}</strong>
          <span>Lead forms</span>
        </div>
        <div className="metric-card">
          <strong>{primaryBundle.experiments.length}</strong>
          <span>Experiment loops</span>
        </div>
        <div className="metric-card">
          <strong>{summary.sessions}</strong>
          <span>Sessions tracked</span>
        </div>
        <div className="metric-card">
          <strong>{Math.round(summary.engagedMs / 1000)}</strong>
          <span>Engaged seconds</span>
        </div>
      </section>

      <div className="admin-grid">
        <section className="panel">
          <h2>Create Another Preview</h2>
          <IntakeCreateForm />
        </section>

        <section className="panel">
          <h2>Action List</h2>
          <div className="finding-list">
            {primaryBundle.optimizationFindings.map((finding) => (
              <article key={finding.id} className="finding-card">
                <span className="badge">{finding.applyMode.replace("_", " ")}</span>
                <h3>{finding.title}</h3>
                <p>{finding.rationale}</p>
                <p>
                  <strong>Recommended:</strong> {finding.recommendedAction}
                </p>
              </article>
            ))}
            {criticalFindings.length === 0 ? (
              <article className="finding-card">
                <span className="badge">clear</span>
                <h3>No critical launch findings in the sample site</h3>
                <p>The audit layer is wired and ready for real intake data.</p>
              </article>
            ) : null}
          </div>
        </section>

        <aside className="panel">
          <h2>Presence Intake</h2>
          <p>{primaryBundle.presenceAssessment.visualNotes[0]}</p>
          <p>{primaryBundle.presenceAssessment.publicPresenceNotes[0]}</p>
          <h2>Locked decisions</h2>
          <p>Next.js + TypeScript, Railway workers, Cloudflare for SaaS at scale, structured renderer, curated editing.</p>
        </aside>
      </div>
    </main>
  );
}
