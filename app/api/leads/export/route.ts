import { NextResponse } from "next/server";
import { repository } from "@/lib/repository";
import { requireAdmin, requireAdminOrSiteOwner } from "@/lib/security";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const siteId = searchParams.get("siteId") ?? undefined;
  const unauthorized = siteId ? await requireAdminOrSiteOwner(request, siteId) : requireAdmin(request);
  if (unauthorized) return unauthorized;

  const leads = await repository.listFormSubmissions(siteId);
  const headers = ["id", "siteId", "formId", "pageId", "submittedAt", "status", "sourceUrl", "metadata", "payload"];
  const rows = leads.map((lead) => [
    lead.id,
    lead.siteId,
    lead.formId,
    lead.pageId ?? "",
    lead.submittedAt,
    lead.status,
    lead.sourceUrl ?? "",
    JSON.stringify(lead.metadata ?? {}),
    JSON.stringify(lead.payload)
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");

  return new NextResponse(`${csv}\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${siteId ?? "all"}-leads.csv"`
    }
  });
}

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}
