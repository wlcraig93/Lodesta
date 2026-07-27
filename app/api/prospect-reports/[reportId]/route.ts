import { after, NextResponse } from "next/server";
import { platformOperationsRepository as repository } from "@/packages/platform-operations";
import { publicProspectReport } from "@/packages/acquisition/prospect-reports";
import { applyRateLimitHeaders, rateLimit } from "@/lib/rate-limit";
import {
  hasOutboundReportOperatorCookie,
  prospectReportAccessForRequest
} from "@/packages/acquisition/report-access";

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
  const grant = report.accessPolicy === "email_gate"
    ? await prospectReportAccessForRequest(request, report.id)
    : null;
  if (
    report.accessPolicy === "public_link"
    && report.status === "completed"
    && report.result
    && !hasOutboundReportOperatorCookie(request, report.id)
  ) {
    after(() => repository.recordOutboundReportView(report.id));
  }
  const response = NextResponse.json({
    report: publicProspectReport(report, { accessGranted: Boolean(grant) })
  });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Vary", "Cookie");
  return applyRateLimitHeaders(response, limit);
}
