import { NextResponse } from "next/server";
import { repository } from "@/lib/repository";
import { requireAdmin, requireAdminOrSiteOwner } from "@/lib/security";
import { publicLeadSubmission } from "@/lib/lead-privacy";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const siteId = searchParams.get("siteId") ?? undefined;
  const unauthorized = siteId ? await requireAdminOrSiteOwner(request, siteId) : await requireAdmin(request);
  if (unauthorized) return unauthorized;

  return NextResponse.json({
    leads: (await repository.listFormSubmissions(siteId)).map(publicLeadSubmission),
    workflowDeliveries: await repository.listWorkflowDeliveries(siteId)
  });
}
