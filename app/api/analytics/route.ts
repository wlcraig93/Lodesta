import { NextResponse } from "next/server";
import {
  canonicalAnalyticsEvent,
  parseAnalyticsClientEvent,
  resolveAnalyticsServingContext
} from "@/lib/analytics-ingestion";
import { applyRateLimitHeaders, rateLimit } from "@/lib/rate-limit";
import { siteCapabilityRepository } from "@/packages/site-capabilities";
import type { AnalyticsCollectionReason } from "@/packages/site-capabilities/contracts";

export async function POST(request: Request) {
  const limit = rateLimit(request, {
    bucket: "analytics_ingest",
    limit: 240,
    windowMs: 60_000
  });
  if (!limit.ok) return limit.response;

  const parsed = await parseAnalyticsClientEvent(request);
  if (!parsed.ok) {
    return applyRateLimitHeaders(NextResponse.json({ accepted: false, status: "invalid" }, { status: 400 }), limit);
  }

  const context = await resolveAnalyticsServingContext(request, parsed.event.siteId, parsed.event.versionId);
  if (!context.ok) {
    if (context.site) {
      await siteCapabilityRepository.recordAnalyticsCollection(context.site.id, collectionReason(context.reason)).catch(() => undefined);
    }
    return applyRateLimitHeaders(
      NextResponse.json({ accepted: false, status: context.reason }, { status: context.status }),
      limit
    );
  }

  const event = canonicalAnalyticsEvent(context, parsed.event);
  const result = await siteCapabilityRepository.recordAnalyticsEvent(event);
  return applyRateLimitHeaders(
    NextResponse.json({ accepted: !result.duplicate, status: result.duplicate ? "duplicate" : "accepted" }, { status: 202 }),
    limit
  );
}

function collectionReason(reason: Exclude<Awaited<ReturnType<typeof resolveAnalyticsServingContext>>, { ok: true }>["reason"]): AnalyticsCollectionReason {
  if (reason === "internal") return "internal";
  if (reason === "bot") return "bot";
  if (reason === "preview") return "preview";
  return "invalid";
}
