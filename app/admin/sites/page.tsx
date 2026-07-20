import Link from "next/link";
import type { Metadata } from "next";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { requireAdminPageAccess } from "@/lib/page-access";
import { sitePlatformRepository } from "@/packages/platform-data";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AdminSitesPage() {
  await requireAdminPageAccess("/admin/sites");
  const sites = await sitePlatformRepository.listSites();
  const rows = await Promise.all(sites.map(async (site) => {
    const [state, versions, runs] = await Promise.all([
      sitePlatformRepository.getBusinessState(site.businessId),
      sitePlatformRepository.listSiteVersions(site.id),
      sitePlatformRepository.listRecentAgentRuns({ siteId: site.id, limit: 1 })
    ]);
    return { site, state, versions, latestRun: runs[0] };
  }));

  return <main className="admin-page">
    <AdminPageHeader eyebrow="Operate" title="Managed sites" description={`${rows.length} site${rows.length === 1 ? "" : "s"} on the agentic V4 platform`} />
    <section className="panel">
      <table className="data-table">
        <thead><tr><th>Business</th><th>Release</th><th>Latest run</th><th>Updated</th><th>Actions</th></tr></thead>
        <tbody>{rows.map(({ site, state, versions, latestRun }) => {
          const candidateCount = versions.filter((version) => version.status === "candidate").length;
          return <tr key={site.id}>
            <td><strong>{state?.identity.name ?? site.slug}</strong><small>{site.slug} · {state?.vertical.id ?? "unclassified"}</small></td>
            <td><span className={`badge status-${site.status}`}>{site.status}</span><small>{site.publishedVersionId ? `Published version ${versions.find((version) => version.id === site.publishedVersionId)?.number ?? "?"}` : "Not published"} · {candidateCount} candidate{candidateCount === 1 ? "" : "s"}</small></td>
            <td>{latestRun ? <><span className={`badge status-${latestRun.status}`}>{latestRun.status}</span><small>{latestRun.kind} · {latestRun.stage}</small></> : <span className="muted">No runs</span>}</td>
            <td>{new Date(site.updatedAt).toLocaleString()}</td>
            <td><div className="button-row"><Link className="button primary" href={`/admin/sites/${site.slug}`}>Manage</Link><Link className="button secondary" href={`/editor/${site.slug}`}>Workspace</Link>{site.publishedVersionId ? <Link className="button secondary" href={`/sites/${site.slug}`}>Live</Link> : null}</div></td>
          </tr>;
        })}</tbody>
      </table>
      {!rows.length ? <p className="muted">No V4 sites exist yet.</p> : null}
    </section>
  </main>;
}
