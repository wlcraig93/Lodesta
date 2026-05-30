import Link from "next/link";
import type { Metadata } from "next";
import { IntakeCreateForm } from "@/components/IntakeCreateForm";
import { standardCriteria } from "@/lib/standard";
import { repository } from "@/lib/repository";
import { requireAdminPageAccess } from "@/lib/page-access";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false
  }
};

export default async function HomePage() {
  await requireAdminPageAccess("/dashboard");
  const bundles = await repository.listSiteBundles();
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
          <p>
            <Link href="/admin/generate">Open the admin generation console</Link>
          </p>
          <IntakeCreateForm />
        </section>
      </main>
    );
  }

  const summary = await repository.analyticsSummary(primaryBundle.businessProfile.siteId);
  const leads = await repository.listFormSubmissions(primaryBundle.businessProfile.siteId);
  const criticalFindings = primaryBundle.optimizationFindings.filter((finding) => finding.severity === "critical");
  const openFindings = primaryBundle.optimizationFindings.filter((finding) => finding.status === "open");
  const trackedClicks = summary.clicks + summary.telClicks + summary.outboundClicks;
  const topSource = summary.outcomesBySource[0]?.label ?? "collecting";
  const versions = [...primaryBundle.siteModel.versions].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
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
          <Link className="button secondary" href="/outbound">
            Outbound
          </Link>
          <Link className="button primary" href="/admin/generate">
            Admin generate
          </Link>
          <Link className="button secondary" href="/account">
            Account
          </Link>
        </div>
      </header>

      <section className="metric-row">
        <div className="metric-card">
          <strong>{summary.sessions}</strong>
          <span>Sessions</span>
        </div>
        <div className="metric-card">
          <strong>{summary.telClicks}</strong>
          <span>Calls</span>
        </div>
        <div className="metric-card">
          <strong>{summary.formSubmits}</strong>
          <span>Forms</span>
        </div>
        <div className="metric-card">
          <strong>{trackedClicks}</strong>
          <span>Tracked clicks</span>
        </div>
      </section>

      <section className="metric-row">
        <div className="metric-card">
          <strong>{primaryBundle.siteModel.versions[0].pages.length}</strong>
          <span>Pages</span>
        </div>
        <div className="metric-card">
          <strong>{leads.length}</strong>
          <span>Leads</span>
        </div>
        <div className="metric-card">
          <strong>{openFindings.length}</strong>
          <span>Open recommendations</span>
        </div>
        <div className="metric-card">
          <strong>{topSource}</strong>
          <span>Top source</span>
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

        <section className="panel">
          <h2>Owner Summary</h2>
          <div className="dashboard-split">
            <div>
              <h3>Top Pages</h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Page</th>
                    <th>Sessions</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.outcomesByPage.slice(0, 5).map((row) => (
                    <tr key={row.key}>
                      <td>{row.label}</td>
                      <td>{row.sessions}</td>
                      <td>{row.primaryActions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {summary.outcomesByPage.length === 0 ? <p className="muted">No page traffic yet.</p> : null}
            </div>
            <div>
              <h3>Traffic Sources</h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Source</th>
                    <th>Sessions</th>
                    <th>Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.outcomesBySource.slice(0, 5).map((row) => (
                    <tr key={row.key}>
                      <td>{row.label}</td>
                      <td>{row.sessions}</td>
                      <td>{Math.round(row.actionRate * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {summary.outcomesBySource.length === 0 ? <p className="muted">No source attribution yet.</p> : null}
            </div>
          </div>
        </section>

        <aside className="panel">
          <h2>Recent Changes</h2>
          <div className="finding-list">
            {versions.slice(0, 4).map((version) => (
              <article key={version.id} className="finding-card compact-card">
                <span className={`badge ${version.status === "published" ? "severity-pass" : ""}`}>{version.status}</span>
                <h3>{version.pages[0]?.seo.title ?? version.pages[0]?.title ?? "Site version"}</h3>
                <p>{formatDate(version.createdAt)}</p>
              </article>
            ))}
          </div>
          <div className="button-row">
            <Link className="button secondary" href={`/versions/${primaryBundle.siteModel.slug}`}>
              View versions
            </Link>
          </div>
          <h2>Presence Intake</h2>
          <p>{primaryBundle.presenceAssessment.visualNotes[0]}</p>
          <p>{primaryBundle.presenceAssessment.publicPresenceNotes[0]}</p>
          <h2>Locked decisions</h2>
          <p>
            {standardCriteria.length} Standard criteria, {primaryBundle.extensionModel.forms.length} lead form(s),{" "}
            {primaryBundle.experiments.length} experiment loop(s).
          </p>
        </aside>
      </div>
    </main>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}
