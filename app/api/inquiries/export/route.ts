import { NextResponse } from "next/server";
import { publicInquiryEvent } from "@/lib/inquiries";
import type { Inquiry, InquiryEvent } from "@/lib/models";
import { repository } from "@/lib/repository";
import { requireAdmin, requireAdminOrSiteOwner } from "@/lib/security";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const siteId = searchParams.get("siteId") ?? undefined;
  const unauthorized = siteId ? await requireAdminOrSiteOwner(request, siteId) : await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const inquiries = await repository.listInquiries(siteId);
  const eventsByInquiry = new Map<string, InquiryEvent[]>();
  await Promise.all(
    inquiries.map(async (inquiry) => {
      eventsByInquiry.set(inquiry.id, await repository.listInquiryEvents(inquiry.id));
    })
  );

  const headers = [
    "id",
    "siteId",
    "sourceChannel",
    "createdAt",
    "updatedAt",
    "status",
    "notificationState",
    "aiEnrichmentState",
    "contactName",
    "contactEmail",
    "contactPhone",
    "formId",
    "sourceUrl",
    "aiIntent",
    "aiUrgency",
    "aiRecommendedStatus",
    "aiSummary",
    "eventPayload"
  ];
  const rows = inquiries.map((inquiry) => inquiryCsvRow(inquiry, eventsByInquiry.get(inquiry.id) ?? []));
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");

  return new NextResponse(`${csv}\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${siteId ?? "all"}-inquiries.csv"`
    }
  });
}

function inquiryCsvRow(inquiry: Inquiry, events: InquiryEvent[]) {
  const firstFormEvent = events.find((event) => event.type === "form_submission" && event.metadata?.dedupe !== true);
  const exportEvent = firstFormEvent ?? events[0];
  return [
    inquiry.id,
    inquiry.siteId,
    inquiry.sourceChannel,
    inquiry.createdAt,
    inquiry.updatedAt,
    inquiry.status,
    inquiry.notificationState,
    inquiry.aiEnrichmentState,
    inquiry.contactName ?? "",
    inquiry.contactEmail ?? "",
    inquiry.contactPhone ?? "",
    firstFormEvent?.formId ?? "",
    firstFormEvent?.sourceUrl ?? "",
    inquiry.aiEnrichment?.intent ?? "",
    inquiry.aiEnrichment?.urgency ?? "",
    inquiry.aiEnrichment?.recommendedStatus ?? "",
    inquiry.aiEnrichment?.summary ?? "",
    JSON.stringify(exportEvent ? publicInquiryEvent(exportEvent).payload ?? {} : {})
  ];
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}
