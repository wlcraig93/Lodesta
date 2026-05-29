import { NextResponse } from "next/server";
import { repository } from "@/lib/repository";
import { requireAdmin, requireAdminOrSiteOwner } from "@/lib/security";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const siteId = searchParams.get("siteId") ?? undefined;
  const unauthorized = siteId ? await requireAdminOrSiteOwner(request, siteId) : requireAdmin(request);
  if (unauthorized) return unauthorized;

  return NextResponse.json({
    leads: await repository.listFormSubmissions(siteId),
    workflowDeliveries: await repository.listWorkflowDeliveries(siteId)
  });
}
