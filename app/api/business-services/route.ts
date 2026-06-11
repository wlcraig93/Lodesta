import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdminOrSiteOwner } from "@/lib/security";
import { applyRateLimitHeaders, rateLimit } from "@/lib/rate-limit";
import { getCurrentUser } from "@/lib/supabase/server";
import { withBusinessBundleFields } from "@/lib/business-model";
import { serviceCatalog } from "@/lib/service-catalog";

export const runtime = "nodejs";

/**
 * Owner services control surface (Phase 2 slice): list discovered services
 * (proposed business_services mapped onto the catalog) and confirm/reject
 * them. Confirming a service is the owner-attested truth conversion — the
 * confirmation source flips to "owner". Service OFF is the safe tier;
 * service ON re-runs generation through the existing QA gate (diff-based
 * tiering arrives with the publish-tier work).
 */

const definitionNames = new Map(serviceCatalog.map((definition) => [definition.id, definition.name]));

async function businessIdForSite(siteId: string): Promise<string | null> {
  const bundle = await repository.getSiteBundle(siteId);
  if (!bundle) return null;
  return withBusinessBundleFields(bundle).business?.id ?? null;
}

export async function GET(request: Request) {
  const limit = rateLimit(request, { bucket: "business_services_read", limit: 60, windowMs: 60_000 });
  if (!limit.ok) return limit.response;
  const siteId = new URL(request.url).searchParams.get("siteId") ?? "";
  if (!siteId) return applyRateLimitHeaders(NextResponse.json({ error: "siteId is required" }, { status: 400 }), limit);
  const unauthorized = await requireAdminOrSiteOwner(request, siteId);
  if (unauthorized) return applyRateLimitHeaders(unauthorized, limit);
  const businessId = await businessIdForSite(siteId);
  if (!businessId) return applyRateLimitHeaders(NextResponse.json({ error: "Unknown site" }, { status: 404 }), limit);
  const services = await repository.listBusinessServices(businessId);
  return applyRateLimitHeaders(
    NextResponse.json({
      ok: true,
      services: services.map((record) => ({
        id: record.id,
        name: record.customName ?? definitionNames.get(record.serviceDefinitionId ?? "") ?? record.serviceDefinitionId,
        status: record.status,
        confirmationSource: record.confirmationSource,
        featured: record.featured
      }))
    }),
    limit
  );
}

const updateSchema = z.object({
  siteId: z.string().min(1),
  serviceId: z.string().min(1),
  status: z.enum(["active", "hidden", "rejected"])
});

export async function POST(request: Request) {
  const limit = rateLimit(request, { bucket: "business_services_write", limit: 30, windowMs: 60_000 });
  if (!limit.ok) return limit.response;
  const body = await request.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return applyRateLimitHeaders(NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 }), limit);
  }
  const unauthorized = await requireAdminOrSiteOwner(request, parsed.data.siteId);
  if (unauthorized) return applyRateLimitHeaders(unauthorized, limit);
  const auth = await getCurrentUser();
  const confirmedBy = auth.user?.email ?? auth.user?.id ?? "site_owner";
  const updated = await repository.updateBusinessService({
    id: parsed.data.serviceId,
    status: parsed.data.status,
    confirmedBy
  });
  if (!updated) return applyRateLimitHeaders(NextResponse.json({ error: "Unknown service" }, { status: 404 }), limit);
  return applyRateLimitHeaders(NextResponse.json({ ok: true, service: updated }), limit);
}
