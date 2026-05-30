import { repository } from "@/lib/repository";
import { requireAdminPageAccess } from "@/lib/page-access";
import { outboundComplianceStatus } from "@/lib/outbound";

export const dynamic = "force-dynamic";

export default async function OutboundPage() {
  await requireAdminPageAccess("/outbound");
  const [summary, campaigns, prospects, events] = await Promise.all([
    repository.outboundSummary(),
    repository.listOutboundCampaigns(),
    repository.listOutboundProspects(),
    repository.listOutboundEvents()
  ]);

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <span className="badge">Outbound wedge</span>
          <h1>Campaign Measurement</h1>
          <p>Track direct-mail and outbound preview tests from mailer sent through claim, publish, credibility feedback, and support burden.</p>
        </div>
        <div className="button-row">
          <a className="button secondary" href="/api/outbound/export">
            Export manifest
          </a>
          <a className="button primary" href="/api/outbound/export?format=csv">
            Export CSV
          </a>
        </div>
      </header>

      <section className="metric-row">
        <Metric label="Prospects" value={summary.prospects} />
        <Metric label="Preview rate" value={`${Math.round(summary.mailerToPreviewRate * 100)}%`} />
        <Metric label="Claim rate" value={`${Math.round(summary.mailerToClaimRate * 100)}%`} />
        <Metric label="Publish rate" value={`${Math.round(summary.claimToPublishRate * 100)}%`} />
      </section>

      <section className="metric-row">
        <Metric label="Published" value={summary.published} />
        <Metric label="Support burden" value={`${Math.round(summary.supportBurdenRate * 100)}%`} />
        <Metric label="Credibility samples" value={summary.credibilityFeedbackCount} />
        <Metric label="Avg credibility" value={summary.avgCredibilityScore ?? "--"} />
      </section>

      <div className="admin-grid">
        <section className="panel">
          <h2>Campaigns</h2>
          <div className="finding-list">
            {campaigns.map((campaign) => (
              <CampaignCard key={campaign.id} campaign={campaign} />
            ))}
            {campaigns.length === 0 ? <p>No outbound campaigns have been created yet.</p> : null}
          </div>
        </section>

        <section className="panel">
          <h2>Prospects</h2>
          <div className="finding-list">
            {prospects.slice(0, 8).map((prospect) => (
              <article key={prospect.id} className="finding-card">
                <span className="badge">{prospect.status.replace("_", " ")}</span>
                <h3>{prospect.businessName}</h3>
                <p>
                  {prospect.vertical ?? "unknown vertical"} · {prospect.previewToken ? "preview linked" : "no preview token"}
                </p>
              </article>
            ))}
            {prospects.length === 0 ? <p>No outbound prospects have been added yet.</p> : null}
          </div>
        </section>

        <aside className="panel">
          <h2>Vertical Response</h2>
          <div className="finding-list">
            {summary.verticalBreakdown.map((item) => (
              <article key={item.vertical} className="finding-card">
                <span className="badge">{item.vertical.replace("_", " ")}</span>
                <h3>{Math.round(item.mailerToClaimRate * 100)}% mailer-to-claim</h3>
                <p>
                  {item.prospects} prospects · {item.claimed} claimed · {item.published} published
                </p>
              </article>
            ))}
            {events.length ? <p>{events.length} outbound events recorded.</p> : null}
          </div>
        </aside>
      </div>
    </main>
  );
}

function CampaignCard({
  campaign
}: {
  campaign: Awaited<ReturnType<typeof repository.listOutboundCampaigns>>[number];
}) {
  const compliance = outboundComplianceStatus(campaign);
  return (
    <article className="finding-card">
      <span className="badge">{campaign.status}</span>
      <h3>{campaign.name}</h3>
      <p>
        {campaign.channel.replace("_", " ")} · {new Date(campaign.createdAt).toLocaleDateString()}
      </p>
      {compliance.highVolume ? (
        <small className="muted">
          {compliance.reviewed ? "Legal/IP review recorded" : "Legal/IP review required before running"} ·{" "}
          {compliance.plannedRecipients ?? compliance.threshold}+ recipients
        </small>
      ) : null}
      <div className="button-row">
        <a className="button secondary" href={`/api/outbound/export?campaignId=${encodeURIComponent(campaign.id)}`}>
          Manifest
        </a>
        <a className="button secondary" href={`/api/outbound/export?campaignId=${encodeURIComponent(campaign.id)}&format=csv`}>
          CSV
        </a>
      </div>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric-card">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
