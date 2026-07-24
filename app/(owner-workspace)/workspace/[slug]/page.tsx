import Link from "next/link";
import { deriveSitePublicationReadiness } from "@/packages/site-platform";
import { siteCapabilityRepository } from "@/packages/site-capabilities";
import { sitePlatformRepository } from "@/packages/platform-data";
import { platformOperationsRepository } from "@/packages/platform-operations";
import { requireOwnerWorkspace } from "@/lib/owner-workspace";
import { deriveOwnerSiteLifecycle } from "@/lib/owner-site-lifecycle";
import { parseAnalyticsQuery } from "@/lib/analytics-query";
import { WorkspaceMetric, WorkspacePageHeader, WorkspaceStatus } from "@/components/OwnerWorkspaceUI";
import { formatProductDate, humanize } from "@/lib/product-format";

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
  const now = domainAttention
    ? {
        eyebrow: "Domain connection",
        title: `${domainAttention.hostname} needs to be re-verified`,
        detail: "The Lodesta URL remains available. Check the DNS records to restore custom-domain routing.",
        href: `/workspace/${slug}/settings#domain`,
        actionLabel: "Review domain",
        label: "Needs attention",
        tone: "attention" as const
      }
    : {
        eyebrow: "Next best action",
        title: lifecycle.title,
        detail: lifecycle.detail,
        href: lifecycle.nextAction.href,
        actionLabel: lifecycle.nextAction.label,
        label: lifecycle.label,
        tone: lifecycle.tone
      };
  const editorHref = `/workspace/${slug}/editor`;
  const statusDetail = published
    ? `Version ${published.number} published`
    : candidate
      ? `Version ${candidate.number} in review`
      : "No version published yet";

  return (
    <main className="workspace-page workspace-home-page">
      <WorkspacePageHeader
        eyebrow="Website"
        title={context.state.identity.name}
        description="Your website, customer interest, and the smallest useful next action—together in one place."
        actions={<>{context.site.publishedVersionId ? <a className="button secondary" href={`/sites/${slug}`} target="_blank" rel="noreferrer">Open live site</a> : null}{now.href === editorHref ? null : <Link className="button primary" href={editorHref}>Open editor</Link>}</>}
      />

      <section className={`workspace-now is-${now.tone}`} aria-labelledby="workspace-now-title">
        <div className="workspace-now-kicker"><span>{now.eyebrow}</span><WorkspaceStatus tone={now.tone}>{now.label}</WorkspaceStatus></div>
        <div className="workspace-now-copy"><h2 id="workspace-now-title">{now.title}</h2><p>{now.detail}</p></div>
        <Link className="button primary" href={now.href}>{now.actionLabel}</Link>
      </section>

      <section className="workspace-metric-grid workspace-metric-strip" aria-label="Site summary">
        <WorkspaceMetric label="Website status" value={lifecycle.label} detail={statusDetail} tone={lifecycle.tone === "attention" ? "attention" : lifecycle.tone === "success" ? "positive" : "default"} />
        <WorkspaceMetric label="Needs reply" value={replyInquiries.length} detail={`${inquiries.length} total inquir${inquiries.length === 1 ? "y" : "ies"}`} tone={replyInquiries.length ? "attention" : "default"} />
        <WorkspaceMetric label="Customer actions" value={analytics.current.customerActions} detail="Calls, forms, directions, and bookings" />
        <WorkspaceMetric label="Action rate" value={`${Math.round(analytics.current.actionRate * 100)}%`} detail={`${analytics.current.visits} visit${analytics.current.visits === 1 ? "" : "s"} in 30 days`} />
      </section>

      <div className="workspace-home-grid">
        <section className="workspace-home-section">
          <div className="workspace-panel-heading"><div><span>Website readiness</span><h2>Publication and business details</h2></div><WorkspaceStatus tone={lifecycle.tone}>{lifecycle.label}</WorkspaceStatus></div>
          <div className="workspace-health-list">
            <HealthRow label="Publication review" value={readiness?.status === "blocked" ? `${readiness.blockers.length} requirement${readiness.blockers.length === 1 ? "" : "s"}` : candidate ? "Ready to publish" : published ? "Published" : "Building"} attention={readiness?.status === "blocked"} href={`/workspace/${slug}/editor`} />
            <HealthRow label="Business confirmations" value={pendingProof ? `${pendingProof} pending` : "Current"} attention={pendingProof > 0} href={`/workspace/${slug}/business-details#proof-media`} />
            <HealthRow label="Media library" value={`${context.state.assets.filter((asset) => asset.activeForFutureBuilds).length} active`} href={`/workspace/${slug}/business-details#proof-media`} />
            <HealthRow label="Custom domain" value="Manage" href={`/workspace/${slug}/settings#domain`} />
          </div>
        </section>

        <section className="workspace-home-section">
          <div className="workspace-panel-heading"><div><span>Recent activity</span><h2>What Lodesta has done</h2></div><Link href={`/workspace/${slug}/editor`}>History</Link></div>
          <div className="workspace-activity-list">
            {runs.slice(0, 5).map((run) => <article key={run.id}><span className={`workspace-activity-dot is-${run.status}`} /><div><strong>{humanize(run.kind)}</strong><p>{humanize(run.stage)} · {formatProductDate(run.startedAt)}</p></div><WorkspaceStatus tone={run.status === "failed" ? "danger" : run.status === "succeeded" ? "success" : "info"}>{humanize(run.status)}</WorkspaceStatus></article>)}
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
