import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";
import { evaluateSiteAgainstStandard } from "@/lib/standard-evaluation";

const intakeSchema = z
  .object({
    url: z.string().url().optional(),
    prompt: z.string().min(3).optional()
  })
  .refine((value) => value.url || value.prompt, "Provide a URL or prompt.");

export async function POST(request: Request) {
  const unauthorized = requireAdmin(request);
  if (unauthorized) return unauthorized;

  const body = await request.json().catch(() => null);
  const parsed = intakeSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid intake request", issues: parsed.error.issues }, { status: 400 });
  }

  const bundle = await repository.createAndStoreSite(parsed.data);
  const previewToken = await repository.createPreviewToken({
    siteId: bundle.businessProfile.siteId,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30).toISOString()
  });
  const previewUrl = previewToken ? `${appOrigin(request)}/preview/${previewToken.token}` : undefined;
  const replacementEvaluation = evaluateSiteAgainstStandard(bundle);
  const currentEvaluation = bundle.presenceAssessment.standardEvaluation;

  return NextResponse.json({
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
      "Capture desktop and mobile screenshots for render and vision checks",
      "Verify facts on claim",
      previewUrl ? `Send tokenized noindex preview: ${previewUrl}` : "Create tokenized noindex preview"
    ]
  });
}

function appOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (configured) return configured;
  return new URL(request.url).origin;
}
