import { NextResponse } from "next/server";
import { z } from "zod";
import { applyRateLimitHeaders, rateLimit } from "@/lib/rate-limit";
import {
  prospectReportAccessForSecret,
  setProspectReportAccessCookie
} from "@/packages/acquisition/report-access";
import { publicProspectReport } from "@/packages/acquisition/prospect-reports";
import { platformOperationsRepository as repository } from "@/packages/platform-operations";

export const runtime = "nodejs";

const exchangeSchema = z.object({
  secret: z.string().min(32).max(200)
}).strict();

export async function POST(request: Request, { params }: { params: Promise<{ reportId: string }> }) {
  const limit = rateLimit(request, {
    bucket: "prospect_report_access_exchange",
    limit: 20,
    windowMs: 10 * 60_000
  });
  if (!limit.ok) return limit.response;

  const { reportId } = await params;
  if (!/^prospect_report_[a-f0-9]{32}$/i.test(reportId)) {
    return applyRateLimitHeaders(NextResponse.json({ error: "Invalid or expired access link." }, { status: 404 }), limit);
  }
  const parsed = exchangeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return applyRateLimitHeaders(NextResponse.json({ error: "Invalid or expired access link." }, { status: 404 }), limit);
  }
  const [report, grant] = await Promise.all([
    repository.getProspectReport(reportId),
    prospectReportAccessForSecret(reportId, parsed.data.secret)
  ]);
  if (!report || report.accessPolicy !== "email_gate" || !grant) {
    return applyRateLimitHeaders(NextResponse.json({ error: "Invalid or expired access link." }, { status: 404 }), limit);
  }

  const response = NextResponse.json({
    report: publicProspectReport(report, { accessGranted: true })
  });
  response.headers.set("Cache-Control", "private, no-store");
  setProspectReportAccessCookie(response, request, {
    reportId,
    secret: parsed.data.secret,
    expiresAt: grant.expiresAt
  });
  return applyRateLimitHeaders(response, limit);
}
