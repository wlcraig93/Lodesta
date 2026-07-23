import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdminOrSiteOwner } from "@/lib/security";
import { applyRateLimitHeaders, rateLimit } from "@/lib/rate-limit";
import { siteCapabilityRepository } from "@/packages/site-capabilities";
import { sitePlatformRepository } from "@/packages/platform-data";

const analyticsEventSchema = z.object({
  siteId: z.string().min(1),
  sessionId: z.string().min(1),
  visitorId: z.string().min(1).max(120).optional(),
  pageId: z.string().optional(),
  eventType: z.enum([
    "pageview",
    "click",
    "section_view",
    "form_start",
    "form_submit",
    "tel_click",
    "outbound_click",
    "engagement",
    "scroll_depth",
    "web_vital",
    "agent_readable_request",
    "places_ui"
  ]),
  timestamp: z.string().datetime().optional(),
  sectionId: z.string().optional(),
  elementRole: z.string().optional(),
  elementType: z.string().optional(),
  hrefType: z.enum(["internal", "tel", "mailto", "booking", "ordering", "external"]).optional(),
  normalizedX: z.number().min(0).max(1).optional(),
  normalizedY: z.number().min(0).max(1).optional(),
  viewport: z.object({ width: z.number(), height: z.number() }).optional(),
  deviceType: z.enum(["mobile", "tablet", "desktop"]).optional(),
  value: z.number().optional(),
  metadata: z.record(z.union([z.string(), z.number(), z.boolean()])).optional()
});

export async function POST(request: Request) {
  const limit = rateLimit(request, {
    bucket: "analytics_ingest",
    limit: 600,
    windowMs: 60_000
  });
  if (!limit.ok) return limit.response;

  const body = await request.json().catch(() => null);
  const parsed = analyticsEventSchema.safeParse(body);

  if (!parsed.success) {
    return applyRateLimitHeaders(NextResponse.json({ error: "Invalid analytics event", issues: parsed.error.issues }, { status: 400 }), limit);
  }
  if (parsed.data.pageId?.startsWith("/preview/")) {
    return applyRateLimitHeaders(NextResponse.json({ accepted: false, status: "preview_ignored" }), limit);
  }

  const site = await sitePlatformRepository.getSite(parsed.data.siteId);
  if (!site) return applyRateLimitHeaders(NextResponse.json({ error: "Unknown site" }, { status: 404 }), limit);
  if (site.status !== "active" || !site.publishedVersionId) {
    return applyRateLimitHeaders(
      NextResponse.json({
        accepted: false,
        status: "inactive",
        reason: "Site analytics collection starts after publish."
      }),
      limit
    );
  }

  const event = await siteCapabilityRepository.recordAnalyticsEvent({
    ...parsed.data,
    timestamp: parsed.data.timestamp ?? new Date().toISOString()
  });

  return applyRateLimitHeaders(NextResponse.json({ accepted: true, event }), limit);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const siteId = searchParams.get("siteId") ?? "site_joes_pizza";
  const unauthorized = await requireAdminOrSiteOwner(request, siteId);
  if (unauthorized) return unauthorized;

  return NextResponse.json(await siteCapabilityRepository.analyticsSummary(siteId));
}
