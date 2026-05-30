import { NextResponse } from "next/server";
import { z } from "zod";
import { crawlUrl } from "@/lib/crawler";
import { createPresenceIntakePlan } from "@/lib/presence-intake";
import { gatherPublicPresenceSignals } from "@/lib/public-presence";
import { inspectUrlRender } from "@/lib/render-inspection";
import { requireAdmin } from "@/lib/security";
import { applyRateLimitHeaders, rateLimit } from "@/lib/rate-limit";
import { validatePublicFetchUrl } from "@/lib/url-safety";
import { assertLaunchMarket, isLaunchMarketError } from "@/lib/launch-market";

export const runtime = "nodejs";

const presenceSchema = z.object({
  url: z.string().url(),
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

  try {
    assertLaunchMarket({ url: parsed.data.url });
  } catch (error) {
    if (isLaunchMarketError(error)) {
      return applyRateLimitHeaders(NextResponse.json({ error: error.message, code: error.code }, { status: 400 }), limit);
    }
    throw error;
  }

  const urlSafety = await validatePublicFetchUrl(parsed.data.url);
  if (!urlSafety.ok) return applyRateLimitHeaders(NextResponse.json({ error: urlSafety.error }, { status: 400 }), limit);

  const [crawl, renderInspection] = await Promise.all([
    crawlUrl(parsed.data.url),
    parsed.data.render
      ? inspectUrlRender({ url: parsed.data.url, captureScreenshots: parsed.data.screenshots })
      : Promise.resolve(undefined)
  ]);
  const publicPresence = await gatherPublicPresenceSignals({ url: parsed.data.url, crawl });
  try {
    assertLaunchMarket({ url: parsed.data.url, crawl, publicPresence });
  } catch (error) {
    if (isLaunchMarketError(error)) {
      return applyRateLimitHeaders(NextResponse.json({ error: error.message, code: error.code }, { status: 400 }), limit);
    }
    throw error;
  }
  return applyRateLimitHeaders(
    NextResponse.json(createPresenceIntakePlan(parsed.data.url, crawl, renderInspection, publicPresence)),
    limit
  );
}
