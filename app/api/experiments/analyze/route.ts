import { NextResponse } from "next/server";
import { repository } from "@/lib/repository";
import { requireAdminOrSiteOwner } from "@/lib/security";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const siteId = searchParams.get("siteId") ?? "site_joes_pizza";
  const unauthorized = await requireAdminOrSiteOwner(request, siteId);
  if (unauthorized) return unauthorized;

  return NextResponse.json({
    siteId,
    analyses: await repository.analyzeExperiments(siteId)
  });
}
