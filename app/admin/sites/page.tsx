import Link from "next/link";
import type { Metadata } from "next";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { requireAdminPageAccess } from "@/lib/page-access";
import { deriveSiteLifecycle, deriveSiteOwnership, siteLifecycleLabels, siteOwnershipLabels } from "@/lib/site-admin-status";
import { sitePlatformRepository } from "@/packages/platform-data";
import { platformOperationsRepository } from "@/packages/platform-operations";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AdminSitesPage() {
  await requireAdminPageAccess("/admin/sites");
  const [sites, claims] = await Promise.all([
    sitePlatformRepository.listSites(),
    platformOperationsRepository.listClaims()
  ]);
  const rows = await Promise.all(sites.map(async (site) => {
    const [state, versions, runs] = await Promise.all([
      sitePlatformRepository.getBusinessState(site.businessId),
      sitePlatformRepository.listSiteVersions(site.id),
      sitePlatformRepository.listRecentAgentRuns({ siteId: site.id, limit: 1 })
    ]);
    return { site, state, versions, latestRun: runs[0], claims: claims.filter((claim) => claim.siteId === site.id) };
  }));

  return <main className="admin-page">
    <AdminPageHeader eyebrow="Admin" title="Manage sites" description={`${rows.length} site${rows.length === 1 ? "" : "s"} across Lodesta`} actions={<Link className="button primary" href="/admin/sites/new">Create site</Link>} />
    <section className="panel">
      <table className="data-table">
        <thead><tr><th>Business</th><th>Site status</th><th>Ownership</th><th>Latest generation</th><th>Updated</th><th>Actions</th></tr></thead>
        <tbody>{rows.map(({ site, state, versions, latestRun, claims: siteClaims }) => {
          const candidateCount = versions.filter((version) => version.status === "candidate").length;
          const lifecycle = deriveSiteLifecycle(site, versions, latestRun);
          const ownership = deriveSiteOwnership(siteClaims);
          return <tr key={site.id}>
            <td><strong>{state?.identity.name ?? site.slug}</strong><small>{site.slug} · {state?.identity.categories[0] ?? "local business"}</small></td>
            <td><span className={`badge status-${lifecycle}`}>{siteLifecycleLabels[lifecycle]}</span><small>{site.publishedVersionId ? `Published version ${versions.find((version) => version.id === site.publishedVersionId)?.number ?? "?"}` : "Not published"} · {candidateCount} candidate{candidateCount === 1 ? "" : "s"}</small></td>
            <td><span className={`badge status-${ownership}`}>{siteOwnershipLabels[ownership]}</span><small>{siteClaims.find((claim) => claim.status === "claimed")?.ownerEmail ?? siteClaims[0]?.ownerEmail ?? "No owner account"}</small></td>
            <td>{latestRun ? <><span className={`badge status-${latestRun.status}`}>{latestRun.status}</span><small>{latestRun.kind} · {latestRun.stage}</small></> : <span className="muted">No runs</span>}</td>
            <td>{new Date(site.updatedAt).toLocaleString()}</td>
            <td><div className="button-row"><Link className="button primary" href={`/admin/sites/${site.slug}`}>Manage</Link><Link className="button secondary" href={`/workspace/${site.slug}`}>Workspace</Link>{site.publishedVersionId ? <Link className="button secondary" href={`/sites/${site.slug}`}>Live</Link> : null}</div></td>
          </tr>;
        })}</tbody>
      </table>
      {!rows.length ? <div className="empty-admin-state"><p className="muted">No sites exist yet.</p><Link className="button primary" href="/admin/sites/new">Create site</Link></div> : null}
    </section>
  </main>;
}
