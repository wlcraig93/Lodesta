import { after, NextResponse } from "next/server";
import { z } from "zod";
import { platformOperationsRepository as repository } from "@/packages/platform-operations";
import {
  classifyProspectWebsite,
  consumeProspectBudget,
  noOwnedWebsiteProspectReport,
  publicProspectReport,
  recentProspectReportCutoff,
  resolveProspectBusiness,
  withProspectScanSlot
} from "@/packages/acquisition/prospect-reports";
import { applyRateLimitHeaders, rateLimit } from "@/lib/rate-limit";
import { processNextWebsiteAssessmentJob } from "@/packages/website-assessment/jobs";
import {
  websiteAssessmentRubricIdentity,
  websiteAssessmentScannerIdentity
} from "@/packages/website-assessment/rubric";
import { websiteAssessmentRecordIsCurrent } from "@/packages/website-assessment/service";

export const runtime = "nodejs";

const createReportSchema = z.object({
  query: z.string().trim().min(2).max(300)
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

  if (!consumeProspectBudget("prospect_scan")) {
    return applyRateLimitHeaders(
      NextResponse.json({ error: "Presence report scans are temporarily over their daily budget. Try again later." }, { status: 429 }),
      limit
    );
  }

  let resolution;
  try {
    resolution = await withProspectScanSlot(() => resolveProspectBusiness({ query: parsed.data.query }));
  } catch {
    return applyRateLimitHeaders(NextResponse.json({ error: "Unable to resolve the selected business." }, { status: 502 }), limit);
  }
  if (!resolution.usMarket) {
    return applyRateLimitHeaders(NextResponse.json({ error: "Lodesta reports are currently limited to US businesses." }, { status: 400 }), limit);
  }

  const reusable = await repository.findReusableProspectReportBySourceKey(resolution.sourceKey, recentProspectReportCutoff());
  if (reusable && await prospectReportUsesCurrentAssessment(reusable)) {
    return applyRateLimitHeaders(NextResponse.json({ report: publicProspectReport(reusable), reused: true }), limit);
  }
  const active = await repository.findActiveProspectReportBySourceKey(resolution.sourceKey);
  if (active && await prospectReportUsesCurrentAssessment(active)) {
    return applyRateLimitHeaders(NextResponse.json({ report: publicProspectReport(active), reused: true }), limit);
  }

  const website = resolution.website ?? classifyProspectWebsite(undefined);
  let report;
  try {
    report = await repository.createProspectReport({
      sourceKey: resolution.sourceKey,
      sourceUrl: website.kind === "owned_website" ? website.url : undefined,
      sourceHost: website.host,
      websiteKind: website.kind,
      businessStrength: resolution.businessStrength,
      resolutionUsage: resolution.usage
    });
  } catch {
    const concurrent = await repository.findActiveProspectReportBySourceKey(resolution.sourceKey);
    if (!concurrent) {
      return applyRateLimitHeaders(NextResponse.json({ error: "Unable to create the report." }, { status: 500 }), limit);
    }
    return applyRateLimitHeaders(NextResponse.json({ report: publicProspectReport(concurrent), reused: true }), limit);
  }

  if (website.kind !== "owned_website" || !website.url) {
    report = (await repository.updateProspectReport({
      reportId: report.id,
      status: "completed",
      result: noOwnedWebsiteProspectReport({
        websiteKind: website.kind === "owned_website" ? "no_website" : website.kind,
        sourceUrl: website.url,
        sourceHost: website.host
      }),
      completedAt: new Date().toISOString()
    })) ?? report;
    return applyRateLimitHeaders(NextResponse.json({ report: publicProspectReport(report), reused: false }), limit);
  }

  const assessment = await repository.createWebsiteAssessment({
    targetKind: "public_url",
    sourceKey: resolution.sourceKey,
    sourceUrl: website.url,
    rubricIdentity: websiteAssessmentRubricIdentity,
    scannerIdentity: websiteAssessmentScannerIdentity
  });
  report = (await repository.updateProspectReport({ reportId: report.id, assessmentId: assessment.id })) ?? report;
  const job = await repository.enqueueWebsiteAssessmentJob({
    assessmentId: assessment.id,
    prospectReportId: report.id
  });
  after(async () => {
    try {
      await processNextWebsiteAssessmentJob({ workerId: `prospect-after-${job.id}` });
    } catch (error) {
      console.error(JSON.stringify({
        event: "prospect_report_after_failed",
        jobId: job.id,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  });

  return applyRateLimitHeaders(NextResponse.json({ report: publicProspectReport(report), reused: false }, { status: 202 }), limit);
}

async function prospectReportUsesCurrentAssessment(report: {
  websiteKind: "owned_website" | "no_website" | "social_or_aggregator";
  assessmentId?: string;
}) {
  if (report.websiteKind !== "owned_website") return true;
  if (!report.assessmentId) return false;
  const assessment = await repository.getWebsiteAssessment(report.assessmentId);
  return Boolean(assessment && websiteAssessmentRecordIsCurrent(assessment));
}
