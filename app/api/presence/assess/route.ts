import { NextResponse } from "next/server";
import { z } from "zod";
import { createPresenceIntakePlan } from "@/packages/acquisition/presence-intake";
import { runUrlPresenceAssessment } from "@/packages/acquisition/presence-assessment-runner";
import { requireAdmin } from "@/lib/security";
import { applyRateLimitHeaders, rateLimit } from "@/lib/rate-limit";
import { normalizePublicFetchUrlInput, validatePublicFetchUrl } from "@/lib/url-safety";
import { assertLaunchMarket, isLaunchMarketError } from "@/lib/launch-market";

export const runtime = "nodejs";

const presenceSchema = z.object({
  url: z.string().trim().min(1),
  render: z.boolean().default(true),
  screenshots: z.boolean().default(true)
});

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

  const { crawl, renderInspection, publicPresence } = await runUrlPresenceAssessment({
    url: safeUrl,
    render: parsed.data.render,
    captureScreenshots: parsed.data.screenshots,
    publicPresence: "google_places"
  });
  try {
    assertLaunchMarket({ url: safeUrl, crawl, publicPresence });
  } catch (error) {
    if (isLaunchMarketError(error)) {
      return applyRateLimitHeaders(NextResponse.json({ error: error.message, code: error.code }, { status: 400 }), limit);
    }
    throw error;
  }
  return applyRateLimitHeaders(
    NextResponse.json(createPresenceIntakePlan(safeUrl, crawl, renderInspection, publicPresence)),
    limit
  );
}
