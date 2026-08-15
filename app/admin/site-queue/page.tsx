import Link from "next/link";
import type { Metadata } from "next";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { requireAdminPageAccess } from "@/lib/page-access";
import { sitePlatformRepository } from "@/packages/platform-data";
import { statusTone } from "@/lib/product-format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AdminSiteCandidatesPage() {
  await requireAdminPageAccess("/admin/site-queue");
  const [sites, queue] = await Promise.all([
    sitePlatformRepository.listSites(),
    sitePlatformRepository.listOperatorQueue()
  ]);
  const versions = (await Promise.all(sites.map((site) => sitePlatformRepository.listSiteVersions(site.id)))).flat();
  const candidates = versions.filter((version) => version.status === "candidate");
  const siteById = new Map(sites.map((site) => [site.id, site]));
  const open = queue.filter((item) => item.status === "open" || item.status === "in_review");

  return <main className="admin-page">
    <AdminPageHeader eyebrow="Build" title="Website review" description={`${open.length} operator item${open.length === 1 ? "" : "s"} · ${candidates.length} candidate${candidates.length === 1 ? "" : "s"}`} />
    <section className="admin-workstream"><h2>Operator queue</h2><div className="finding-list">
      {open.map((item) => <article key={item.id} className="finding-card">
        <div className="button-row"><span className={`badge is-${statusTone(item.severity)}`}>{item.severity}</span><span className="badge">{item.reason.replaceAll("_", " ")}</span></div>
        <h3>{siteById.get(item.siteId)?.slug ?? item.siteId}</h3>
        <p>{item.findings[0] && typeof item.findings[0].message === "string" ? item.findings[0].message : `${item.findings.length} recorded finding${item.findings.length === 1 ? "" : "s"}`}</p>
        <Link className="button secondary" href={`/admin/site-queue/${item.id}`}>Review</Link>
      </article>)}
      {open.length === 0 ? <p className="muted">No failed candidates or operational reviews need attention.</p> : null}
    </div></section>
    <section className="admin-workstream"><h2>Reviewable candidates</h2><div className="finding-list">
      {candidates.map((version) => <article key={version.id} className="finding-card">
        <div className="button-row"><span className="badge">Version {version.number}</span><span className="badge is-success">QA passed</span></div>
        <h3>{siteById.get(version.siteId)?.slug ?? version.siteId}</h3>
        <p>Immutable artifact {version.artifactHash.slice(0, 20)}…</p>
        <Link className="button primary" href={`/admin/site-queue/${version.id}`}>Open candidate</Link>
      </article>)}
      {candidates.length === 0 ? <p className="muted">No candidate versions are waiting.</p> : null}
    </div></section>
  </main>;
}
