import { NextResponse } from "next/server";
import { z } from "zod";
import { controlPlaneChangePayloadSchema } from "@/packages/site-contracts";
import { controlPlaneService } from "@/packages/control-plane";
import { sitePlatformRepository } from "@/packages/platform-data";
import { applyRateLimitHeaders, rateLimit } from "@/lib/rate-limit";
import { authorizedSiteActor } from "@/app/api/site-agent/auth";

export const runtime = "nodejs";

const submitSchema = z.object({ siteId: z.string().min(1), payload: controlPlaneChangePayloadSchema }).strict();

export async function GET(request: Request) {
  const limit = rateLimit(request, { bucket: "control_plane_read", limit: 60, windowMs: 60_000 });
  if (!limit.ok) return limit.response;
  const siteId = new URL(request.url).searchParams.get("siteId")?.trim() ?? "";
  if (!siteId) return applyRateLimitHeaders(NextResponse.json({ error: "siteId is required" }, { status: 400 }), limit);
  const actor = await authorizedSiteActor(request, siteId);
  if (!actor.ok) return applyRateLimitHeaders(actor.response, limit);
  const site = await sitePlatformRepository.getSite(siteId);
  if (!site) return applyRateLimitHeaders(NextResponse.json({ error: "Site not found" }, { status: 404 }), limit);
  const [state, intent, input, changes] = await Promise.all([
    sitePlatformRepository.getBusinessState(site.businessId), sitePlatformRepository.getSiteIntent(site.id),
    site.currentPublicBuildInputId ? sitePlatformRepository.getPublicBuildInput(site.currentPublicBuildInputId) : undefined,
    sitePlatformRepository.listControlPlaneChangeRequests(site.id)
  ]);
  return applyRateLimitHeaders(NextResponse.json({ ok: true, site, state, intent, input, changes }), limit);
}

export async function POST(request: Request) {
  const limit = rateLimit(request, { bucket: "control_plane_write", limit: 30, windowMs: 60_000 });
  if (!limit.ok) return limit.response;
  const parsed = submitSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return applyRateLimitHeaders(NextResponse.json({ error: "Invalid control-plane change", issues: parsed.error.issues }, { status: 400 }), limit);
  const actor = await authorizedSiteActor(request, parsed.data.siteId);
  if (!actor.ok) return applyRateLimitHeaders(actor.response, limit);
  try {
    const result = await controlPlaneService.submit({ ...parsed.data, requestedBy: actor.actorId });
    return applyRateLimitHeaders(NextResponse.json({ ok: true, ...result }, { status: result.applied ? 202 : 202 }), limit);
  } catch (error) {
    return applyRateLimitHeaders(NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 }), limit);
  }
}
