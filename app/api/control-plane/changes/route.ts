import { NextResponse } from "next/server";
import { createControlPlaneChangeSchema, type ControlPlaneChangePayloadV1 } from "@/lib/control-plane-contracts";
import { submitControlPlaneChange } from "@/lib/control-plane-service";
import { repository } from "@/lib/repository";
import { applyRateLimitHeaders, rateLimit } from "@/lib/rate-limit";
import { requireAdminOrSiteOwner } from "@/lib/security";
import { getCurrentUser } from "@/lib/supabase/server";
import { verticalPackFor } from "@/lib/vertical-packs";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const limit = rateLimit(request, { bucket: "control_plane_read", limit: 60, windowMs: 60_000 });
  if (!limit.ok) return limit.response;
  const siteId = new URL(request.url).searchParams.get("siteId")?.trim() ?? "";
  if (!siteId) return applyRateLimitHeaders(NextResponse.json({ error: "siteId is required" }, { status: 400 }), limit);
  const unauthorized = await requireAdminOrSiteOwner(request, siteId);
  if (unauthorized) return applyRateLimitHeaders(unauthorized, limit);
  const [controlPlane, changes] = await Promise.all([
    repository.getCanonicalControlPlane(siteId),
    repository.listControlPlaneChangeRequests(siteId)
  ]);
  if (!controlPlane) return applyRateLimitHeaders(NextResponse.json({ error: "Canonical control plane was not found" }, { status: 404 }), limit);
  const serviceCatalog = verticalPackFor(controlPlane.state.business.vertical).serviceCatalog;
  return applyRateLimitHeaders(NextResponse.json({ ok: true, controlPlane, changes, serviceCatalog }), limit);
}

export async function POST(request: Request) {
  const limit = rateLimit(request, { bucket: "control_plane_write", limit: 30, windowMs: 60_000 });
  if (!limit.ok) return limit.response;
  const parsed = createControlPlaneChangeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return applyRateLimitHeaders(NextResponse.json({ error: "Invalid control-plane change", issues: parsed.error.issues }, { status: 400 }), limit);
  }
  const unauthorized = await requireAdminOrSiteOwner(request, parsed.data.siteId);
  if (unauthorized) return applyRateLimitHeaders(unauthorized, limit);
  const auth = await getCurrentUser();
  try {
    const result = await submitControlPlaneChange({
      repository,
      siteId: parsed.data.siteId,
      payload: parsed.data.payload as ControlPlaneChangePayloadV1,
      requestedBy: auth.user?.id ?? auth.user?.email ?? "authenticated_operator"
    });
    const status = result.applied ? 200 : 202;
    return applyRateLimitHeaders(NextResponse.json({ ok: true, ...result }, { status }), limit);
  } catch (error) {
    return applyRateLimitHeaders(
      NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 }),
      limit
    );
  }
}
