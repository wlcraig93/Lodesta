import Link from "next/link";
import type { Metadata } from "next";
import { requireAdminPageAccess } from "@/lib/page-access";
import { repository } from "@/lib/repository";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false
  }
};

export default async function AdminSitesPage() {
  await requireAdminPageAccess("/admin/sites");
  const [sites, runs, previewTokens] = await Promise.all([
    repository.listSiteBundles(),
    repository.listAgentRuns({ runType: "site_generation", targetType: "site", limit: 100 }),
    repository.listPreviewTokens()
  ]);
  const latestRunBySite = new Map(runs.runs.filter((run) => run.targetId).map((run) => [run.targetId, run]));
  const previewBySite = new Map(previewTokens.map((token) => [token.siteId, token]));

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <span className="badge">Generated sites</span>
          <h1>Sites</h1>
          <p>Open generated sites, editors, optimization surfaces, analytics, leads, domains, and latest run telemetry.</p>
        </div>
        <Link className="button primary" href="/admin/generate">
          Generate
        </Link>
      </header>

      <section className="panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>Site</th>
              <th>Vertical</th>
              <th>Pages</th>
              <th>Latest Run</th>
              <th>Links</th>
            </tr>
          </thead>
          <tbody>
            {sites.map((bundle) => {
              const siteId = bundle.businessProfile.siteId;
              const run = latestRunBySite.get(siteId);
              const preview = previewBySite.get(siteId);
              return (
                <tr key={siteId}>
                  <td>
                    {bundle.businessProfile.name}
                    <small>{bundle.siteModel.slug}</small>
                  </td>
                  <td>{bundle.businessProfile.vertical.replace(/_/g, " ")}</td>
                  <td>{bundle.siteModel.versions[0]?.pages.length ?? 0}</td>
                  <td>
                    {run ? (
                      <Link href={`/admin/runs/${run.id}`}>{run.status}</Link>
                    ) : (
                      <span className="muted">No telemetry</span>
                    )}
                  </td>
                  <td>
                    <div className="button-row">
                      <Link className="button secondary" href={preview ? `/preview/${preview.token}` : `/sites/${bundle.siteModel.slug}`}>
                        Preview
                      </Link>
                      <Link className="button secondary" href={`/editor/${bundle.siteModel.slug}`}>
                        Editor
                      </Link>
                      <Link className="button secondary" href={`/optimization/${bundle.siteModel.slug}`}>
                        Optimization
                      </Link>
                      <Link className="button secondary" href={`/analytics/${bundle.siteModel.slug}`}>
                        Analytics
                      </Link>
                      <Link className="button secondary" href={`/leads/${bundle.siteModel.slug}`}>
                        Leads
                      </Link>
                      <Link className="button secondary" href={`/domains/${bundle.siteModel.slug}`}>
                        Domains
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {sites.length === 0 ? <p className="muted">No generated sites yet.</p> : null}
      </section>
    </main>
  );
}
