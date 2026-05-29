import Link from "next/link";
import { notFound } from "next/navigation";
import { LeadStatusControls } from "@/components/LeadStatusControls";
import { repository } from "@/lib/repository";
import { requireSiteOwnerAccess } from "@/lib/page-access";
import type { LeadSubmission } from "@/lib/models";

export const dynamic = "force-dynamic";

export default async function LeadsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const bundle = await repository.getSiteBundleBySlug(slug);
  if (!bundle) notFound();
  await requireSiteOwnerAccess(bundle, `/leads/${slug}`);

  const [leads, workflowDeliveries] = await Promise.all([
    repository.listFormSubmissions(bundle.businessProfile.siteId),
    repository.listWorkflowDeliveries(bundle.businessProfile.siteId)
  ]);

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <span className="badge">Leads</span>
          <h1>{bundle.businessProfile.name}</h1>
          <p>Captured form submissions with payloads preserved as flexible JSON for each site-specific form.</p>
        </div>
        <div className="button-row">
          <Link className="button secondary" href={`/editor/${bundle.siteModel.slug}`}>
            Editor
          </Link>
          <Link className="button secondary" href={`/analytics/${bundle.siteModel.slug}`}>
            Analytics
          </Link>
          <a className="button primary" href={`/api/leads/export?siteId=${bundle.businessProfile.siteId}`}>
            Export CSV
          </a>
        </div>
      </header>

      <section className="metric-row">
        <Metric label="Total leads" value={leads.length} />
        <Metric label="New" value={leads.filter((lead) => lead.status === "new").length} />
        <Metric label="Reviewed" value={leads.filter((lead) => lead.status === "reviewed").length} />
        <Metric label="Spam" value={leads.filter((lead) => lead.status === "spam").length} />
        <Metric label="Workflow deliveries" value={workflowDeliveries.length} />
      </section>

      <section className="panel">
        <h2>Submissions</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Submitted</th>
              <th>Status</th>
              <th>Form</th>
              <th>Payload</th>
              <th>Source</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {leads.map((lead) => (
              <tr key={lead.id}>
                <td>{formatDate(lead.submittedAt)}</td>
                <td>{lead.status}</td>
                <td>{lead.formId}</td>
                <td>
                  <code>{JSON.stringify(lead.payload)}</code>
                </td>
                <td>
                  <span>{lead.sourceUrl ?? "unknown"}</span>
                  <small className="muted">{sourceSummary(lead)}</small>
                </td>
                <td>
                  <LeadStatusControls
                    siteId={bundle.businessProfile.siteId}
                    submissionId={lead.id}
                    initialStatus={lead.status}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {leads.length === 0 ? <p className="muted">No submissions yet.</p> : null}
      </section>

      <section className="panel">
        <h2>Workflow Deliveries</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Created</th>
              <th>Status</th>
              <th>Destination</th>
              <th>Target</th>
              <th>Message</th>
            </tr>
          </thead>
          <tbody>
            {workflowDeliveries.map((delivery) => (
              <tr key={delivery.id}>
                <td>{formatDate(delivery.createdAt)}</td>
                <td>{delivery.status}</td>
                <td>{delivery.destination.replace("_", " ")}</td>
                <td>{delivery.target ?? "not configured"}</td>
                <td>{delivery.error ?? delivery.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {workflowDeliveries.length === 0 ? <p className="muted">No workflow deliveries yet.</p> : null}
      </section>
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function sourceSummary(lead: LeadSubmission) {
  const parts = [
    lead.metadata?.utmSource ? `utm_source=${lead.metadata.utmSource}` : "",
    lead.metadata?.utmMedium ? `utm_medium=${lead.metadata.utmMedium}` : "",
    lead.metadata?.utmCampaign ? `utm_campaign=${lead.metadata.utmCampaign}` : "",
    lead.metadata?.referrerHost ? `referrer=${lead.metadata.referrerHost}` : ""
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "direct / untagged";
}
