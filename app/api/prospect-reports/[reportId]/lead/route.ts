import { NextResponse } from "next/server";
import { z } from "zod";
import { appOriginFromRequest } from "@/lib/app-origin";
import { sendProspectReportAccessEmail } from "@/lib/prospect-report-email";
import { ipHashForRequest, sanitizeAnalyticsMetadata } from "@/lib/privacy";
import { applyRateLimitHeaders, rateLimit } from "@/lib/rate-limit";
import {
  issueProspectReportAccessGrant,
  prospectReportEmailLink,
  setProspectReportAccessCookie
} from "@/packages/acquisition/report-access";
import { publicProspectReport } from "@/packages/acquisition/prospect-reports";
import { platformOperationsRepository as repository } from "@/packages/platform-operations";

export const runtime = "nodejs";

const leadSchema = z.object({
  email: z.string().trim().email(),
  companyWebsite: z.string().optional(),
  formRenderedAt: z.number().int().nonnegative(),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).optional()
}).strict();

export async function POST(request: Request, { params }: { params: Promise<{ reportId: string }> }) {
  const limit = rateLimit(request, {
    bucket: "prospect_report_lead",
    limit: 8,
    windowMs: 60 * 60_000
  });
  if (!limit.ok) return limit.response;

  const { reportId } = await params;
  if (!/^prospect_report_[a-f0-9]{32}$/i.test(reportId)) {
    return applyRateLimitHeaders(NextResponse.json({ error: "Unknown report" }, { status: 404 }), limit);
  }

  const parsed = leadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return applyRateLimitHeaders(
      NextResponse.json({ error: "Enter a valid email address." }, { status: 400 }),
      limit
    );
  }
  if (parsed.data.companyWebsite?.trim() || Date.now() - parsed.data.formRenderedAt < 800) {
    return applyRateLimitHeaders(NextResponse.json({ accepted: true, ignored: true }), limit);
  }

  const report = await repository.getProspectReport(reportId);
  if (!report) {
    return applyRateLimitHeaders(NextResponse.json({ error: "Unknown report" }, { status: 404 }), limit);
  }
  if (report.status !== "completed" || !report.result) {
    return applyRateLimitHeaders(
      NextResponse.json({ error: "The report must finish before access can be granted." }, { status: 409 }),
      limit
    );
  }
  if (report.accessPolicy !== "email_gate") {
    return applyRateLimitHeaders(
      NextResponse.json({ error: "This report is already available by public link." }, { status: 400 }),
      limit
    );
  }

  const lead = await repository.createProspectReportLead({
    reportId,
    email: parsed.data.email,
    ipHash: ipHashForRequest(request, { siteId: reportId }),
    metadata: sanitizeAnalyticsMetadata(parsed.data.metadata) ?? undefined
  });
  if (!lead) {
    return applyRateLimitHeaders(
      NextResponse.json({ error: "Unable to save report access." }, { status: 500 }),
      limit
    );
  }

  const issued = await issueProspectReportAccessGrant({ reportId, leadId: lead.id });
  const delivery = await sendProspectReportAccessEmail({
    email: lead.email,
    businessName: report.result.siteUnderstanding.businessName,
    reportUrl: prospectReportEmailLink(appOriginFromRequest(request), report.id, issued.secret)
  });
  const response = NextResponse.json({
    accepted: true,
    report: publicProspectReport(report, { accessGranted: true }),
    emailDelivery: delivery
  });
  response.headers.set("Cache-Control", "private, no-store");
  setProspectReportAccessCookie(response, request, {
    reportId,
    secret: issued.secret,
    expiresAt: issued.grant.expiresAt
  });
  return applyRateLimitHeaders(response, limit);
}
