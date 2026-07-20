import { NextResponse } from "next/server";
import { z } from "zod";
import { platformOperationsRepository as repository } from "@/packages/platform-operations";
import { publicProspectReport } from "@/lib/prospect-reports";
import { ipHashForRequest, sanitizeAnalyticsMetadata } from "@/lib/privacy";
import { applyRateLimitHeaders, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const leadSchema = z.object({
  email: z.string().trim().email(),
  contactName: z.string().trim().max(120).optional(),
  phone: z.string().trim().max(40).optional(),
  companyWebsite: z.string().optional(),
  formRenderedAt: z.number().int().nonnegative(),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).optional()
});

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

  const body = await request.json().catch(() => null);
  const parsed = leadSchema.safeParse(body);
  if (!parsed.success) {
    return applyRateLimitHeaders(
      NextResponse.json({ error: "Invalid lead capture request", issues: parsed.error.issues }, { status: 400 }),
      limit
    );
  }
  if (parsed.data.companyWebsite?.trim()) {
    return applyRateLimitHeaders(NextResponse.json({ accepted: true, ignored: true }), limit);
  }
  if (Date.now() - parsed.data.formRenderedAt < 800) {
    return applyRateLimitHeaders(NextResponse.json({ accepted: true, ignored: true }), limit);
  }

  const report = await repository.getProspectReport(reportId);
  if (!report) return applyRateLimitHeaders(NextResponse.json({ error: "Unknown report" }, { status: 404 }), limit);

  const lead = await repository.createProspectReportLead({
    reportId,
    email: parsed.data.email,
    contactName: parsed.data.contactName || undefined,
    phone: parsed.data.phone || undefined,
    ipHash: ipHashForRequest(request, { siteId: reportId }),
    metadata: sanitizeAnalyticsMetadata(parsed.data.metadata) ?? undefined
  });
  if (!lead) return applyRateLimitHeaders(NextResponse.json({ error: "Unable to capture lead" }, { status: 500 }), limit);
  const unlocked = await repository.getProspectReport(reportId);
  return applyRateLimitHeaders(
    NextResponse.json({ accepted: true, report: unlocked ? publicProspectReport(unlocked) : publicProspectReport(report) }),
    limit
  );
}
