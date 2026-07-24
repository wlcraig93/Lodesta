import { NextResponse } from "next/server";
import { z } from "zod";
import { validTimezone } from "@/lib/analytics-query";
import { applyRateLimitHeaders, rateLimit } from "@/lib/rate-limit";
import { requireAdminOrSiteOwner } from "@/lib/security";
import { getCurrentUser } from "@/lib/supabase/server";
import { sitePlatformRepository } from "@/packages/platform-data";

const reportingSettingsSchema = z.object({
  reportingTimezone: z.string().min(1).max(100).refine(validTimezone, "Enter a valid IANA timezone.")
}).strict();

export async function PATCH(request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const limit = rateLimit(request, { bucket: "site_reporting_settings", limit: 20, windowMs: 60_000 });
  if (!limit.ok) return limit.response;
  const { siteId } = await params;
  const unauthorized = await requireAdminOrSiteOwner(request, siteId);
  if (unauthorized) return applyRateLimitHeaders(unauthorized, limit);
  const parsed = reportingSettingsSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return applyRateLimitHeaders(NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid reporting settings." }, { status: 400 }), limit);
  }
  const site = await sitePlatformRepository.updateReportingTimezone(siteId, parsed.data.reportingTimezone);
  if (!site) return applyRateLimitHeaders(NextResponse.json({ error: "Website not found." }, { status: 404 }), limit);
  return applyRateLimitHeaders(NextResponse.json({ reportingTimezone: site.reportingTimezone }), limit);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  const limit = rateLimit(request, { bucket: "owner_site_disposition", limit: 10, windowMs: 60_000 });
  if (!limit.ok) return limit.response;

  const auth = await getCurrentUser();
  if (!auth.configured || !auth.user) {
    return applyRateLimitHeaders(
      NextResponse.json({ error: "Sign in to delete this website." }, { status: 401 }),
      limit
    );
  }

  const { siteId } = await params;
  const site = await sitePlatformRepository.disposeOwnedSite(siteId, auth.user.id);
  if (!site) {
    return applyRateLimitHeaders(
      NextResponse.json({ error: "Website not found." }, { status: 404 }),
      limit
    );
  }

  return applyRateLimitHeaders(NextResponse.json({ disposed: true }), limit);
}
