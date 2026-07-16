import { NextResponse } from "next/server";
import { z } from "zod";
import { repository } from "@/lib/repository";
import { requireAdmin } from "@/lib/security";
import { getCurrentUser } from "@/lib/supabase/server";
import { applyRateLimitHeaders, rateLimit } from "@/lib/rate-limit";
import { missingAssetRightIds, requiredAssetRightsForBundle } from "@/lib/asset-rights";
import { missingRequiredClaimFacts } from "@/lib/fact-verification";
import { resolveClaimOwner } from "@/lib/claim-ownership";
import { verifyClaimVerificationChallenge } from "@/lib/claim-verification-challenge";

const verifiedClaimLevelSchema = z.enum(["contact_verified", "owner_verified", "operator_verified"]);

const claimSchema = z.object({
  siteId: z.string().min(1),
  ownerEmail: z.string().email().optional(),
  verificationLevel: verifiedClaimLevelSchema.optional(),
  verificationMethod: z.string().trim().min(1).max(80).optional(),
  verifiedBy: z.string().trim().min(1).max(160).optional(),
  verificationChallenge: z
    .object({
      challengeId: z.string().min(1),
      code: z.string().min(4).max(12)
    })
    .optional(),
  outboundCampaignId: z.string().min(1).optional(),
  outboundProspectId: z.string().min(1).optional(),
  previewToken: z.string().min(1).optional(),
  verifiedFacts: z.array(z.string()).optional(),
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: "Content rights and hosting terms must be accepted." })
  }),
  acceptedManagement: z.literal(true, {
    errorMap: () => ({ message: "Managed-site authority must be accepted." })
  }),
  acceptedAssetRights: z.boolean().optional(),
  attestedAssetIds: z.array(z.string().min(1).max(140)).max(24).optional()
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

  const adminAccess = (await requireAdmin(request)) === null;
  const challengeVerification = parsed.data.verificationChallenge
    ? verifyClaimVerificationChallenge({
        bundle,
        challengeId: parsed.data.verificationChallenge.challengeId,
        code: parsed.data.verificationChallenge.code
      })
    : undefined;
  if (challengeVerification && !challengeVerification.ok) {
    return applyRateLimitHeaders(
      NextResponse.json({ error: challengeVerification.reason, code: "claim_verification_failed" }, { status: 400 }),
      limit
    );
  }
  const verification = adminAccess && parsed.data.verificationLevel
    ? {
        verificationLevel: parsed.data.verificationLevel,
        verificationMethod:
          parsed.data.verificationMethod ??
          (parsed.data.verificationLevel === "operator_verified" ? "operator_manual" : "business_contact_challenge"),
        verifiedBy: parsed.data.verifiedBy ?? owner.ownerEmail ?? owner.ownerUserId ?? "operator"
      }
    : challengeVerification?.ok
      ? {
          verificationLevel: challengeVerification.verificationLevel,
          verificationMethod: challengeVerification.verificationMethod,
          verifiedBy: challengeVerification.verifiedBy
        }
      : undefined;

  if (!verification) {
    return applyRateLimitHeaders(
      NextResponse.json(
        {
          error: "Business-contact verification is required before checkout.",
          code: "claim_verification_required",
          nextStep: "Verify the claimant against the listed business contact or complete the contact-code challenge before creating checkout."
        },
        { status: 409 }
      ),
      limit
    );
  }

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
  const requiredAssets = requiredAssetRightsForBundle(bundle);
  const attestedAssetIds = parsed.data.attestedAssetIds ?? [];
  const missingAssetIds = missingAssetRightIds(requiredAssets, attestedAssetIds);
  if (requiredAssets.length && (!parsed.data.acceptedAssetRights || missingAssetIds.length)) {
    return applyRateLimitHeaders(
      NextResponse.json(
        {
          error: "Photo and logo rights must be confirmed before checkout.",
          missingAssetRights: missingAssetIds
        },
        { status: 400 }
      ),
      limit
    );
  }
  if (requiredAssets.length) {
    const assetResult = await repository.updateOwnerAssets({
      siteId: parsed.data.siteId,
      attestedBy: owner.ownerEmail ?? owner.ownerUserId ?? "site_owner_claim",
      scrapedAttestations: requiredAssets.map((asset) => ({ assetId: asset.id, rightsConfirmed: attestedAssetIds.includes(asset.id) }))
    });
    if (!assetResult) return applyRateLimitHeaders(NextResponse.json({ error: "Unknown site" }, { status: 404 }), limit);
    if (!assetResult.ok) {
      return applyRateLimitHeaders(NextResponse.json({ error: assetResult.reason }, { status: 400 }), limit);
    }
  }

  const claim = await repository.createClaim({
    ...parsed.data,
    ownerUserId: owner.ownerUserId,
    ownerEmail: owner.ownerEmail,
    verificationLevel: verification.verificationLevel,
    verificationMethod: verification.verificationMethod,
    verifiedBy: verification.verifiedBy,
    verifiedAt: new Date().toISOString(),
    outboundCampaignId: parsed.data.outboundCampaignId,
    outboundProspectId: parsed.data.outboundProspectId,
    acceptedAssetRights: requiredAssets.length ? parsed.data.acceptedAssetRights : undefined,
    attestedAssetIds: requiredAssets.length ? attestedAssetIds : []
  });
  if (!claim) return applyRateLimitHeaders(NextResponse.json({ error: "Unknown site" }, { status: 404 }), limit);
  if (claim.outboundCampaignId) {
    await repository.recordOutboundEvent({
      campaignId: claim.outboundCampaignId,
      prospectId: claim.outboundProspectId,
      siteId: claim.siteId,
      type: "checkout_started",
      metadata: {
        source: "claim_api",
        previewToken: parsed.data.previewToken ?? "",
        checkoutConfigured: claim.checkout.configured
      }
    });
  }
  return applyRateLimitHeaders(NextResponse.json(claim), limit);
}

export async function GET(request: Request) {
  const unauthorized = await requireAdmin(request);
  if (unauthorized) return unauthorized;

  const { searchParams } = new URL(request.url);
  return NextResponse.json({ claims: await repository.listClaims(searchParams.get("siteId") ?? undefined) });
}
