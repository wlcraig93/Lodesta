import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";
import { getCurrentUser } from "@/lib/supabase/server";
import { applyRateLimitHeaders, rateLimit } from "@/lib/rate-limit";
import { missingRequiredClaimFacts } from "@/lib/fact-verification";
import { resolveClaimOwner } from "@/lib/claim-ownership";

const claimSchema = z.object({
  siteId: z.string().min(1),
  ownerEmail: z.string().email().optional(),
  verifiedFacts: z.array(z.string()).optional(),
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: "Content rights and hosting terms must be accepted." })
  }),
  acceptedManagement: z.literal(true, {
    errorMap: () => ({ message: "Managed-site authority must be accepted." })
  })
});

export async function POST(request: Request) {
  const limit = rateLimit(request, {
    bucket: "claim_create",
    limit: 8,
    windowMs: 60 * 60_000
  });
  if (!limit.ok) return limit.response;

  const body = await request.json().catch(() => null);
  const parsed = claimSchema.safeParse(body);
  if (!parsed.success) {
    return applyRateLimitHeaders(NextResponse.json({ error: "Invalid claim request", issues: parsed.error.issues }, { status: 400 }), limit);
  }

  const auth = await getCurrentUser();
  const owner = resolveClaimOwner({
    authUser: auth.user,
    requestedOwnerEmail: parsed.data.ownerEmail
  });

  if (!owner.ok) {
    return applyRateLimitHeaders(NextResponse.json({ error: owner.error }, { status: 400 }), limit);
  }

  const bundle = await repository.getSiteBundle(parsed.data.siteId);
  if (!bundle) return applyRateLimitHeaders(NextResponse.json({ error: "Unknown site" }, { status: 404 }), limit);
  const missingFacts = missingRequiredClaimFacts(bundle.businessProfile, parsed.data.verifiedFacts ?? []);
  if (missingFacts.length) {
    return applyRateLimitHeaders(
      NextResponse.json(
        {
          error: "Required business facts must be verified before checkout.",
          missingRequiredFacts: missingFacts
        },
        { status: 400 }
      ),
      limit
    );
  }

  const claim = await repository.createClaim({ ...parsed.data, ownerUserId: owner.ownerUserId, ownerEmail: owner.ownerEmail });
  if (!claim) return applyRateLimitHeaders(NextResponse.json({ error: "Unknown site" }, { status: 404 }), limit);
  return applyRateLimitHeaders(NextResponse.json(claim), limit);
}

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  return NextResponse.json({ claims: await repository.listClaims(searchParams.get("siteId") ?? undefined) });
}
