"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { LeadStatusControls } from "@/components/LeadStatusControls";
import { WorkspaceStatus } from "@/components/OwnerWorkspaceUI";
import { formatProductDate, humanize } from "@/lib/product-format";
import type { Inquiry, InquiryEvent } from "@/packages/site-capabilities";

type InboxFilter = "all" | "needs_reply" | "active" | "won" | "archived";

export function OwnerInbox({ siteId, slug, initialInquiries, eventsByInquiry, requestedInquiryId }: {
  siteId: string;
  slug: string;
  initialInquiries: Inquiry[];
  eventsByInquiry: Record<string, InquiryEvent[]>;
  requestedInquiryId?: string;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<InboxFilter>("all");
  const [inquiries, setInquiries] = useState(initialInquiries);
  const [selectedId, setSelectedId] = useState(requestedInquiryId ?? initialInquiries[0]?.id);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(Boolean(requestedInquiryId));
  const filtered = useMemo(() => inquiries.filter((inquiry) => matchesFilter(inquiry, filter)), [filter, inquiries]);
  const selected = inquiries.find((inquiry) => inquiry.id === selectedId) ?? filtered[0];
  const selectedEvents = selected ? eventsByInquiry[selected.id] ?? [] : [];

  function selectInquiry(id: string) {
    setSelectedId(id);
    setMobileDetailOpen(true);
    router.replace(`/workspace/${slug}/leads?inquiry=${encodeURIComponent(id)}`, { scroll: false });
  }

  function updateStatus(id: string, status: Inquiry["status"]) {
    setInquiries((current) => current.map((inquiry) => inquiry.id === id ? { ...inquiry, status, updatedAt: new Date().toISOString() } : inquiry));
  }

  return (
    <div className="owner-inbox" data-mobile-detail={mobileDetailOpen ? "true" : undefined}>
      <aside className="owner-inbox-list" aria-label="Inquiries">
        <div className="owner-inbox-filter" role="group" aria-label="Filter inquiries">
          {(["all", "needs_reply", "active", "won", "archived"] as InboxFilter[]).map((value) => <button key={value} type="button" className={filter === value ? "is-active" : ""} aria-pressed={filter === value} onClick={() => setFilter(value)}>{filterLabel(value)}<span>{filterCount(inquiries, value)}</span></button>)}
        </div>
        <div className="owner-inbox-items">
          {filtered.map((inquiry) => <button type="button" key={inquiry.id} className={selected?.id === inquiry.id ? "is-selected" : ""} onClick={() => selectInquiry(inquiry.id)}>
            <span className="owner-inbox-avatar" aria-hidden="true">{initials(inquiry.contactName ?? inquiry.contactEmail ?? "New lead")}</span>
            <span className="owner-inbox-item-copy"><span><strong>{inquiry.contactName ?? "Website inquiry"}</strong><small>{formatRelative(inquiry.createdAt)}</small></span><p>{inquiry.aiEnrichment?.summary ?? contactPreview(inquiry, eventsByInquiry[inquiry.id]?.[0])}</p><span><WorkspaceStatus tone={statusTone(inquiry.status)}>{humanize(inquiry.status)}</WorkspaceStatus>{inquiry.aiEnrichment?.serviceInterest ? <small>{inquiry.aiEnrichment.serviceInterest}</small> : null}</span></span>
          </button>)}
          {!filtered.length ? <div className="workspace-empty-state"><strong>No inquiries here</strong><p>Try another filter or check back after a customer contacts the site.</p></div> : null}
        </div>
      </aside>

      <section className="owner-inbox-detail" aria-live="polite">
        {selected ? <>
          <header className="owner-inbox-detail-header">
            <button className="owner-inbox-mobile-back" type="button" onClick={() => setMobileDetailOpen(false)}>← Leads</button>
            <div><span>Received {formatProductDate(selected.createdAt)}</span><h2>{selected.contactName ?? "Website inquiry"}</h2><p>{[selected.contactEmail, selected.contactPhone].filter(Boolean).join(" · ") || "No contact details extracted"}</p></div>
            <WorkspaceStatus tone={statusTone(selected.status)}>{humanize(selected.status)}</WorkspaceStatus>
          </header>

          {selected.aiEnrichment ? <section className="owner-inbox-ai-summary"><div><span>Lodesta triage</span><strong>{selected.aiEnrichment.intent}</strong></div><p>{selected.aiEnrichment.summary}</p><dl><div><dt>Urgency</dt><dd>{humanize(selected.aiEnrichment.urgency)}</dd></div><div><dt>Interest</dt><dd>{selected.aiEnrichment.serviceInterest ?? "Not clear"}</dd></div><div><dt>Suggested next step</dt><dd>{selected.aiEnrichment.suggestedNextAction}</dd></div></dl></section> : <section className="owner-inbox-ai-summary is-pending"><span>Lodesta triage</span><p>{selected.aiEnrichmentError ?? `Enrichment is ${humanize(selected.aiEnrichmentState).toLowerCase()}.`}</p></section>}

          <div className="owner-inbox-detail-grid">
            <section className="workspace-panel"><div className="workspace-panel-heading"><div><span>Message</span><h3>What they submitted</h3></div></div><InquiryMessage event={selectedEvents.find((event) => event.metadata?.dedupe !== true) ?? selectedEvents[0]} /></section>
            <aside className="workspace-panel"><div className="workspace-panel-heading"><div><span>Workflow</span><h3>Update status</h3></div></div><LeadStatusControls siteId={siteId} inquiryId={selected.id} initialStatus={selected.status} onStatusChange={(status) => updateStatus(selected.id, status)} /></aside>
          </div>

          <section className="workspace-panel owner-inbox-history"><div className="workspace-panel-heading"><div><span>History</span><h3>Inquiry activity</h3></div><small>{selectedEvents.length} event{selectedEvents.length === 1 ? "" : "s"}</small></div><div className="owner-inbox-timeline">{selectedEvents.map((event) => <article key={event.id}><span /><div><strong>{humanize(event.type)}</strong><p>{event.messageText ?? eventSummary(event)}</p><small>{humanize(event.actor)} · {formatProductDate(event.createdAt)}</small></div></article>)}</div></section>
        </> : <div className="workspace-empty-state is-centered"><strong>No leads need attention</strong><p>New website inquiries will appear here with contact details and Lodesta triage.</p><Link className="button secondary" href={`/workspace/${slug}/editor`}>Review website forms</Link></div>}
      </section>
    </div>
  );
}

function InquiryMessage({ event }: { event?: InquiryEvent }) {
  if (!event) return <div className="workspace-empty-state"><strong>No submission event</strong><p>The inquiry record exists, but its original event is unavailable.</p></div>;
  const entries = Object.entries(event.payload ?? {}).filter(([, value]) => value !== undefined && value !== null && String(value).trim());
  return <div className="owner-inbox-message">{event.messageText ? <p>{event.messageText}</p> : null}{entries.length ? <dl>{entries.map(([key, value]) => <div key={key}><dt>{humanize(key)}</dt><dd>{typeof value === "object" ? JSON.stringify(value) : String(value)}</dd></div>)}</dl> : null}<small>{sourceSummary(event)}</small></div>;
}

function matchesFilter(inquiry: Inquiry, filter: InboxFilter) {
  if (filter === "all") return true;
  if (filter === "needs_reply") return inquiry.status === "new" || inquiry.status === "needs_reply";
  if (filter === "active") return ["new", "needs_reply", "replied", "booked"].includes(inquiry.status);
  if (filter === "won") return inquiry.status === "won";
  return ["archived", "spam", "lost"].includes(inquiry.status);
}
function filterCount(inquiries: Inquiry[], filter: InboxFilter) { return inquiries.filter((inquiry) => matchesFilter(inquiry, filter)).length; }
function filterLabel(value: InboxFilter) { return ({ all: "All", needs_reply: "Needs reply", active: "Active", won: "Won", archived: "Archived" } as const)[value]; }
function statusTone(status: Inquiry["status"]): "neutral" | "success" | "attention" | "danger" | "info" { if (status === "won" || status === "booked") return "success"; if (status === "new" || status === "needs_reply") return "attention"; if (status === "spam" || status === "lost") return "danger"; if (status === "replied") return "info"; return "neutral"; }
function initials(value: string) { return value.split(/[@\s._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "IN"; }
function contactPreview(inquiry: Inquiry, event?: InquiryEvent) { return event?.messageText ?? inquiry.contactEmail ?? inquiry.contactPhone ?? "New inquiry from the website"; }
function eventSummary(event: InquiryEvent) { return event.formId ? `Submitted through form ${event.formId}.` : `Recorded from ${humanize(event.type).toLowerCase()}.`; }
function sourceSummary(event: InquiryEvent) { const metadata = event.metadata; const parts = [metadata?.utmSource ? `Source: ${metadata.utmSource}` : "", metadata?.utmCampaign ? `Campaign: ${metadata.utmCampaign}` : "", metadata?.referrerHost ? `Referrer: ${metadata.referrerHost}` : ""].filter(Boolean); return parts.length ? parts.join(" · ") : event.sourceUrl ?? "Direct or untagged website visit"; }
function formatRelative(value: string) { const delta = Date.now() - new Date(value).getTime(); if (delta < 60_000) return "Now"; if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m`; if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h`; return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(value)); }
