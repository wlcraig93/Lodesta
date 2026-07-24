import { AdminButtonAnchor, AdminButtonRow } from "@/components/admin/AdminButton";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { platformOperationsRepository as repository } from "@/packages/platform-operations";
import { requireAdminPageAccess } from "@/lib/page-access";
import { outboundComplianceStatus } from "@/packages/acquisition/outbound";
import { formatProductDate } from "@/lib/product-format";

export const dynamic = "force-dynamic";

export default async function OutboundPage() {
  await requireAdminPageAccess("/outbound");
  const [summary, campaigns, prospects, events, reports] = await Promise.all([
    repository.outboundSummary(),
    repository.listOutboundCampaigns(),
    repository.listOutboundProspects(),
    repository.listOutboundEvents(),
    repository.listProspectReports(20)
  ]);
  const assessmentIds = reports.flatMap((report) => report.assessmentId ? [report.assessmentId] : []);
  const assessments = assessmentIds.length
    ? await repository.listWebsiteAssessments({ ids: assessmentIds, limit: assessmentIds.length })
    : [];
  const assessmentsById = new Map(assessments.map((assessment) => [assessment.id, assessment]));

  return (
    <main className="admin-page">
      <AdminPageHeader
        eyebrow="Outbound wedge"
        title="Campaign measurement"
        description="Track outreach from invitation open through adoption, publish, credibility feedback, and support burden."
        actions={
          <AdminButtonRow>
            <AdminButtonAnchor variant="secondary" href="/api/outbound/export">
              Export manifest
            </AdminButtonAnchor>
            <AdminButtonAnchor variant="primary" href="/api/outbound/export?format=csv">
              Export CSV
            </AdminButtonAnchor>
          </AdminButtonRow>
        }
      />

      <section className="metric-row">
        <Metric label="Prospects" value={summary.prospects} />
        <Metric label="Invitation opens" value={summary.invitationOpened} />
        <Metric label="Adoptions started" value={summary.adoptionsStarted} />
        <Metric label="Adopted" value={summary.adopted} />
      </section>

      <section className="metric-row">
        <Metric label="Open to adoption" value={`${Math.round(summary.invitationToAdoptionRate * 100)}%`} />
        <Metric label="Adoption to publish" value={`${Math.round(summary.adoptionToPublishRate * 100)}%`} />
        <Metric label="Mailer to adoption" value={`${Math.round(summary.mailerToAdoptionRate * 100)}%`} />
        <Metric label="Picker interactions" value={summary.pickerInteractions} />
      </section>

      <section className="metric-row">
        <Metric label="Support burden" value={`${Math.round(summary.supportBurdenRate * 100)}%`} />
        <Metric label="Credibility samples" value={summary.credibilityFeedbackCount} />
        <Metric label="Avg credibility" value={summary.avgCredibilityScore ?? "--"} />
        <Metric label="Published" value={summary.published} />
      </section>

      <div className="admin-grid">
        <section className="panel">
          <h2>Target fit</h2>
          <p className="muted">Business strength is separate from website quality and never appears in the public report.</p>
          <div className="finding-list">
            {reports.map((report) => {
              const assessment = report.assessmentId ? assessmentsById.get(report.assessmentId)?.assessment : undefined;
              return (
                <article key={report.id} className="finding-card">
                  <span className="badge">{report.businessStrength?.tier ?? "business signal incomplete"}</span>
                  <h3>{report.sourceHost ?? report.sourceKey}</h3>
                  <p>
                    Business strength {report.businessStrength?.score ?? "—"} · Website quality {assessment?.score?.value ?? "—"}
                  </p>
                  <small>
                    Business coverage {Math.round((report.businessStrength?.coverage ?? 0) * 100)}% · Website coverage {Math.round((assessment?.coverage.value ?? 0) * 100)}%
                  </small>
                </article>
              );
            })}
            {!reports.length ? <p>No prospect evidence has been collected yet.</p> : null}
          </div>
        </section>

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
                  {prospect.vertical ?? "unknown vertical"} · {prospect.previewId ? "preview linked" : "no preview"}
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
                <h3>{Math.round(item.invitationToAdoptionRate * 100)}% open-to-adoption</h3>
                <p>
                  {item.prospects} prospects · {item.adopted} adopted · {item.published} published
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
        {campaign.channel.replace("_", " ")} · {formatProductDate(campaign.createdAt)}
      </p>
      {compliance.highVolume ? (
        <small className="muted">
          {compliance.reviewed ? "Legal/IP review recorded" : "Legal/IP review required before running"} ·{" "}
          {compliance.plannedRecipients ?? compliance.threshold}+ recipients
        </small>
      ) : null}
      <AdminButtonRow>
        <AdminButtonAnchor variant="secondary" size="sm" href={`/api/outbound/export?campaignId=${encodeURIComponent(campaign.id)}`}>
          Manifest
        </AdminButtonAnchor>
        <AdminButtonAnchor variant="secondary" size="sm" href={`/api/outbound/export?campaignId=${encodeURIComponent(campaign.id)}&format=csv`}>
          CSV
        </AdminButtonAnchor>
      </AdminButtonRow>
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
