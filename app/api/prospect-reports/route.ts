import { NextResponse } from "next/server";
import { z } from "zod";
import { platformOperationsRepository as repository } from "@/packages/platform-operations";
import {
  classifyProspectWebsite,
  consumeProspectBudget,
  publicProspectReport,
  recentProspectReportCutoff,
  resolveGoogleProspectPlace
} from "@/lib/prospect-reports";
import { applyRateLimitHeaders, rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";

const createReportSchema = z.object({
  placeId: z.string().trim().regex(/^[A-Za-z0-9:_-]{8,256}$/),
  sessionToken: z.string().trim().min(8).max(128).optional()
});

export async function POST(request: Request) {
  const limit = rateLimit(request, {
    bucket: "prospect_report_create",
    limit: 8,
    windowMs: 60 * 60_000
  });
  if (!limit.ok) return limit.response;

  const body = await request.json().catch(() => null);
  const parsed = createReportSchema.safeParse(body);
  if (!parsed.success) {
    return applyRateLimitHeaders(
      NextResponse.json({ error: "Invalid report request", issues: parsed.error.issues }, { status: 400 }),
      limit
    );
  }

  const reusable = await repository.findReusableProspectReportByPlaceId(
    parsed.data.placeId,
    recentProspectReportCutoff()
  );
  if (reusable) {
    return applyRateLimitHeaders(NextResponse.json({ report: publicProspectReport(reusable), reused: true }), limit);
  }
  const active = await repository.findActiveProspectReportByPlaceId(parsed.data.placeId);
  if (active) {
    return applyRateLimitHeaders(NextResponse.json({ report: publicProspectReport(active), reused: true }), limit);
  }
  if (!consumeProspectBudget("prospect_scan")) {
    return applyRateLimitHeaders(
      NextResponse.json({ error: "Presence report scans are temporarily over their daily budget. Try again later." }, { status: 429 }),
      limit
    );
  }

  let details;
  try {
    details = await resolveGoogleProspectPlace(parsed.data);
  } catch {
    return applyRateLimitHeaders(NextResponse.json({ error: "Unable to resolve the selected business." }, { status: 502 }), limit);
  }
  if (!details.usMarket) {
    return applyRateLimitHeaders(NextResponse.json({ error: "Lodesta reports are currently limited to US businesses." }, { status: 400 }), limit);
  }

  const website = classifyProspectWebsite(details.websiteUri);
  let report;
  try {
    report = await repository.createProspectReport({
      placeId: details.placeId,
      sourceUrl: website.kind === "owned_website" ? website.url : undefined,
      sourceHost: website.host,
      websiteKind: website.kind
    });
  } catch {
    const concurrent = await repository.findActiveProspectReportByPlaceId(details.placeId);
    if (!concurrent) {
      return applyRateLimitHeaders(NextResponse.json({ error: "Unable to create the report." }, { status: 500 }), limit);
    }
    return applyRateLimitHeaders(NextResponse.json({ report: publicProspectReport(concurrent), reused: true }), limit);
  }

  const job = await repository.enqueueProspectReportJob(report.id);
  report = (await repository.updateProspectReport({ reportId: report.id, jobId: job.id })) ?? report;

  return applyRateLimitHeaders(NextResponse.json({ report: publicProspectReport(report), reused: false }, { status: 202 }), limit);
}
