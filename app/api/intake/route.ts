import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";
import { applyRateLimitHeaders, rateLimit } from "@/lib/rate-limit";
import { normalizePublicFetchUrlInput, validatePublicFetchUrl } from "@/lib/url-safety";
import { assertLaunchMarket, isLaunchMarketError } from "@/lib/launch-market";

export const runtime = "nodejs";

const intakeSchema = z
  .object({
    url: z.string().trim().min(1).optional(),
    prompt: z.string().trim().min(3).optional(),
    generatedSiteV2: z.boolean().optional(),
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

  let sourceUrl = parsed.data.url ? normalizePublicFetchUrlInput(parsed.data.url) : undefined;
  try {
    assertLaunchMarket({ ...parsed.data, url: sourceUrl });
  } catch (error) {
    if (isLaunchMarketError(error)) {
      return applyRateLimitHeaders(NextResponse.json({ error: error.message, code: error.code }, { status: 400 }), limit);
    }
    throw error;
  }
  if (parsed.data.url) {
    const urlSafety = await validatePublicFetchUrl(parsed.data.url);
    if (!urlSafety.ok) return applyRateLimitHeaders(NextResponse.json({ error: urlSafety.error }, { status: 400 }), limit);
    sourceUrl = urlSafety.url;
  }

  try {
    const job = await repository.enqueueJob("generate_site", {
      url: sourceUrl,
      prompt: parsed.data.prompt,
      metadata: {
        entrypoint: "/api/intake",
        generatedSiteV2: parsed.data.generatedSiteV2,
        rendererVersion: parsed.data.generatedSiteV2 ? "layout-v2" : undefined,
        telemetrySource: parsed.data.telemetrySource ?? "api"
      }
    });

    return applyRateLimitHeaders(
      NextResponse.json(
        {
          ok: true,
          mode: "async_job",
          jobId: job.id,
          statusUrl: `/api/intake/jobs/${job.id}`
        },
        { status: 202 }
      ),
      limit
    );
  } catch (error) {
    if (isLaunchMarketError(error)) {
      return applyRateLimitHeaders(NextResponse.json({ error: error.message, code: error.code }, { status: 400 }), limit);
    }
    throw error;
  }
}
