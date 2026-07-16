import { NextResponse } from "next/server";
import { z } from "zod";
import { createBillingPortalSession } from "@/lib/billing";
import { repository } from "@/lib/repository";
import { requireAdminOrSiteOwner } from "@/lib/security";
import { claimGateForBundle } from "@/lib/site-publication";

export const runtime = "nodejs";

const portalSchema = z.object({
  siteId: z.string().min(1),
  returnPath: z.string().startsWith("/").max(180).optional()
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = portalSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid billing portal request", issues: parsed.error.issues }, { status: 400 });
  }

  const unauthorized = await requireAdminOrSiteOwner(request, parsed.data.siteId);
  if (unauthorized) return unauthorized;

  const bundle = await repository.getSiteBundle(parsed.data.siteId);
  if (!bundle) return NextResponse.json({ error: "Unknown site" }, { status: 404 });
  const claims = await repository.listClaims(parsed.data.siteId);
  const claimGate = claimGateForBundle(bundle, claims);
  if (!claimGate.ok) {
    return NextResponse.json(
      {
        error: claimGate.reason,
        claimGate: claimGate.code
      },
      { status: claimGate.code === "payment_required" ? 402 : 409 }
    );
  }
  const claim = "claim" in claimGate ? claimGate.claim : undefined;

  const portal = await createBillingPortalSession({
    stripeCustomerId: claim?.stripeCustomerId,
    returnPath: parsed.data.returnPath ?? `/dashboard/${bundle.siteModel.slug}`
  });

  if (!portal.configured || !portal.url) {
    return NextResponse.json({ error: portal.message, portal }, { status: 409 });
  }

  return NextResponse.json({ portal });
}
