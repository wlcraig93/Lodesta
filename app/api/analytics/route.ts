import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdminOrSiteOwner } from "@/lib/security";
import { applyRateLimitHeaders, rateLimit } from "@/lib/rate-limit";
import { claimGateForBundle } from "@/lib/site-publication";

const analyticsEventSchema = z.object({
  siteId: z.string().min(1),
  sessionId: z.string().min(1),
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
    "experiment_assignment",
    "agent_readable_request"
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

  const bundle = await repository.getSiteBundle(parsed.data.siteId);
  if (!bundle) return applyRateLimitHeaders(NextResponse.json({ error: "Unknown site" }, { status: 404 }), limit);

  const claimGate = claimGateForBundle(bundle, await repository.listClaims(parsed.data.siteId));
  if (!claimGate.ok) {
    return applyRateLimitHeaders(
      NextResponse.json({
        accepted: false,
        status: "inactive",
        reason: "Site analytics collection starts after claim and publish.",
        claimGate: claimGate.code
      }),
      limit
    );
  }

  const event = await repository.recordAnalyticsEvent({
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

  return NextResponse.json(await repository.analyticsSummary(siteId));
}
