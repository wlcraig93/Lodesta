import { after, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/security";
import { applyRateLimitHeaders, rateLimit } from "@/lib/rate-limit";
import { normalizePublicFetchUrlInput, validatePublicFetchUrl } from "@/lib/url-safety";
import { assertLaunchMarket, isLaunchMarketError } from "@/lib/launch-market";
import { platformOperationsRepository as repository } from "@/packages/platform-operations";
import { sourceKeyForWebsite } from "@/packages/acquisition/prospect-reports";
import { processNextWebsiteAssessmentJob } from "@/packages/website-assessment/jobs";
import {
  websiteAssessmentRubricIdentity,
  websiteAssessmentScannerIdentity
} from "@/packages/website-assessment/rubric";

export const runtime = "nodejs";

const presenceSchema = z.object({
  url: z.string().trim().min(1)
}).strict();

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const limit = rateLimit(request, {
    bucket: "presence_assess",
    limit: 40,
    windowMs: 10 * 60_000
  });
  if (!limit.ok) return limit.response;

  const body = await request.json().catch(() => null);
  const parsed = presenceSchema.safeParse(body);

  if (!parsed.success) {
    return applyRateLimitHeaders(
      NextResponse.json({ error: "Invalid presence assessment request", issues: parsed.error.issues }, { status: 400 }),
      limit
    );
  }

  const normalizedUrl = normalizePublicFetchUrlInput(parsed.data.url);
  try {
    assertLaunchMarket({ url: normalizedUrl });
  } catch (error) {
    if (isLaunchMarketError(error)) {
      return applyRateLimitHeaders(NextResponse.json({ error: error.message, code: error.code }, { status: 400 }), limit);
    }
    throw error;
  }
  const urlSafety = await validatePublicFetchUrl(parsed.data.url);
  if (!urlSafety.ok) return applyRateLimitHeaders(NextResponse.json({ error: urlSafety.error }, { status: 400 }), limit);
  const safeUrl = urlSafety.url;

  const assessment = await repository.createWebsiteAssessment({
    targetKind: "public_url",
    sourceKey: sourceKeyForWebsite(safeUrl),
    sourceUrl: safeUrl,
    rubricIdentity: websiteAssessmentRubricIdentity,
    scannerIdentity: websiteAssessmentScannerIdentity
  });
  const job = await repository.enqueueWebsiteAssessmentJob({ assessmentId: assessment.id });
  after(async () => {
    try {
      await processNextWebsiteAssessmentJob({ workerId: `presence-after-${job.id}` });
    } catch (error) {
      console.error(JSON.stringify({
        event: "website_assessment_after_failed",
        jobId: job.id,
        error: error instanceof Error ? error.message : String(error)
      }));
    }
  });
  return applyRateLimitHeaders(
    NextResponse.json({
      assessment,
      job: { id: job.id, status: job.status }
    }, { status: 202 }),
    limit
  );
}
