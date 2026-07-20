import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformSiteOwnerAccess } from "@/lib/page-access";
import { sitePlatformRepository } from "@/packages/platform-data";

export const dynamic = "force-dynamic";

export default async function ManagedStatusPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const site = await sitePlatformRepository.getSiteBySlug(slug);
  if (!site) notFound();
  await requirePlatformSiteOwnerAccess(site.id, `/status/${slug}`);
  const [state, versions, runs, queue] = await Promise.all([
    sitePlatformRepository.getBusinessState(site.businessId), sitePlatformRepository.listSiteVersions(site.id),
    sitePlatformRepository.listRecentAgentRuns({ siteId: site.id, limit: 12 }), sitePlatformRepository.listOperatorQueue()
  ]);
  if (!state) notFound();
  const openQueue = queue.filter((item) => item.siteId === site.id && (item.status === "open" || item.status === "in_review"));
  const published = versions.find((version) => version.status === "published");
  const latest = runs[0];
  const pendingProof = state.proof.filter((item) => item.status === "observed").length;
  const unresolvedAssets = state.assets.filter((asset) => asset.activeForFutureBuilds && asset.rightsStatus === "reference_only").length;
  return <main className="admin-page owner-page"><header className="owner-page-header"><div><p className="owner-page-eyebrow">Managed site status</p><h1>{state.identity.name}</h1><p className="owner-page-lede">Canonical data, build verification, review, and publish state for this website.</p></div><div className="button-row"><Link className="button secondary" href={`/business/${slug}`}>Business data</Link><Link className="button primary" href={`/editor/${slug}`}>Workspace</Link></div></header>
    <section className="metric-row"><Metric label="Publish" value={published ? `Version ${published.number}` : "Not live"} /><Metric label="Latest run" value={latest?.status ?? "None"} /><Metric label="Proof confirmations" value={pendingProof} /><Metric label="Rights confirmations" value={unresolvedAssets} /></section>
    <div className="admin-grid"><section className="panel"><h2>Current blockers</h2><div className="finding-list">{openQueue.map((item) => <article className="finding-card" key={item.id}><span className={`badge status-${item.severity}`}>{item.reason.replaceAll("_", " ")}</span><p>{typeof item.findings[0]?.message === "string" ? item.findings[0].message : `${item.findings.length} findings require operator review.`}</p></article>)}{pendingProof ? <article className="finding-card"><span className="badge">confirmation</span><p>{pendingProof} proof item{pendingProof === 1 ? "" : "s"} remain private until confirmed.</p><Link className="button secondary" href={`/business/${slug}`}>Review proof</Link></article> : null}{unresolvedAssets ? <article className="finding-card"><span className="badge">asset rights</span><p>{unresolvedAssets} active source asset{unresolvedAssets === 1 ? "" : "s"} must be confirmed before publication.</p><Link className="button secondary" href={`/business/${slug}`}>Review assets</Link></article> : null}{!openQueue.length && !pendingProof && !unresolvedAssets ? <p className="muted">No current blockers.</p> : null}</div></section>
      <aside className="panel"><h2>Recent activity</h2><div className="timeline-list">{runs.map((run) => <article className="timeline-item" key={run.id}><span className={`badge status-${run.status}`}>{run.status}</span><div><strong>{run.kind.replaceAll("_", " ")}</strong><small>{run.stage} · {new Date(run.startedAt).toLocaleString()}</small></div></article>)}{!runs.length ? <p className="muted">No manager runs yet.</p> : null}</div></aside></div>
  </main>;
}

function Metric({ label, value }: { label: string; value: string | number }) { return <div className="metric-card"><strong>{value}</strong><span>{label}</span></div>; }
