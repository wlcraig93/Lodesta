import Link from "next/link";
import { deriveSitePublicationReadiness } from "@/packages/site-platform";
import { siteCapabilityRepository } from "@/packages/site-capabilities";
import { sitePlatformRepository } from "@/packages/platform-data";
import { platformOperationsRepository } from "@/packages/platform-operations";
import { requireOwnerWorkspace } from "@/lib/owner-workspace";
import { deriveOwnerSiteLifecycle } from "@/lib/owner-site-lifecycle";
import { parseAnalyticsQuery } from "@/lib/analytics-query";
import { WorkspaceMetric, WorkspacePageHeader, WorkspaceStatus, formatWorkspaceDate, humanize } from "@/components/OwnerWorkspaceUI";

export const dynamic = "force-dynamic";

export default async function WorkspaceHomePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const context = await requireOwnerWorkspace(slug, `/workspace/${slug}`);
  const publishedVersion = context.site.publishedVersionId
    ? await sitePlatformRepository.getSiteVersion(context.site.publishedVersionId)
    : undefined;
  const [versions, runs, queue, inquiries, analytics, domains] = await Promise.all([
    sitePlatformRepository.listSiteVersions(context.site.id),
    sitePlatformRepository.listRecentAgentRuns({ siteId: context.site.id, limit: 8 }),
    sitePlatformRepository.listOperatorQueue(),
    siteCapabilityRepository.listInquiries(context.site.id),
    siteCapabilityRepository.analyticsReport(context.site.id, parseAnalyticsQuery({}, {
      timezone: context.site.reportingTimezone,
      siteCreatedAt: publishedVersion?.publishedAt ?? context.site.createdAt
    })),
    platformOperationsRepository.listDomains(context.site.id)
  ]);
  const domainAttention = domains.find((domain) => domain.status === "attention_required");
  const candidate = versions.find((version) => version.status === "candidate");
  const readiness = candidate ? await deriveSitePublicationReadiness({ versionId: candidate.id, repository: sitePlatformRepository }) : undefined;
  const openQueue = queue.filter((item) => item.siteId === context.site.id && ["open", "in_review"].includes(item.status));
  const pendingProof = context.state.proof.filter((item) => item.status === "observed").length;
  const replyInquiries = inquiries.filter((inquiry) => inquiry.status === "new" || inquiry.status === "needs_reply");
  const published = versions.find((version) => version.status === "published");
  const lifecycle = deriveOwnerSiteLifecycle({
    slug,
    site: context.site,
    versions,
    runs,
    readiness,
    attention: {
      operatorItems: openQueue.length,
      pendingProof,
      replyInquiries: replyInquiries.length,
      domainAttention: Boolean(domainAttention)
    }
  });

  return (
    <main className="workspace-page workspace-home-page">
      <WorkspacePageHeader
        eyebrow="Today"
        title={context.state.identity.name}
        description="Your website, customer interest, and the smallest useful next action—together in one place."
        actions={<>{context.site.publishedVersionId ? <a className="button secondary" href={`/sites/${slug}`} target="_blank" rel="noreferrer">Open live site</a> : null}<Link className="button primary" href={`/workspace/${slug}/editor`}>Open editor</Link></>}
      />

      {domainAttention ? (
        <section className="workspace-next-action is-attention" aria-label="Domain needs attention">
          <div className="workspace-next-action-index" aria-hidden="true">!</div>
          <div><span>Domain connection</span><h2>{domainAttention.hostname} needs to be re-verified</h2><p>The Lodesta URL remains available. Check the DNS records to restore custom-domain routing.</p></div>
          <Link className="button primary" href={`/workspace/${slug}/settings#domain`}>Review domain</Link>
        </section>
      ) : null}

      <section className={`workspace-next-action is-${lifecycle.tone}`} aria-labelledby="workspace-next-action-title">
        <div className="workspace-next-action-index" aria-hidden="true">01</div>
        <div><span>Next best action</span><h2 id="workspace-next-action-title">{lifecycle.title}</h2><p>{lifecycle.detail}</p></div>
        <Link className="button primary" href={lifecycle.nextAction.href}>{lifecycle.nextAction.label}</Link>
      </section>

      <section className="workspace-metric-grid" aria-label="Site summary">
        <WorkspaceMetric label="Website status" value={lifecycle.label} detail={lifecycle.detail} tone={lifecycle.tone === "attention" ? "attention" : lifecycle.tone === "success" ? "positive" : "default"} />
        <WorkspaceMetric label="Needs reply" value={replyInquiries.length} detail={`${inquiries.length} total inquir${inquiries.length === 1 ? "y" : "ies"}`} tone={replyInquiries.length ? "attention" : "default"} />
        <WorkspaceMetric label="Customer actions" value={analytics.current.customerActions} detail="Calls, forms, directions, bookings, and orders" />
        <WorkspaceMetric label="Action rate" value={`${Math.round(analytics.current.actionRate * 100)}%`} detail={`${analytics.current.visits} visit${analytics.current.visits === 1 ? "" : "s"} in 30 days`} />
      </section>

      <div className="workspace-home-grid">
        <section className="workspace-panel">
          <div className="workspace-panel-heading"><div><span>Website readiness</span><h2>Publication and business details</h2></div><WorkspaceStatus tone={lifecycle.tone}>{lifecycle.label}</WorkspaceStatus></div>
          <div className="workspace-health-list">
            <HealthRow label="Publication review" value={readiness?.status === "blocked" ? `${readiness.blockers.length} requirement${readiness.blockers.length === 1 ? "" : "s"}` : candidate ? "Ready to publish" : published ? "Published" : "Building"} attention={readiness?.status === "blocked"} href={`/workspace/${slug}/editor`} />
            <HealthRow label="Business confirmations" value={pendingProof ? `${pendingProof} pending` : "Current"} attention={pendingProof > 0} href={`/workspace/${slug}/business-details#proof-media`} />
            <HealthRow label="Media library" value={`${context.state.assets.filter((asset) => asset.activeForFutureBuilds).length} active`} href={`/workspace/${slug}/business-details#proof-media`} />
            <HealthRow label="Custom domain" value="Manage" href={`/workspace/${slug}/settings#domain`} />
          </div>
        </section>

        <section className="workspace-panel">
          <div className="workspace-panel-heading"><div><span>Recent activity</span><h2>What Lodesta has done</h2></div><Link href={`/workspace/${slug}/editor`}>History</Link></div>
          <div className="workspace-activity-list">
            {runs.slice(0, 5).map((run) => <article key={run.id}><span className={`workspace-activity-dot is-${run.status}`} /><div><strong>{humanize(run.kind)}</strong><p>{humanize(run.stage)} · {formatWorkspaceDate(run.startedAt)}</p></div><WorkspaceStatus tone={run.status === "failed" ? "danger" : run.status === "succeeded" ? "success" : "info"}>{humanize(run.status)}</WorkspaceStatus></article>)}
            {!runs.length ? <div className="workspace-empty-state"><strong>No managed activity yet</strong><p>Your website changes and verification runs will appear here.</p></div> : null}
          </div>
        </section>
      </div>
    </main>
  );
}

function HealthRow({ label, value, attention = false, href }: { label: string; value: string; attention?: boolean; href: string }) {
  return <Link href={href}><span>{label}</span><strong className={attention ? "is-attention" : ""}>{value}</strong><span aria-hidden="true">→</span></Link>;
}
