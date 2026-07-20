import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteVersionActions } from "@/components/SiteVersionActions";
import { requirePlatformSiteOwnerAccess } from "@/lib/page-access";
import { sitePlatformRepository } from "@/packages/platform-data";

export const dynamic = "force-dynamic";

export default async function VersionsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const site = await sitePlatformRepository.getSiteBySlug(slug);
  if (!site) notFound();
  await requirePlatformSiteOwnerAccess(site.id, `/versions/${slug}`);
  const [versions, state] = await Promise.all([sitePlatformRepository.listSiteVersions(site.id), sitePlatformRepository.getBusinessState(site.businessId)]);
  return <main className="admin-page owner-page"><header className="owner-page-header"><div><p className="owner-page-eyebrow">Version history</p><h1>{state?.identity.name ?? slug}</h1><p className="owner-page-lede">Every candidate and published release retains its exact source, facts, artifact, and runtime binding.</p></div><div className="button-row"><Link className="button secondary" href={`/dashboard/${slug}`}>Dashboard</Link><Link className="button primary" href={`/editor/${slug}`}>Workspace</Link></div></header><section className="panel"><div className="finding-list">{versions.map((version) => <article className="finding-card" key={version.id}><div className="section-heading-row"><div><span className={`badge status-${version.status}`}>{version.status}</span><h3>Version {version.number}</h3></div><small>{new Date(version.createdAt).toLocaleString()}</small></div><p>Artifact {version.artifactHash.slice(0, 28)} · workspace {version.workspaceRevisionId}</p><SiteVersionActions version={version} /></article>)}{!versions.length ? <p className="muted">No site versions exist yet.</p> : null}</div></section></main>;
}
