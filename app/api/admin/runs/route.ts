import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/security";
import { sitePlatformRepository } from "@/packages/platform-data";
import type { SiteAgentRunV2 } from "@/packages/site-contracts";

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;
  const params = new URL(request.url).searchParams;
  const requestedStatus = params.get("status") ?? undefined;
  const status = isStatus(requestedStatus) ? requestedStatus : undefined;
  const records = await sitePlatformRepository.listRecentAgentRunAdminRecords({
    siteId: params.get("siteId") ?? undefined,
    status,
    limit: Math.max(1, Math.min(Number(params.get("limit") ?? 100), 500))
  });
  return NextResponse.json({ runs: records.flatMap((record) => record.run ? [record.run] : []), stale: records.filter((record) => !record.run), total: records.length });
}

function isStatus(value: string | undefined): value is SiteAgentRunV2["status"] {
  return Boolean(value && ["queued", "running", "succeeded", "failed", "cancelled"].includes(value));
}
