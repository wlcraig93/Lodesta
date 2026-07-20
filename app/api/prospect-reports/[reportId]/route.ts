import { NextResponse } from "next/server";
import { platformOperationsRepository as repository } from "@/packages/platform-operations";
import { publicProspectReport } from "@/lib/prospect-reports";
import { applyRateLimitHeaders, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ reportId: string }> }) {
  const limit = rateLimit(request, {
    bucket: "prospect_report_poll",
    limit: 120,
    windowMs: 10 * 60_000
  });
  if (!limit.ok) return limit.response;

  const { reportId } = await params;
  if (!/^prospect_report_[a-f0-9]{32}$/i.test(reportId)) {
    return applyRateLimitHeaders(NextResponse.json({ error: "Unknown report" }, { status: 404 }), limit);
  }
  const report = await repository.getProspectReport(reportId);
  if (!report) return applyRateLimitHeaders(NextResponse.json({ error: "Unknown report" }, { status: 404 }), limit);
  return applyRateLimitHeaders(NextResponse.json({ report: publicProspectReport(report) }), limit);
}
