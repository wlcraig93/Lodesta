import Link from "next/link";
import { notFound } from "next/navigation";
import { FormSettingsForm } from "@/components/FormSettingsForm";
import { LeadStatusControls } from "@/components/LeadStatusControls";
import { repository } from "@/lib/repository";
import { requireSiteOwnerAccess } from "@/lib/page-access";
import type { Inquiry, InquiryEvent } from "@/lib/models";

export const dynamic = "force-dynamic";

export default async function LeadsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const bundle = await repository.getSiteBundleBySlug(slug);
  if (!bundle) notFound();
  await requireSiteOwnerAccess(bundle, `/leads/${slug}`);

  const [inquiries, inquiryDeliveries] = await Promise.all([
    repository.listInquiries(bundle.businessProfile.siteId),
    repository.listInquiryDeliveries(bundle.businessProfile.siteId)
  ]);
  const eventsByInquiry = new Map<string, InquiryEvent[]>();
  await Promise.all(
    inquiries.map(async (inquiry) => {
      eventsByInquiry.set(inquiry.id, await repository.listInquiryEvents(inquiry.id));
    })
  );

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <span className="badge">Leads</span>
          <h1>{bundle.businessProfile.name}</h1>
          <p>Inbound inquiries from site forms, with normalized contact details and event history.</p>
        </div>
        <div className="button-row">
          <Link className="button secondary" href={`/editor/${bundle.siteModel.slug}`}>
            Editor
          </Link>
          <Link className="button secondary" href={`/analytics/${bundle.siteModel.slug}`}>
            Analytics
          </Link>
          <a className="button primary" href={`/api/inquiries/export?siteId=${bundle.businessProfile.siteId}`}>
            Export CSV
          </a>
        </div>
      </header>

      <section className="metric-row">
        <Metric label="Total leads" value={inquiries.length} />
        <Metric label="New" value={inquiries.filter((inquiry) => inquiry.status === "new").length} />
        <Metric label="Need reply" value={inquiries.filter((inquiry) => inquiry.status === "needs_reply").length} />
        <Metric label="Spam" value={inquiries.filter((inquiry) => inquiry.status === "spam").length} />
        <Metric label="Notification deliveries" value={inquiryDeliveries.length} />
      </section>

      <section className="panel">
        <h2>Form Settings</h2>
        {bundle.extensionModel.forms.map((form) => (
          <FormSettingsForm
            key={form.id}
            siteId={bundle.businessProfile.siteId}
            form={form}
            workflows={bundle.extensionModel.workflows}
          />
        ))}
        {bundle.extensionModel.forms.length === 0 ? <p className="muted">No forms are configured for this site.</p> : null}
      </section>

      <section className="panel">
        <h2>Inquiries</h2>
        <table className="data-table">
          <thead>
            <tr>
              <th>Received</th>
              <th>Status</th>
              <th>Contact</th>
              <th>Source</th>
              <th>AI triage</th>
              <th>Events</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {inquiries.map((inquiry) => {
              const events = eventsByInquiry.get(inquiry.id) ?? [];
              const primaryEvent = events.find((event) => event.metadata?.dedupe !== true) ?? events[0];
              const duplicateCount = events.filter((event) => event.metadata?.dedupe === true).length;
              return (
                <tr key={inquiry.id}>
                  <td>{formatDate(inquiry.createdAt)}</td>
                  <td>{humanStatus(inquiry.status)}</td>
                  <td>
                    <strong>{inquiry.contactName ?? "Unknown"}</strong>
                    <small className="muted">{inquiry.contactEmail ?? inquiry.contactPhone ?? "No contact extracted"}</small>
                  </td>
                  <td>
                    <span>{primaryEvent?.formId ?? inquiry.sourceChannel}</span>
                    <small className="muted">{sourceSummary(primaryEvent)}</small>
                  </td>
                  <td>
                    {inquiry.aiEnrichment ? (
                      <>
                        <strong>{inquiry.aiEnrichment.intent}</strong>
                        <small className="muted">
                          Suggested: {humanStatus(inquiry.aiEnrichment.recommendedStatus)} · {inquiry.aiEnrichment.urgency}
                        </small>
                      </>
                    ) : (
                      <>
                        <span>{humanStatus(inquiry.aiEnrichmentState)}</span>
                        {inquiry.aiEnrichmentError ? <small className="muted">{inquiry.aiEnrichmentError}</small> : null}
                      </>
                    )}
                  </td>
                  <td>
                    <span>{events.length}</span>
                    {duplicateCount ? <small className="muted">{duplicateCount} duplicate retry</small> : null}
                    <details>
                      <summary>Payload</summary>
                      <code>{JSON.stringify(primaryEvent?.payload ?? {})}</code>
                    </details>
                  </td>
                  <td>
                    <LeadStatusControls
                      siteId={bundle.businessProfile.siteId}
                      inquiryId={inquiry.id}
                      initialStatus={inquiry.status}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {inquiries.length === 0 ? <p className="muted">No inquiries yet.</p> : null}
      </section>

      <section className="panel">
        <h2>Notification Deliveries</h2>
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
            {inquiryDeliveries.map((delivery) => (
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
        {inquiryDeliveries.length === 0 ? <p className="muted">No notification deliveries yet.</p> : null}
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

function sourceSummary(event: InquiryEvent | undefined) {
  const metadata = event?.metadata;
  const parts = [
    metadata?.utmSource ? `utm_source=${metadata.utmSource}` : "",
    metadata?.utmMedium ? `utm_medium=${metadata.utmMedium}` : "",
    metadata?.utmCampaign ? `utm_campaign=${metadata.utmCampaign}` : "",
    metadata?.referrerHost ? `referrer=${metadata.referrerHost}` : ""
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : event?.sourceUrl ?? "direct / untagged";
}

function humanStatus(status: Inquiry["status"] | Inquiry["aiEnrichmentState"]) {
  return status.replaceAll("_", " ");
}
