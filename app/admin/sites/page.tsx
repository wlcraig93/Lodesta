import Link from "next/link";
import type { Metadata } from "next";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { requireAdminPageAccess } from "@/lib/page-access";
import { deriveSiteLifecycle, deriveSiteOwnership, siteLifecycleLabels, siteOwnershipLabels } from "@/lib/site-admin-status";
import { sitePlatformRepository } from "@/packages/platform-data";
import { platformOperationsRepository } from "@/packages/platform-operations";
import { formatProductDate, statusTone } from "@/lib/product-format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AdminSitesPage() {
  await requireAdminPageAccess("/admin/sites");
  const [sites, domains] = await Promise.all([
    sitePlatformRepository.listSites(),
    platformOperationsRepository.listDomains()
  ]);
  const [states, versions, recentRuns] = await Promise.all([
    sitePlatformRepository.getBusinessStatesByIds(sites.map((site) => site.businessId)),
    sitePlatformRepository.listSiteVersionsBySiteIds(sites.map((site) => site.id)),
    sitePlatformRepository.listRecentAgentRuns({ limit: 500 })
  ]);
  const statesByBusinessId = new Map(states.map((state) => [state.businessId, state]));
  const versionsBySiteId = new Map<string, typeof versions>();
  for (const version of versions) {
    const siteVersions = versionsBySiteId.get(version.siteId) ?? [];
    siteVersions.push(version);
    versionsBySiteId.set(version.siteId, siteVersions);
  }
  const latestRunBySiteId = new Map<string, (typeof recentRuns)[number]>();
  for (const run of recentRuns) {
    if (!latestRunBySiteId.has(run.siteId)) latestRunBySiteId.set(run.siteId, run);
  }
  const rows = sites.map((site) => {
    return {
      site,
      state: statesByBusinessId.get(site.businessId),
      versions: versionsBySiteId.get(site.id) ?? [],
      latestRun: latestRunBySiteId.get(site.id),
      domainAlert: domains.find((domain) => domain.siteId === site.id && (domain.status === "attention_required" || domain.executionFailureCount >= 3))
    };
  });
  const inventory = rows.map(({ site, state, versions, latestRun, domainAlert }) => {
    const candidateCount = versions.filter((version) => version.status === "candidate").length;
    return {
      site,
      state,
      versions,
      latestRun,
      domainAlert,
      candidateCount,
      lifecycle: deriveSiteLifecycle(site, versions, latestRun),
      ownership: deriveSiteOwnership(site),
      updatedLabel: formatProductDate(site.updatedAt)
    };
  });

  return <main className="admin-page">
    <AdminPageHeader eyebrow="Admin" title="Manage sites" description={`${inventory.length} site${inventory.length === 1 ? "" : "s"} across Lodesta`} actions={<Link className="button primary" href="/admin/sites/new">Create site</Link>} />
    <section className="admin-inventory-surface" aria-label="Site inventory">
      <div className="admin-inventory-toolbar">
        <div><strong>Site inventory</strong><span>Publication, ownership, and generation state</span></div>
        <span>{inventory.length} total</span>
      </div>
      <div className="admin-table-scroll">
        <table className="data-table admin-sites-table">
          <thead><tr><th>Business</th><th>Site status</th><th>Ownership</th><th>Latest generation</th><th>Updated</th><th>Actions</th></tr></thead>
          <tbody>{inventory.map(({ site, state, versions, latestRun, domainAlert, candidateCount, lifecycle, ownership, updatedLabel }) => (
            <tr key={site.id}>
              <td><strong>{state?.identity.name ?? site.slug}</strong><small>{site.slug} · {state?.identity.categories[0] ?? "local business"}</small></td>
              <td><span className={`badge is-${statusTone(lifecycle)}`}>{siteLifecycleLabels[lifecycle]}</span>{domainAlert ? <span className="badge is-attention">Domain alert</span> : null}<small>{site.publishedVersionId ? `Published version ${versions.find((version) => version.id === site.publishedVersionId)?.number ?? "?"}` : "Not published"} · {candidateCount} candidate{candidateCount === 1 ? "" : "s"}</small></td>
              <td><span className={`badge is-${statusTone(ownership)}`}>{siteOwnershipLabels[ownership]}</span><small>{site.ownerUserId ?? "No owner account"}</small></td>
              <td>{latestRun ? <><span className={`badge is-${statusTone(latestRun.status)}`}>{latestRun.status}</span><small>{latestRun.kind} · {latestRun.stage}</small></> : <span className="muted">No runs</span>}</td>
              <td>{updatedLabel}</td>
              <td>
                <div className="admin-row-actions">
                  <Link className="button primary compact" href={`/admin/sites/${site.slug}`}>Manage</Link>
                  <Link className="admin-row-link" href={`/workspace/${site.slug}`}>Workspace</Link>
                  {site.publishedVersionId ? <Link className="admin-row-link" href={`/sites/${site.slug}`} target="_blank" rel="noreferrer">Live</Link> : null}
                </div>
              </td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="admin-mobile-inventory">
        {inventory.map(({ site, state, versions, latestRun, domainAlert, candidateCount, lifecycle, ownership, updatedLabel }) => (
          <article key={site.id}>
            <div className="admin-mobile-inventory-heading">
              <div><strong>{state?.identity.name ?? site.slug}</strong><span>{site.slug} · {state?.identity.categories[0] ?? "local business"}</span></div>
              <span className={`badge is-${statusTone(lifecycle)}`}>{siteLifecycleLabels[lifecycle]}</span>
            </div>
            <div className="admin-mobile-inventory-summary">
              <span>Updated {updatedLabel}</span>
              <Link className="button primary" href={`/admin/sites/${site.slug}`}>Manage</Link>
            </div>
            <details>
              <summary>Details and actions</summary>
              <dl>
                <div><dt>Publication</dt><dd>{site.publishedVersionId ? `Version ${versions.find((version) => version.id === site.publishedVersionId)?.number ?? "?"} live` : "Not published"} · {candidateCount} candidate{candidateCount === 1 ? "" : "s"}{domainAlert ? " · Domain alert" : ""}</dd></div>
                <div><dt>Ownership</dt><dd>{siteOwnershipLabels[ownership]}</dd></div>
                <div><dt>Generation</dt><dd>{latestRun ? `${latestRun.status} · ${latestRun.kind} · ${latestRun.stage}` : "No runs"}</dd></div>
              </dl>
              <div className="button-row"><Link className="button secondary" href={`/workspace/${site.slug}`}>Workspace</Link>{site.publishedVersionId ? <Link className="button secondary" href={`/sites/${site.slug}`}>Live site</Link> : null}</div>
            </details>
          </article>
        ))}
      </div>
      {!inventory.length ? <div className="empty-admin-state"><p className="muted">No sites exist yet.</p><Link className="button primary" href="/admin/sites/new">Create site</Link></div> : null}
    </section>
  </main>;
}
