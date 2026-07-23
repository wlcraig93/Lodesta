import { NextResponse } from "next/server";
import { z } from "zod";
import { applyRateLimitHeaders, rateLimit } from "@/lib/rate-limit";
import { searchGoogleProspectPlaces } from "@/packages/acquisition/prospect-reports";

export const runtime = "nodejs";

const searchSchema = z.object({
  query: z.string().trim().min(2).max(120),
  sessionToken: z.string().trim().min(8).max(128).optional()
});

export async function POST(request: Request) {
  const limit = rateLimit(request, {
    bucket: "prospect_report_search",
    limit: 30,
    windowMs: 10 * 60_000
  });
  if (!limit.ok) return limit.response;

  const body = await request.json().catch(() => null);
  const parsed = searchSchema.safeParse(body);
  if (!parsed.success) {
    return applyRateLimitHeaders(
      NextResponse.json({ error: "Invalid business search request", issues: parsed.error.issues }, { status: 400 }),
      limit
    );
  }

  try {
    const suggestions = await searchGoogleProspectPlaces(parsed.data);
    return applyRateLimitHeaders(
      NextResponse.json({
        suggestions,
        attribution: "Powered by Google"
      }),
      limit
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Business search is unavailable.";
    const status = message.includes("daily budget") ? 429 : message.includes("configured") ? 503 : 502;
    return applyRateLimitHeaders(NextResponse.json({ error: message }, { status }), limit);
  }
}
