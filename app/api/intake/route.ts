import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";
import { evaluateSiteAgainstStandard } from "@/lib/standard-evaluation";
import { applyRateLimitHeaders, rateLimit } from "@/lib/rate-limit";
import { validatePublicFetchUrl } from "@/lib/url-safety";
import { assertLaunchMarket, isLaunchMarketError } from "@/lib/launch-market";
import { startSiteGenerationTelemetry } from "@/lib/agent-telemetry";

export const runtime = "nodejs";

const intakeSchema = z
  .object({
    url: z.string().url().optional(),
    prompt: z.string().min(3).optional(),
    telemetrySource: z.enum(["admin_console"]).optional()
  })
  .refine((value) => value.url || value.prompt, "Provide a URL or prompt.");

export async function POST(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const limit = rateLimit(request, {
    bucket: "site_intake",
    limit: 30,
    windowMs: 10 * 60_000
  });
  if (!limit.ok) return limit.response;

  const body = await request.json().catch(() => null);
  const parsed = intakeSchema.safeParse(body);

  if (!parsed.success) {
    return applyRateLimitHeaders(NextResponse.json({ error: "Invalid intake request", issues: parsed.error.issues }, { status: 400 }), limit);
  }

  try {
    assertLaunchMarket(parsed.data);
  } catch (error) {
    if (isLaunchMarketError(error)) {
      return applyRateLimitHeaders(NextResponse.json({ error: error.message, code: error.code }, { status: 400 }), limit);
    }
    throw error;
  }

  if (parsed.data.url) {
    const urlSafety = await validatePublicFetchUrl(parsed.data.url);
    if (!urlSafety.ok) return applyRateLimitHeaders(NextResponse.json({ error: urlSafety.error }, { status: 400 }), limit);
  }

  const siteInput = {
    url: parsed.data.url,
    prompt: parsed.data.prompt
  };
  const telemetry = await startSiteGenerationTelemetry(repository, {
    ...siteInput,
    source: parsed.data.telemetrySource ?? "api",
    metadata: {
      entrypoint: "/api/intake"
    }
  });
  let bundle: Awaited<ReturnType<typeof repository.createAndStoreSite>>;
  try {
    bundle = await repository.createAndStoreSite(siteInput, { telemetry });
  } catch (error) {
    await telemetry.failRun(error);
    if (isLaunchMarketError(error)) {
      return applyRateLimitHeaders(NextResponse.json({ error: error.message, code: error.code }, { status: 400 }), limit);
    }
    throw error;
  }
  try {
    const previewToken = await telemetry.withSpan(
      {
        spanType: "preview_token",
        name: "Create preview token",
        inputJson: { siteId: bundle.businessProfile.siteId }
      },
      () =>
        repository.createPreviewToken({
          siteId: bundle.businessProfile.siteId,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString()
        })
    );
    const previewUrl = previewToken ? `${appOrigin(request)}/preview/${previewToken.token}` : undefined;
    const replacementEvaluation = evaluateSiteAgainstStandard(bundle);
    const currentEvaluation = bundle.presenceAssessment.standardEvaluation;
    await telemetry.updateRun({
      targetType: "site",
      targetId: bundle.businessProfile.siteId,
      outputSummary: `${bundle.businessProfile.name} (${bundle.siteModel.slug})`,
      outputJson: {
        siteId: bundle.businessProfile.siteId,
        slug: bundle.siteModel.slug,
        businessName: bundle.businessProfile.name,
        vertical: bundle.businessProfile.vertical,
        previewUrl,
        generatedScore: replacementEvaluation.score
      },
      metadata: {
        targetName: bundle.businessProfile.name,
        slug: bundle.siteModel.slug,
        previewUrl,
        editorUrl: `/editor/${bundle.siteModel.slug}`,
        pages: bundle.siteModel.versions[0]?.pages.length ?? 0,
        vertical: bundle.businessProfile.vertical
      }
    });
    await telemetry.completeRun();

    return applyRateLimitHeaders(
      NextResponse.json({
        runId: telemetry.runId,
        bundle,
        preview: previewToken
          ? {
              token: previewToken.token,
              url: previewUrl,
              expiresAt: previewToken.expiresAt
            }
          : undefined,
        qualityScore: {
          sourceUrl: bundle.presenceAssessment.sourceUrl ?? currentEvaluation?.sourceUrl,
          current: currentEvaluation?.score,
          generated: replacementEvaluation.score,
          currentFailedChecks: currentEvaluation?.checks.filter((check) => !check.passed).length ?? null,
          generatedPassingChecks: replacementEvaluation.checks.filter((check) => check.passed).length
        },
        nextSteps: [
          parsed.data.url ? "Review extracted website facts and crawl findings" : "Add source URL or owner-verified facts",
          bundle.presenceAssessment.renderInspection
            ? "Review render inspection findings and screenshot artifacts when available"
            : "Capture desktop and mobile screenshots for render and vision checks",
          "Verify facts on claim",
          previewUrl ? `Send tokenized noindex preview: ${previewUrl}` : "Create tokenized noindex preview"
        ]
      }),
      limit
    );
  } catch (error) {
    await telemetry.failRun(error);
    throw error;
  }
}

function appOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (configured) return configured;
  return new URL(request.url).origin;
}
