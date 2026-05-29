import { repository } from "@/lib/repository";
import { requireAdminPageAccess } from "@/lib/page-access";

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
              <article key={campaign.id} className="finding-card">
                <span className="badge">{campaign.status}</span>
                <h3>{campaign.name}</h3>
                <p>
                  {campaign.channel.replace("_", " ")} · {new Date(campaign.createdAt).toLocaleDateString()}
                </p>
              </article>
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

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric-card">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}
