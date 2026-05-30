import Link from "next/link";
import type { Metadata } from "next";
import { AdminGenerateForm } from "@/components/admin/AdminGenerateForm";
import { requireAdminPageAccess } from "@/lib/page-access";
import { repository } from "@/lib/repository";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false
  }
};

export default async function AdminGeneratePage() {
  await requireAdminPageAccess("/admin/generate");
  const [recentRuns, recentSites] = await Promise.all([
    repository.listAgentRuns({ runType: "site_generation", limit: 8 }),
    repository.listSiteBundles()
  ]);

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <span className="badge">Admin console</span>
          <h1>Generate</h1>
          <p>Create an internal generated preview from a public website URL and inspect the run telemetry.</p>
        </div>
      </header>

      <div className="admin-grid">
        <section className="panel">
          <h2>New Site</h2>
          <AdminGenerateForm />
        </section>

        <section className="panel">
          <h2>Recent Runs</h2>
          <div className="finding-list">
            {recentRuns.runs.map((run) => (
              <article key={run.id} className="finding-card compact-card">
                <span className={`badge status-${run.status}`}>{run.status}</span>
                <h3>{run.outputSummary ?? run.inputSummary ?? run.sourceHost ?? run.id}</h3>
                <p className="muted">{run.sourceHost ?? run.source} / {formatDuration(run.startedAt, run.endedAt)}</p>
                <div className="button-row">
                  <Link className="button secondary" href={`/admin/runs/${run.id}`}>
                    Inspect
                  </Link>
                  {run.targetSlug ? (
                    <Link className="button secondary" href={`/editor/${run.targetSlug}`}>
                      Editor
                    </Link>
                  ) : null}
                </div>
              </article>
            ))}
            {recentRuns.runs.length === 0 ? <p className="muted">No generation runs yet.</p> : null}
          </div>
        </section>
      </div>

      <section className="panel admin-section">
        <div className="section-heading-row">
          <h2>Recent Generated Sites</h2>
          <Link className="button secondary" href="/admin/sites">
            View all
          </Link>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th>Site</th>
              <th>Vertical</th>
              <th>Pages</th>
              <th>Links</th>
            </tr>
          </thead>
          <tbody>
            {recentSites.slice(0, 8).map((bundle) => (
              <tr key={bundle.businessProfile.siteId}>
                <td>{bundle.businessProfile.name}</td>
                <td>{bundle.businessProfile.vertical.replace(/_/g, " ")}</td>
                <td>{bundle.siteModel.versions[0]?.pages.length ?? 0}</td>
                <td>
                  <div className="button-row">
                    <Link className="button secondary" href={`/sites/${bundle.siteModel.slug}`}>
                      Site
                    </Link>
                    <Link className="button secondary" href={`/editor/${bundle.siteModel.slug}`}>
                      Editor
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}

function formatDuration(startedAt: string, endedAt?: string) {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return "duration unknown";
  const seconds = Math.max(0, Math.round((end - start) / 1000));
  return `${seconds}s`;
}
