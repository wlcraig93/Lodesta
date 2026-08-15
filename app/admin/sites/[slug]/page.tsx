import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { requireAdminPageAccess } from "@/lib/page-access";
import { deriveSiteLifecycle, deriveSiteOwnership, siteLifecycleLabels, siteOwnershipLabels } from "@/lib/site-admin-status";
import { sitePlatformRepository } from "@/packages/platform-data";
import { formatProductDate, statusTone } from "@/lib/product-format";
import { websiteSourceSnapshotPayloadSchema } from "@/packages/site-contracts";
import { SourceRecaptureButton } from "@/components/admin/SourceRecaptureButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AdminSitePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireAdminPageAccess(`/admin/sites/${slug}`);
  const site = await sitePlatformRepository.getSiteBySlug(slug);
  if (!site) notFound();
  const [state, intent, versions, runs, changes, queue] = await Promise.all([
    sitePlatformRepository.getBusinessState(site.businessId),
    sitePlatformRepository.getSiteIntent(site.id),
    sitePlatformRepository.listSiteVersions(site.id),
    sitePlatformRepository.listRecentAgentRuns({ siteId: site.id, limit: 20 }),
    sitePlatformRepository.listControlPlaneChangeRequests(site.id),
    sitePlatformRepository.listOperatorQueue()
  ]);
  const openQueue = queue.filter((item) => item.siteId === site.id && (item.status === "open" || item.status === "in_review"));
  const published = versions.find((version) => version.status === "published");
  const candidates = versions.filter((version) => version.status === "candidate");
  const lifecycle = deriveSiteLifecycle(site, versions, runs[0]);
  const ownership = deriveSiteOwnership(site);
  const publicBuildInput = site.currentPublicBuildInputId
    ? await sitePlatformRepository.getPublicBuildInput(site.currentPublicBuildInputId)
    : undefined;
  const sourceSnapshots = await Promise.all((publicBuildInput?.sourceSnapshotIds ?? []).map((id) => sitePlatformRepository.getSourceSnapshot(id)));
  const crawl = sourceSnapshots
    .flatMap((snapshot) => {
      if (!snapshot) return [];
      const parsed = websiteSourceSnapshotPayloadSchema.safeParse(snapshot.payload);
      return parsed.success ? [{ snapshot, payload: parsed.data }] : [];
    })
    .sort((left, right) => right.snapshot.capturedAt.localeCompare(left.snapshot.capturedAt))[0];
  const [crawlResources, crawlPages] = crawl ? await Promise.all([
    sitePlatformRepository.listSourceSnapshotResources(crawl.snapshot.id),
    sitePlatformRepository.listSourceSnapshotPages(crawl.snapshot.id)
  ]) : [[], []];
  const rawBytes = crawlResources.reduce((total, resource) => total + resource.rawBytes, 0);
  const storedBytes = crawlResources.reduce((total, resource) => total + resource.storedBytes, 0);
  return <main className="admin-page">
    <AdminPageHeader eyebrow="Manage site" title={state?.identity.name ?? slug} description={`${site.id} · ${state?.identity.categories[0] ?? "local business"}`} actions={<div className="button-row"><Link className="button secondary" href="/admin/sites">Manage sites</Link><Link className="button primary" href={`/workspace/${slug}`}>Workspace</Link>{published ? <Link className="button secondary" href={`/sites/${slug}`}>Live site</Link> : null}</div>} />
    <section className="metric-row"><Metric label="Site status" value={siteLifecycleLabels[lifecycle]} /><Metric label="Ownership" value={siteOwnershipLabels[ownership]} /><Metric label="Latest generation" value={runs[0]?.status ?? "Not started"} /><Metric label="Open review" value={openQueue.length} /></section>
    <section className="panel"><div className="section-heading-row"><div><h2>Site tools</h2><p className="muted">Open the canonical owner surface for this site.</p></div></div><div className="button-row"><Link className="button secondary" href={`/workspace/${slug}`}>Overview</Link><Link className="button secondary" href={`/workspace/${slug}/editor`}>Editor</Link><Link className="button secondary" href={`/workspace/${slug}/leads`}>Leads</Link><Link className="button secondary" href={`/workspace/${slug}/analytics`}>Analytics</Link><Link className="button secondary" href={`/workspace/${slug}/business-details`}>Business details</Link><Link className="button secondary" href={`/workspace/${slug}/settings`}>Settings</Link></div></section>
    <section className="panel"><div className="section-heading-row"><div><h2>Source mirror</h2><p className="muted">Replayable response capture and page-level search telemetry for the current authoring input.</p></div><div className="button-row">{crawl ? <><span className={`badge is-${crawl.payload.coverage === "complete" ? "success" : "warning"}`}>{crawl.payload.coverage}</span><Link className="button secondary" href={`/admin/source-snapshots/${crawl.snapshot.id}`}>Inspect mirror</Link></> : null}{site.sourceUrl ? <SourceRecaptureButton siteId={site.id} /> : null}</div></div>{crawl ? <dl className="detail-list"><dt>Captured</dt><dd>{formatProductDate(crawl.snapshot.capturedAt)}</dd><dt>Documents discovered</dt><dd>{crawl.payload.counts.documentsDiscovered}</dd><dt>Documents eligible</dt><dd>{crawl.payload.counts.documentsEligible}</dd><dt>Documents fetched</dt><dd>{crawl.payload.counts.documentsFetched}</dd><dt>Documents excluded</dt><dd>{crawl.payload.counts.documentsExcluded}</dd><dt>Documents failed</dt><dd>{crawl.payload.counts.documentsFailed}</dd><dt>Documents unfinished</dt><dd>{crawl.payload.counts.documentsUnfinished}</dd><dt>Retained resources</dt><dd>{crawlResources.length}</dd><dt>Indexed pages</dt><dd>{crawlPages.length}</dd><dt>Raw / stored bytes</dt><dd>{rawBytes.toLocaleString()} / {storedBytes.toLocaleString()}</dd></dl> : <p className="muted">No website mirror is attached to the current authoring input.</p>}</section>
    <div className="admin-grid">
      <section className="panel"><h2>Versions</h2><div className="finding-list">{versions.map((version) => <article className="finding-card" key={version.id}><div className="button-row"><span className={`badge is-${statusTone(version.status)}`}>{version.status}</span><span>Version {version.number}</span></div><p>{version.artifactHash.slice(0, 28)}</p><Link className="button secondary" href={`/api/site-versions/${version.id}/artifact/`}>Open artifact</Link></article>)}{!versions.length ? <p className="muted">No versions yet.</p> : null}</div></section>
      <aside className="panel"><h2>Business authority</h2><dl className="detail-list"><dt>Owner user ID</dt><dd>{site.ownerUserId ?? "Unowned"}</dd><dt>Phone</dt><dd>{state?.contacts.phone ?? "Not recorded"}</dd><dt>Email</dt><dd>{state?.contacts.email ?? "Not recorded"}</dd><dt>Offerings</dt><dd>{state?.offerings.length ?? 0}</dd><dt>State revision</dt><dd>{state?.revision ?? "-"}</dd><dt>Intent revision</dt><dd>{intent?.revision ?? "-"}</dd><dt>Candidate versions</dt><dd>{candidates.length}</dd></dl></aside>
    </div>
    <section className="panel"><h2>Operator queue</h2><div className="finding-list">{openQueue.map((item) => <article className="finding-card" key={item.id}><span className={`badge is-${statusTone(item.severity)}`}>{item.reason.replaceAll("_", " ")}</span><p>{typeof item.findings[0]?.message === "string" ? item.findings[0].message : `${item.findings.length} findings`}</p><Link className="button secondary" href={`/admin/site-queue/${item.id}`}>Review</Link></article>)}{!openQueue.length ? <p className="muted">No operator action required.</p> : null}</div></section>
    <div className="admin-grid"><section className="panel"><h2>Recent runs</h2><div className="timeline-list">{runs.map((run) => <article className="timeline-item" key={run.id}><span className={`badge is-${statusTone(run.status)}`}>{run.status}</span><div><Link href={`/admin/runs/${run.id}`}>{run.kind.replaceAll("_", " ")}</Link><small>{run.stage} · {formatProductDate(run.startedAt)}</small></div></article>)}{!runs.length ? <p className="muted">No runs yet.</p> : null}</div></section><section className="panel"><h2>Control-plane changes</h2><div className="timeline-list">{changes.slice(0, 20).map((change) => <article className="timeline-item" key={change.id}><span className={`badge is-${statusTone(change.status)}`}>{change.status}</span><div><strong>{change.payload.kind.replaceAll("_", " ")}</strong><small>{change.targetAuthority} · revision {change.expectedBusinessRevision}/{change.expectedIntentRevision}</small></div></article>)}{!changes.length ? <p className="muted">No changes recorded.</p> : null}</div></section></div>
  </main>;
}

function Metric({ label, value }: { label: string; value: string | number }) { return <div className="metric-card"><strong>{value}</strong><span>{label}</span></div>; }
