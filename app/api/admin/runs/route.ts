import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/security";
import { sitePlatformRepository } from "@/packages/platform-data";
import type { SiteAgentRunV1 } from "@/packages/site-contracts";

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const params = new URL(request.url).searchParams;
  const requestedStatus = params.get("status") ?? undefined;
  const status = isStatus(requestedStatus) ? requestedStatus : undefined;
  const runs = await sitePlatformRepository.listRecentAgentRuns({
    siteId: params.get("siteId") ?? undefined,
    status,
    limit: Math.max(1, Math.min(Number(params.get("limit") ?? 100), 500))
  });
  return NextResponse.json({ runs, total: runs.length });
}

function isStatus(value: string | undefined): value is SiteAgentRunV1["status"] {
  return Boolean(value && ["queued", "running", "succeeded", "failed", "cancelled"].includes(value));
}
