import Link from "next/link";
import { deriveSitePublicationReadiness } from "@/packages/site-platform";
import { siteCapabilityRepository } from "@/packages/site-capabilities";
import { sitePlatformRepository } from "@/packages/platform-data";
import { platformOperationsRepository } from "@/packages/platform-operations";
import { requireOwnerWorkspace } from "@/lib/owner-workspace";
import { WorkspaceMetric, WorkspacePageHeader, WorkspaceStatus, formatWorkspaceDate, humanize } from "@/components/OwnerWorkspaceUI";
import type { SiteAgentRun, SitePublicationReadiness, SiteVersion } from "@/packages/site-contracts";

export const dynamic = "force-dynamic";

export default async function WorkspaceHomePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const context = await requireOwnerWorkspace(slug, `/workspace/${slug}`);
  const [versions, runs, queue, inquiries, analytics, domains] = await Promise.all([
    sitePlatformRepository.listSiteVersions(context.site.id),
    sitePlatformRepository.listRecentAgentRuns({ siteId: context.site.id, limit: 8 }),
    sitePlatformRepository.listOperatorQueue(),
    siteCapabilityRepository.listInquiries(context.site.id),
    siteCapabilityRepository.analyticsSummary(context.site.id),
    platformOperationsRepository.listDomains(context.site.id)
  ]);
  const domainAttention = domains.find((domain) => domain.status === "attention_required");
  const candidate = versions.find((version) => version.status === "candidate");
  const readiness = candidate ? await deriveSitePublicationReadiness({ versionId: candidate.id, repository: sitePlatformRepository }) : undefined;
  const openQueue = queue.filter((item) => item.siteId === context.site.id && ["open", "in_review"].includes(item.status));
  const pendingProof = context.state.proof.filter((item) => item.status === "observed").length;
  const pendingRights = context.state.assets.filter((asset) => asset.activeForFutureBuilds && asset.rightsStatus === "reference_only").length;
  const replyInquiries = inquiries.filter((inquiry) => inquiry.status === "new" || inquiry.status === "needs_reply");
  const nextAction = deriveNextAction({ slug, candidate, readiness, runs, openQueue: openQueue.length, pendingProof, pendingRights, replyInquiries });
  const published = versions.find((version) => version.status === "published");

  return (
    <main className="workspace-page workspace-home-page">
      <WorkspacePageHeader
        eyebrow="Today"
        title={context.state.identity.name}
        description="Your website, customer interest, and the smallest useful next action—together in one place."
        actions={<>{context.site.publishedVersionId ? <a className="button secondary" href={`/sites/${slug}`} target="_blank" rel="noreferrer">Open live site</a> : null}<Link className="button primary" href={`/workspace/${slug}/website`}>Open website</Link></>}
      />

      {domainAttention ? (
        <section className="workspace-next-action is-attention" aria-label="Domain needs attention">
          <div className="workspace-next-action-index" aria-hidden="true">!</div>
          <div><span>Domain connection</span><h2>{domainAttention.hostname} needs to be re-verified</h2><p>The Lodesta URL remains available. Check the DNS records to restore custom-domain routing.</p></div>
          <Link className="button primary" href={`/workspace/${slug}/settings#domain`}>Review domain</Link>
        </section>
      ) : null}

      <section className={`workspace-next-action is-${nextAction.tone}`} aria-labelledby="workspace-next-action-title">
        <div className="workspace-next-action-index" aria-hidden="true">01</div>
        <div><span>Next best action</span><h2 id="workspace-next-action-title">{nextAction.title}</h2><p>{nextAction.description}</p></div>
        <Link className="button primary" href={nextAction.href}>{nextAction.label}</Link>
      </section>

      <section className="workspace-metric-grid" aria-label="Site summary">
        <WorkspaceMetric label="Live site" value={published ? `Version ${published.number}` : "Not live"} detail={published?.publishedAt ? `Published ${formatWorkspaceDate(published.publishedAt, false)}` : "Publish a verified candidate"} tone={published ? "positive" : "attention"} />
        <WorkspaceMetric label="Needs reply" value={replyInquiries.length} detail={`${inquiries.length} total inquir${inquiries.length === 1 ? "y" : "ies"}`} tone={replyInquiries.length ? "attention" : "default"} />
        <WorkspaceMetric label="Primary actions" value={analytics.primaryActions} detail="Calls, forms, and outbound actions" />
        <WorkspaceMetric label="Action rate" value={`${Math.round(analytics.actionRate * 100)}%`} detail={`${analytics.sessions} tracked session${analytics.sessions === 1 ? "" : "s"}`} />
      </section>

      <div className="workspace-home-grid">
        <section className="workspace-panel">
          <div className="workspace-panel-heading"><div><span>Site health</span><h2>Managed and accountable</h2></div><WorkspaceStatus tone={openQueue.length || pendingProof || pendingRights ? "attention" : "success"}>{openQueue.length || pendingProof || pendingRights ? "Attention" : "Healthy"}</WorkspaceStatus></div>
          <div className="workspace-health-list">
            <HealthRow label="Publication review" value={readiness?.status === "blocked" ? `${readiness.blockers.length} blocker${readiness.blockers.length === 1 ? "" : "s"}` : candidate ? "Ready" : "No candidate"} attention={readiness?.status === "blocked"} href={`/workspace/${slug}/website`} />
            <HealthRow label="Business confirmations" value={pendingProof ? `${pendingProof} pending` : "Current"} attention={pendingProof > 0} href={`/workspace/${slug}/business#proof-media`} />
            <HealthRow label="Image rights" value={pendingRights ? `${pendingRights} pending` : "Confirmed"} attention={pendingRights > 0} href={`/workspace/${slug}/business#proof-media`} />
            <HealthRow label="Custom domain" value="Manage" href={`/workspace/${slug}/settings#domain`} />
          </div>
        </section>

        <section className="workspace-panel">
          <div className="workspace-panel-heading"><div><span>Recent activity</span><h2>What Lodesta has done</h2></div><Link href={`/workspace/${slug}/website`}>History</Link></div>
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

function deriveNextAction(input: {
  slug: string;
  candidate?: SiteVersion;
  readiness?: SitePublicationReadiness;
  runs: SiteAgentRun[];
  openQueue: number;
  pendingProof: number;
  pendingRights: number;
  replyInquiries: Awaited<ReturnType<typeof siteCapabilityRepository.listInquiries>>;
}) {
  const base = `/workspace/${input.slug}`;
  const waiting = input.runs.find((run) => run.status === "needs_input");
  if (waiting) return {
    tone: "attention",
    title: "Your website update needs one answer",
    description: waiting.inputQuestion ?? "Answer Lodesta's question to continue the paused website change.",
    href: `${base}/website`,
    label: "Answer question"
  };
  if (input.readiness?.status === "blocked" || input.openQueue || input.pendingProof || input.pendingRights) return {
    tone: "attention", title: "Clear the items holding back your next publish", description: `${input.readiness?.blockers.length ?? input.openQueue + input.pendingProof + input.pendingRights} item${(input.readiness?.blockers.length ?? input.openQueue + input.pendingProof + input.pendingRights) === 1 ? " needs" : "s need"} a decision before the website can move forward.`, href: input.pendingProof || input.pendingRights ? `${base}/business` : `${base}/website`, label: "Review items"
  };
  const failed = input.runs.find((run) => run.status === "failed");
  if (failed) return { tone: "danger", title: "A website change needs another look", description: failed.failureReason ?? "The latest managed change did not finish verification.", href: `${base}/website`, label: "Review change" };
  if (input.candidate && input.readiness?.status === "ready") return { tone: "ready", title: "Your verified website update is ready", description: `Version ${input.candidate.number} passed its publication checks and is waiting for your approval.`, href: `${base}/website`, label: "Review and publish" };
  if (input.replyInquiries.length) {
    const inquiry = input.replyInquiries[0];
    return { tone: "attention", title: `${input.replyInquiries.length} customer inquir${input.replyInquiries.length === 1 ? "y is" : "ies are"} waiting`, description: inquiry.aiEnrichment?.summary ?? `${inquiry.contactName ?? "A potential customer"} contacted you through the website.`, href: `${base}/inbox?inquiry=${encodeURIComponent(inquiry.id)}`, label: "Open inbox" };
  }
  if (!input.candidate) return { tone: "ready", title: "Your site is current", description: "There are no blocked changes or unanswered website inquiries right now.", href: `${base}/results`, label: "View results" };
  return { tone: "ready", title: "Review your latest website work", description: "A candidate version is available for review in the website workspace.", href: `${base}/website`, label: "Open website" };
}
